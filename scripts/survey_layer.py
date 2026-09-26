"""USGS survey layer: estimated peak water depth on roads near surveyed high-water marks.

  depth on a road = HWM water-surface elevation (STN, NAVD88) - lowest road ground elevation (3DEP 1 m, NAVD88)

Only roads within RADIUS_M of a mark; bridges/tunnels excluded (bare-earth DEM is the ground under a
bridge, not the deck); roads above the water surface are skipped, never marked dry. Observation time is
USGS's (estimated) peak time. Writes data/cache/survey_observations.json.   python -m scripts.survey_layer
"""
import io, json, time, urllib.parse, urllib.request
import numpy as np
import osmnx as ox
from PIL import Image
from shapely.geometry import Point
from backend.profiles import BBOX, CACHE
from backend.router import Roads

STN = "https://stn.wim.usgs.gov/STNServices"
DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
UA = {"User-Agent": "WaterlineFloodDemo/1.0 (Nebius x NVIDIA hackathon; https://github.com/UgaTheDev)"}
RADIUS_M = 150
CHIP_DEG, CHIP_PX = 0.0025, 250  # +/- ~250 m around each mark at ~2 m/px
NAVD88, MAX_QUALITY = 2, 4       # quality 1-4 = +/-0.05..0.40 ft; 5 (VP) and 6 (unknown) are dropped
QUALITY_FT = {1: 0.05, 2: 0.10, 3: 0.20, 4: 0.40}
# Error allowance. Validated against the 26 bbox marks with a surveyed height above ground (python -m scripts.survey_layer --validate,
# 2026-09-26): median +11 cm, MAE 36 cm, 3/26 underestimated by >20 cm (worst -69). 0.33 + 0.5 ft covers all but the worst.
DEM_FT, SLOPE_FT = 0.33, 0.5  # ponytail: flat allowance; interpolate the water surface between marks if this proves loose
FT = 30.48


def get(url, **kw):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA, **kw), timeout=120) as r:
        return r.read()


def chip(lat, lon):
    w, s, e, n = lon - CHIP_DEG, lat - CHIP_DEG, lon + CHIP_DEG, lat + CHIP_DEG
    q = urllib.parse.urlencode({"bbox": f"{w},{s},{e},{n}", "bboxSR": 4326, "imageSR": 4326, "size": f"{CHIP_PX},{CHIP_PX}",
                                "format": "tiff", "pixelType": "F32", "noData": -9999, "interpolation": "RSP_BilinearInterpolation", "f": "image"})
    a = np.array(Image.open(io.BytesIO(get(f"{DEM}?{q}")))) * 3.28084  # metres -> feet
    a[a < -1000] = np.nan

    def sample(x, y):
        c, r = int((x - w) / (e - w) * CHIP_PX), int((n - y) / (n - s) * CHIP_PX)
        return a[r, c] if 0 <= r < CHIP_PX and 0 <= c < CHIP_PX else np.nan
    return sample


