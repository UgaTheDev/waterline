"""Stream A (terrain inference). CONTRACT, frozen 2026-09-27: do not change the signature.

infer(obs) -> list of inferred observations derived from one observed report:
  water surface = road ground elevation (3DEP) + obs depth; flood connected lower terrain; for each road edge reached,
  depth = surface - edge ground. Each returned dict is a normal observation with kind="inferred",
  provenance={"method": "terrain-v1", "derived_from": [obs["obs_id"]]}, the source's time/half_life_min/session_id,
  lower confidence than the source, and bounds that widen with distance. Rules: additive only (never depth 0, never
  "dry"), never for kind in {"inferred", "survey"} sources unless the stream owner decides otherwise, bridges excluded.
Replay inferences are precomputed into data/cache/events/<id>/inferred_observations.json (loaded by store.Store).
Multi-event: the DEM and road graph are the ones of obs["event"] (default event when absent), via backend/events.py.

Stream owner decision: "survey" rows are skipped here; scripts/infer_replay.py seeds from the USGS marks' surveyed
water surface directly instead (more exact than survey rows, which already subtract DEM ground).
DEM: data/cache/events/<id>/dem_5m.npz from scripts/build_dem.py, NAVD88 int16 centimetres. All elevations here are NAVD88 cm.
"""
import math
import os
import numpy as np
from scipy import ndimage
from shapely.geometry import Point

RADIUS_M = 800
# Bathtub fails on slopes: every downhill cell is "connected and below" a seed on higher ground, so a shallow report
# up a slope would flood the whole valley. Spread only over ground at most MAX_DROP_CM below the seed's own ground.
MAX_DROP_CM = float(os.getenv("TERRAIN_MAX_DROP_CM", "300"))
SIGMA0_CM = 10         # DEM error at the edge's low point (3DEP 1 m resampled to 5 m)
SLOPE_CM_PER_M = 0.05  # water-surface slope allowance: 50 cm per km from the source, see eval/results/terrain_loo.json
CONF_FACTOR = 0.8      # at the source; halves every RADIUS_M, so always below the source's confidence
SKIP_KINDS = {"inferred", "survey"}
# Deeper than this, the "road" low point is a bayou channel bed under the edge (seen up to 9 m in the LOO run), not street water.
MAX_INFERRED_CM = 300

DEM = None    # test override: a synthetic Dem used for every event. None = the event's DEM (backend/events.py LRU)
ROADS = None  # test override: a Roads used for every event. None = the event's road graph


class Dem:
    def __init__(self, z_cm, bbox):
        self.z = np.where(z_cm == -32768, np.nan, z_cm).astype(np.float32)  # NAVD88 cm
        self.w, self.s, self.e, self.n = map(float, bbox)
        self.rows, self.cols = self.z.shape
        self.dx, self.dy = (self.e - self.w) / self.cols, (self.n - self.s) / self.rows
        lat0 = (self.s + self.n) / 2
        self.mx, self.my = self.dx * 111320 * math.cos(math.radians(lat0)), self.dy * 110540  # cell size, metres

    def cell(self, lon, lat):
        return (np.floor((self.n - np.asarray(lat)) / self.dy).astype(int), np.floor((np.asarray(lon) - self.w) / self.dx).astype(int))

    def ground(self, lon, lat):
        r, c = self.cell(lon, lat)
        return float(self.z[r, c]) if 0 <= r < self.rows and 0 <= c < self.cols else math.nan


def dem(event=None):
    from . import events
    return DEM if DEM is not None else events.load(event, "dem")


def roads(event=None):
    from . import events  # shared with the API: one cached graph per event
    return ROADS if ROADS is not None else events.load(event, "roads")


def flood(lon, lat, z_high, event=None):
    """Connected DEM cells below z_high (NAVD88 cm) containing (lon, lat), within RADIUS_M.
    Returns (r0, c0, component bool window, distance-from-seed metres window) or None."""
    D = dem(event)
    r, c = (int(v) for v in D.cell(lon, lat))
    hr, hc = int(RADIUS_M / D.my) + 1, int(RADIUS_M / D.mx) + 1
    r0, c0 = max(0, r - hr), max(0, c - hc)
    z = D.z[r0:r + hr + 1, c0:c + hc + 1]
    if not (0 <= r - r0 < z.shape[0] and 0 <= c - c0 < z.shape[1]):
        return None  # outside the DEM
    rr, cc = np.ogrid[r0 - r:r0 - r + z.shape[0], c0 - c:c0 - c + z.shape[1]]
    dist = np.hypot(rr * D.my, cc * D.mx)
    floor = z[r - r0, c - c0] - MAX_DROP_CM if not np.isnan(z[r - r0, c - c0]) else -np.inf
    lab, _ = ndimage.label((z < z_high) & (z >= floor) & (dist <= RADIUS_M), structure=np.ones((3, 3)))  # 8-connected: wetter
    ids = lab[r - r0, c - c0] or lab[max(0, r - r0 - 2):r - r0 + 3, max(0, c - c0 - 2):c - c0 + 3].max()  # seed, or a cell ~10 m away
    return (r0, c0, lab == ids, dist) if ids else None


