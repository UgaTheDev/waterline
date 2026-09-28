"""Precompute terrain inference over an event's replay: data/cache/events/<id>/inferred_observations.json (loaded by
backend/store.py).

Seeds: every usable USGS STN high-water mark in the event bbox (NAVD88, quality <= 4, with a peak time from
scripts/survey_layer.marks, which records where the time came from): its surveyed water surface elev_ft (NAVD88 feet)
is spread directly over connected lower terrain (backend/terrain.spread). Plus any photo replay observations in
replay_observations.json, through terrain.infer.
    python -m scripts.infer_replay [event_id]          (default harvey2017)
"""
import json
from backend import events, terrain
from scripts.survey_layer import QUALITY_FT, FT, marks, timing_text


def seed(h, event=None):
    """(lon, lat, z_mid, z_high, z_low, src) for a mark. NAVD88 cm. The band is the mark's survey quality + DEM error;
    terrain.spread adds the distance/slope allowance."""
    z, q = h["elev_ft"] * FT, QUALITY_FT[h["hwm_quality_id"]] * FT + terrain.SIGMA0_CM
    src = {"obs_id": f"usgs-hwm-{h['hwm_id']}", "time": (h.get("peak") or "")[:19] + "Z", "confidence": 0.7, "half_life_min": 720, "event": event}
    return h["longitude_dd"], h["latitude_dd"], z, z + q, z - q, src


def main(E, hs=None):
    out = []
    hs = marks(E) if hs is None else hs
    seeded = [h for h in hs if h.get("peak")]  # no timing: can't place it in the replay honestly
    for h in seeded:
        lon, lat, zm, zh, zl, src = seed(h, E["id"])
        for o in terrain.spread(lon, lat, zm, zh, zl, src, f"USGS high-water mark #{h['hwm_id']}",
                                "USGS 3DEP elevation + USGS Short-Term Network high-water marks, public domain"):
            o["provenance"]["peak_time"] = h.get("peak_source")
            o["rationale"] += f" Source mark: {timing_text(h)}."
            out.append(o)
    photos = E["dir"] / "replay_observations.json"
    n_photo = 0
    if photos.exists():
        for o in json.loads(photos.read_text()):
            inf = terrain.infer({**o, "event": E["id"]})
            n_photo += bool(inf)
            out += inf
    p = E["dir"] / "inferred_observations.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(seeded)} marks + {n_photo} photo seeds -> {len(out)} inferred observations on {len({o['edge_id'] for o in out})} "
          f"road segments, {p.stat().st_size / 1e6:.1f} MB")
    return out


if __name__ == "__main__":
    import sys
    main(events.get(sys.argv[1] if len(sys.argv) > 1 else None))