def main():
    w, s, e, n = BBOX
    hwms = [h for h in json.loads(get(f"{STN}/Events/180/HWMs.json"))
            if s <= h["latitude_dd"] <= n and w <= h["longitude_dd"] <= e and h.get("elev_ft")
            and h.get("vdatum_id") == NAVD88 and (h.get("hwm_quality_id") or 9) <= MAX_QUALITY]
    print(f"{len(hwms)} usable marks in bbox")
    peaks = {}
    R = Roads(ox.load_graphml(CACHE / "graph.graphml"))
    obs = []
    for i, h in enumerate(hwms):
        pid = h.get("peak_summary_id")
        if pid and pid not in peaks:
            try:
                peaks[pid] = json.loads(get(f"{STN}/PeakSummaries/{pid}.json")).get("peak_date")
            except Exception:
                peaks[pid] = None
        peak = peaks.get(pid)
        if not peak:
            continue  # no timing: can't place it in the replay honestly
        lat, lon, wse = h["latitude_dd"], h["longitude_dd"], h["elev_ft"]
        here = Point(*R.to_m(lon, lat))
        dem = None
        for attempt in range(3):  # the 3DEP image server returns intermittent 502s
            try:
                dem = chip(lat, lon)
                break
            except Exception as ex:
                print("\ndem retry", h["hwm_id"], ex)
                time.sleep(3)
        if dem is None:
            continue
        time.sleep(0.5)
        for j in R.tree.query(here.buffer(RADIUS_M)):
            eid = R.ids[int(j)]
            u, v, k, geom, name, length = R.edges[eid]
            d = R.G[u][v][k]
            if d.get("bridge") or d.get("tunnel"):
                continue
            pts = [geom.interpolate(f, normalized=True) for f in np.linspace(0, 1, max(2, int(length // 5) + 1))]
            ground = [dem(p.x, p.y) for p in pts if here.distance(Point(*R.to_m(p.x, p.y))) <= RADIUS_M]
            ground = [g for g in ground if not np.isnan(g)]
            if not ground:
                continue
            low_ground = float(min(ground))
            depth_ft = wse - low_ground  # lowest point of the road near the mark = deepest water
            if depth_ft <= 0:
                continue  # road above the water surface: skip, never claim dry
            band = QUALITY_FT[h["hwm_quality_id"]] + DEM_FT + SLOPE_FT
            dist = round(here.distance(Point(*R.to_m(*geom.interpolate(0.5, normalized=True).coords[0]))))
            obs.append({"obs_id": f"usgs-{h['hwm_id']}-{eid}", "edge_id": eid, "time": peak[:19] + "Z",  # STN peak times are UTC
                        "lat": lat, "lon": lon, "status": "ok", "depth_cm": round(depth_ft * FT, 1),
                        "low_cm": round(max(0.0, depth_ft - band) * FT, 1), "high_cm": round((depth_ft + band) * FT, 1),
                        "confidence": 0.7, "half_life_min": 720, "kind": "survey",
                        "reference": f"USGS high-water mark #{h['hwm_id']}, {dist} m away",
                        "rationale": f"Surveyed water surface {wse:.1f} ft minus lowest road ground {low_ground:.1f} ft (NAVD88); peak time estimated by USGS.",
                        "credit": "USGS Short-Term Network + USGS 3DEP 1 m elevation, public domain",
                        "source_url": f"{STN}/HWMs/{h['hwm_id']}.json", "precision": "exact", "image_url": None})
        print(f"\r{i + 1}/{len(hwms)} marks, {len(obs)} road observations", end="")
    (CACHE / "survey_observations.json").write_text(json.dumps(obs, indent=1))
    print(f"\n{len(obs)} observations on {len({o['edge_id'] for o in obs})} road segments")


def validate():
    """Method check: water surface - DEM ground at the mark itself vs the surveyed height above ground."""
    import statistics
    w, s, e, n = BBOX
    hs = [h for h in json.loads(get(f"{STN}/Events/180/HWMs.json")) if s <= h["latitude_dd"] <= n and w <= h["longitude_dd"] <= e
          and (h.get("height_above_gnd") or 0) > 0 and h.get("elev_ft") and h.get("vdatum_id") == NAVD88]
    err = []
    for h in hs:
        try:
            g = chip(h["latitude_dd"], h["longitude_dd"])(h["longitude_dd"], h["latitude_dd"])
        except Exception:
            continue
        err.append((h["elev_ft"] - g - h["height_above_gnd"]) * FT)
        time.sleep(0.5)
    print(f"n={len(err)} median {statistics.median(err):+.0f} cm, MAE {statistics.mean(map(abs, err)):.0f} cm, "
          f"underestimates >20 cm: {sum(x < -20 for x in err)}")


if __name__ == "__main__":
    import sys
    validate() if "--validate" in sys.argv else main()
