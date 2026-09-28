"""Build one replay event end to end into data/cache/events/<id>/:

  event.json -> road graph (OSM, drive, bbox) -> IEM archived flood-warning polygons -> tiled 3DEP DEM ->
  USGS STN marks + peak timing -> survey layer -> terrain-inferred layer -> map view / default time

    python -m scripts.add_event ida2021 --name "Hurricane Ida (2021)" --city "New York City, NY" \
        --bbox=-73.955,40.700,-73.777,40.836 --start 2021-09-01T12:00:00Z --end 2021-09-03T12:00:00Z --stn 312 --wfo OKX
    python -m scripts.add_event ida2021            (rebuild from the existing event.json)

A step whose output already exists is skipped (resume after a flaky source); --force redoes every step.
Peak timing when STN has no peak summary: nearest NWIS stream gauge in the bbox, else IEMRE rainfall peak
(scripts/survey_layer.marks); the source is written into each observation's provenance and rationale.
"""
import argparse, json
import numpy as np
from backend import events
from scripts import build_dem, build_graph, fetch_alerts, infer_replay, survey_layer

BASE_CREDITS = [
    "USGS Short-Term Network high-water marks (public domain)",
    "USGS 3DEP 1 m bare-earth elevation (public domain)",
    "Road network (c) OpenStreetMap contributors (ODbL)",
]


def spec(a):
    d = events.DIR / a.id
    p = d / "event.json"
    E = json.loads(p.read_text()) if p.exists() else {"id": a.id}
    for k, v in (("name", a.name), ("city", a.city), ("stn_event_id", a.stn)):
        if v is not None:
            E[k] = v
    if a.bbox:
        E["bbox"] = [float(x) for x in a.bbox.split(",")]
    if a.wfo:
        E["wfo"] = a.wfo.split(",")
    if a.start or a.end:
        E["replay"] = {**E.get("replay", {}), **({"start": a.start} if a.start else {}), **({"end": a.end} if a.end else {})}
    missing = [k for k in ("name", "city", "bbox", "stn_event_id", "wfo") if not E.get(k)] + [k for k in ("start", "end") if not E.get("replay", {}).get(k)]
    if missing:
        raise SystemExit(f"missing {missing}: pass them as flags the first time")
    E.setdefault("credits", [])
    d.mkdir(parents=True, exist_ok=True)
    return E, p


def save(E, p):
    p.write_text(json.dumps({k: v for k, v in E.items() if k != "dir"}, indent=2) + "\n")
    events._REG = None  # re-read the registry so the new event resolves


def view(E, obs):
    """Frame where the replay data is (10-90% of observation coordinates), not the bbox centre (Harvey's rule)."""
    if not obs:
        w, s, e, n = E["bbox"]
        return {"center": [round((w + e) / 2, 4), round((s + n) / 2, 4)], "zoom": 12}
    lon, lat = np.array([o["lon"] for o in obs]), np.array([o["lat"] for o in obs])
    (x0, x1), (y0, y1) = np.percentile(lon, [10, 90]), np.percentile(lat, [10, 90])
    span_km = max((x1 - x0) * 111.32 * np.cos(np.radians(lat.mean())), (y1 - y0) * 110.54, 1)
    return {"center": [round(float((x0 + x1) / 2), 4), round(float((y0 + y1) / 2), 4)],
            "zoom": round(float(np.clip(13.2 - np.log2(span_km / 3), 10.5, 14)), 1)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id")
    ap.add_argument("--name"), ap.add_argument("--city"), ap.add_argument("--bbox", help="w,s,e,n")
    ap.add_argument("--start"), ap.add_argument("--end"), ap.add_argument("--default-t", dest="default_t")
    ap.add_argument("--stn", type=int), ap.add_argument("--wfo", help="comma-separated NWS offices, e.g. OKX")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    E, p = spec(a)
    E["replay"].setdefault("default_t", a.default_t or E["replay"]["start"])
    if a.default_t:
        E["replay"]["default_t"] = a.default_t
    E.setdefault("map_view", view(E, []))
    save(E, p)
    E = events.get(a.id)
    d, need = E["dir"], lambda f: a.force or not (E["dir"] / f).exists()

    if need("graph.graphml.gz") and not (d / "graph.graphml").exists():
        build_graph.build(E)
    if need("alerts.geojson"):
        fetch_alerts.fetch(E)
    if need("dem_5m.npz"):
        build_dem.main(E)
    hs = None
    if need("survey_observations.json") or need("inferred_observations.json"):
        hs = survey_layer.marks(E)
        src = {}
        for h in hs:
            k = (h.get("peak_source") or {}).get("source", "none")
            src[k] = src.get(k, 0) + 1
        print(f"{len(hs)} usable marks; peak timing sources: {src}")
    survey = survey_layer.main(E, hs) if need("survey_observations.json") else json.loads((d / "survey_observations.json").read_text())
    inferred = infer_replay.main(E, hs) if need("inferred_observations.json") else json.loads((d / "inferred_observations.json").read_text())

    if not a.default_t and E["replay"]["default_t"] == E["replay"]["start"] and survey:  # open on the most common peak time
        times = sorted(o["time"] for o in survey)
        E["replay"]["default_t"] = max(set(times), key=times.count)
    E["map_view"] = view(E, survey + inferred)
    timing = sorted({(o.get("provenance") or {}).get("peak_time", {}).get("source") for o in survey} - {None})
    credits = BASE_CREDITS + [f"NWS flood warnings ({', '.join(E['wfo'])}) via Iowa Environmental Mesonet (public domain)"]
    if "stream_gauge" in timing:
        credits.append("USGS NWIS instantaneous stream gauge data, used for peak timing (public domain)")
    if "rainfall_peak" in timing:
        credits.append("IEM IEMRE hourly rainfall reanalysis (Iowa Environmental Mesonet), used for peak timing")
    E["credits"] = list(dict.fromkeys(credits + E.get("credits", [])))
    save(E, p)
    size = sum(f.stat().st_size for f in d.iterdir() if f.is_file()) / 1e6
    print(f"{E['id']}: {len(survey)} survey obs on {len({o['edge_id'] for o in survey})} streets, {len(inferred)} inferred obs on "
          f"{len({o['edge_id'] for o in inferred})} streets; timing {timing}; default_t {E['replay']['default_t']}; "
          f"view {E['map_view']}; {size:.1f} MB on disk")


if __name__ == "__main__":
    main()
