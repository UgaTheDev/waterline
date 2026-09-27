"""Leave-one-out check of terrain inference against USGS high-water marks. Writes eval/results/terrain_loo.json.

For each mark: hold it out, spread every OTHER mark's water surface (terrain.flood, as infer_replay does) and read the
inferred surface at the held-out mark's DEM cell. Where several marks reach it, take the one with the highest upper
bound, which is what fusion routes on. "Reached" also requires surface > DEM ground there (spread emits nothing otherwise).
Two variants: excluding only the mark itself, and excluding every mark at the same USGS site (duplicates at one site
would otherwise make the check look better than it is).
    python -m scripts.eval_terrain
"""
import json, statistics
from backend import terrain
from backend.profiles import ROOT
from scripts.infer_replay import hwms, seed
from scripts.survey_layer import FT

SEDAN_CM = 15


def run(marks, floods, strict):
    D, rows = terrain.dem(), []
    for j, h in enumerate(marks):
        r, c = (int(v) for v in D.cell(h["longitude_dd"], h["latitude_dd"]))
        g = float(D.z[r, c])
        best = None
        for i, f in enumerate(floods):
            o = marks[i]
            if i == j or f is None or (strict and o.get("site_id") == h.get("site_id")):
                continue
            r0, c0, comp, dist = f
            rr, cc = r - r0, c - c0
            if not (0 <= rr < comp.shape[0] and 0 <= cc < comp.shape[1] and comp[rr, cc]):
                continue
            _, _, zm, zh, _, _ = seed(o)
            if zm <= g:
                continue
            high = zh + terrain.SIGMA0_CM + terrain.SLOPE_CM_PER_M * float(dist[rr, cc])
            if best is None or high > best[1]:
                best = (zm, high, float(dist[rr, cc]), o["hwm_id"])
        truth = h["elev_ft"] * FT
        hag = (h.get("height_above_gnd") or 0) * FT
        row = {"hwm_id": h["hwm_id"], "site_id": h.get("site_id"), "surveyed_cm": round(truth, 1), "height_above_gnd_cm": round(hag, 1),
               "dem_ground_cm": round(g, 1), "reached": best is not None}
        if best:
            row.update(inferred_cm=round(best[0], 1), error_cm=round(best[0] - truth, 1), high_depth_cm=round(best[1] - g, 1),
                       from_hwm=best[3], dist_m=round(best[2]))
        rows.append(row)
    err = [x["error_cm"] for x in rows if x["reached"]]
    deep = [x for x in rows if x["height_above_gnd_cm"] > SEDAN_CM]
    blocked = [x for x in deep if x["reached"] and x["high_depth_cm"] > SEDAN_CM]
    return {"marks": len(rows), "reached": len(err),
            "median_error_cm": round(statistics.median(err), 1) if err else None,
            "mae_cm": round(statistics.mean(map(abs, err)), 1) if err else None,
            "underestimate_gt20cm": sum(e < -20 for e in err), "underestimate_rate": round(sum(e < -20 for e in err) / len(err), 3) if err else None,
            "deep_marks_gt15cm": len(deep), "deep_reached": sum(x["reached"] for x in deep), "deep_blocks_sedan": len(blocked),
            "deep_reached_but_missed": sum(x["reached"] and x["high_depth_cm"] <= SEDAN_CM for x in deep),
            "deep_not_reached": sum(not x["reached"] for x in deep), "rows": rows}


def main():
    marks = hwms(peaks=False)
    floods = [terrain.flood(*seed(h)[:2], seed(h)[3]) for h in marks]
    res = {"method": "terrain-v1", "radius_m": terrain.RADIUS_M, "sigma0_cm": terrain.SIGMA0_CM, "slope_cm_per_m": terrain.SLOPE_CM_PER_M,
           "exclude_self": run(marks, floods, False), "exclude_site": run(marks, floods, True)}
    out = ROOT / "eval/results/terrain_loo.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=1))
    for k in ("exclude_self", "exclude_site"):
        print(k, {a: b for a, b in res[k].items() if a != "rows"})


if __name__ == "__main__":
    main()
