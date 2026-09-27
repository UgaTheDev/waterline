"""Precompute terrain inference over the replay: data/cache/inferred_observations.json (loaded by backend/store.py).

Seeds: every USGS STN high-water mark in BBOX (event 180, NAVD88, quality <= 4, with a USGS peak time): its surveyed
water surface elev_ft (NAVD88 feet) is spread directly over connected lower terrain (backend/terrain.spread). Plus any
photo replay observations in data/cache/replay_observations.json, through terrain.infer.
    python -m scripts.infer_replay
"""
import json, urllib.request
from backend import terrain
from backend.profiles import BBOX, CACHE
from scripts.survey_layer import STN, NAVD88, MAX_QUALITY, QUALITY_FT, FT

UA = {"User-Agent": "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return json.loads(r.read())


def hwms(peaks=True):
    """Usable bbox marks; with peaks=True each gets 'peak' (USGS peak time, UTC) or None."""
    w, s, e, n = BBOX
    hs = [h for h in get(f"{STN}/Events/180/HWMs.json") if s <= h["latitude_dd"] <= n and w <= h["longitude_dd"] <= e
          and h.get("elev_ft") and h.get("vdatum_id") == NAVD88 and (h.get("hwm_quality_id") or 9) <= MAX_QUALITY
          and h.get("hwm_type_id") != 9]  # type 9 = USACE daily tape-downs of the RECEDING bayou (Sep 9-16), not peaks
    cache = {}
    for h in hs if peaks else ():
        pid = h.get("peak_summary_id")
        if pid and pid not in cache:
            try:
                cache[pid] = get(f"{STN}/PeakSummaries/{pid}.json").get("peak_date")
            except Exception:
                cache[pid] = None
        h["peak"] = cache.get(pid)
    return hs


def seed(h):
    """(lon, lat, z_mid, z_high, z_low, src) for a mark. NAVD88 cm. The band is the mark's survey quality + DEM error;
    terrain.spread adds the distance/slope allowance."""
    z, q = h["elev_ft"] * FT, QUALITY_FT[h["hwm_quality_id"]] * FT + terrain.SIGMA0_CM
    src = {"obs_id": f"usgs-hwm-{h['hwm_id']}", "time": (h.get("peak") or "")[:19] + "Z", "confidence": 0.7, "half_life_min": 720}
    return h["longitude_dd"], h["latitude_dd"], z, z + q, z - q, src


def main():
    out = []
    marks = [h for h in hwms() if h.get("peak")]  # no timing: can't place it in the replay honestly
    for h in marks:
        lon, lat, zm, zh, zl, src = seed(h)
        out += terrain.spread(lon, lat, zm, zh, zl, src, f"USGS high-water mark #{h['hwm_id']}",
                              "USGS 3DEP elevation + USGS Short-Term Network high-water marks, public domain")
    photos = CACHE / "replay_observations.json"
    n_photo = 0
    if photos.exists():
        for o in json.loads(photos.read_text()):
            inf = terrain.infer(o)
            n_photo += bool(inf)
            out += inf
    p = CACHE / "inferred_observations.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(marks)} marks + {n_photo} photo seeds -> {len(out)} inferred observations on {len({o['edge_id'] for o in out})} "
          f"road segments, {p.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