def _bridge(d):
    return any(d.get(k) not in (None, "", "no", False) for k in ("bridge", "tunnel"))


def spread(lon, lat, z_mid, z_high, z_low, src, reference, credit="USGS 3DEP elevation (public domain) + nearby report"):
    """Inferred observations for every road edge flooded from a water surface z_mid (upper bound z_high) at (lon, lat)."""
    ev = src.get("event")
    f = flood(lon, lat, z_high, ev)
    if f is None:
        return []
    r0, c0, comp, dist = f
    D, R = dem(ev), roads(ev)
    out = []
    for j in R.tree.query(Point(*R.to_m(lon, lat)).buffer(RADIUS_M)):
        eid = R.ids[int(j)]
        u, v, k, geom, name, _ = R.edges[eid]
        if _bridge(R.G[u][v][k]):
            continue  # bare-earth DEM is the ground under the deck, not the deck
        xy = np.asarray(geom.coords)
        seg = np.hypot(*(np.diff(np.column_stack(R.to_m(xy[:, 0], xy[:, 1])), axis=0).T))
        pts = [xy[:1]] + [xy[i] + np.outer(np.linspace(0, 1, max(1, int(L // 2.5)) + 1)[1:], xy[i + 1] - xy[i]) for i, L in enumerate(seg)]
        p = np.vstack(pts)
        rr, cc = D.cell(p[:, 0], p[:, 1])
        rr, cc = rr - r0, cc - c0
        ok = (rr >= 0) & (rr < comp.shape[0]) & (cc >= 0) & (cc < comp.shape[1])
        rr, cc, p = rr[ok], cc[ok], p[ok]
        inside = comp[rr, cc]
        if not inside.any():
            continue
        g = D.z[r0 + rr[inside], c0 + cc[inside]]
        i = int(np.nanargmin(g))
        g_edge, d = float(g[i]), float(dist[rr[inside][i], cc[inside][i]])
        depth = z_mid - g_edge
        if not depth > 0:
            continue  # above the water surface: skip, never claim dry
        if depth > MAX_INFERRED_CM:
            continue
        sigma = SIGMA0_CM + SLOPE_CM_PER_M * d
        conf = (src.get("confidence") or 0.5) * CONF_FACTOR * 0.5 ** (d / RADIUS_M)
        lo, la = p[inside][i]
        out.append({"obs_id": f"inf-{src['obs_id']}-{eid}", "edge_id": eid, "time": src["time"], "lat": round(float(la), 6), "lon": round(float(lo), 6),
                    "status": "ok", "depth_cm": round(depth, 1), "low_cm": round(max(0.0, z_low - g_edge - sigma), 1),
                    "high_cm": round(z_high - g_edge + sigma, 1), "confidence": round(conf, 3),
                    "half_life_min": src.get("half_life_min"), "session_id": src.get("session_id"), "kind": "inferred", "event": ev,
                    "provenance": {"method": "terrain-v1", "derived_from": [src["obs_id"]]},
                    "reference": f"Inferred from {reference} {round(d)} m away + terrain",
                    "rationale": f"Water surface {z_mid / 30.48:.1f} ft (NAVD88) spread over connected lower ground; lowest road ground here {g_edge / 30.48:.1f} ft.",
                    "credit": credit, "image_url": None, "precision": "inferred"})
    return out


def infer(obs):
    if obs.get("kind") in SKIP_KINDS or obs.get("status") != "ok" or not (obs.get("depth_cm") or 0) > 0 or obs.get("high_cm") is None:
        return []
    R = roads(obs.get("event"))
    eid = obs.get("edge_id")
    if eid not in R.edges or _bridge(R.G[R.edges[eid][0]][R.edges[eid][1]][R.edges[eid][2]]):
        return []  # water on a deck says nothing about the terrain under it
    geom = R.edges[eid][3]
    q = geom.interpolate(geom.project(Point(obs["lon"], obs["lat"])))  # report's spot on its road
    g = dem(obs.get("event")).ground(q.x, q.y)
    if math.isnan(g):
        return []
    return spread(q.x, q.y, g + obs["depth_cm"], g + obs["high_cm"], g + (obs.get("low_cm") or 0), obs, "a report")
