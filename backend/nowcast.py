"""Stream B (nowcast). CONTRACT, frozen 2026-09-27: GET /risk?t=&session= -> FeatureCollection of LineStrings with
properties {edge_id, name, risk: 0..1, band: "elevated"|"high", drivers: {rain_3h_mm, depression_cm, hand_m}}.
Uses only data <= t. Separate from /segments: never blocks routes, never says dry; routes may add a warning.

Formula (transparent; eval and fit in scripts/eval_nowcast.py -> eval/results/nowcast.json):
  terrain = percentile among all scored edges of  W.bias + W.depression*log1p(depression_cm) + W.hand*hand_m   (fitted, logistic)
  rain    = clip(max(rain_1h/RAIN_REF_MM[1], rain_3h/RAIN_REF_MM[3], rain_6h/RAIN_REF_MM[6]), 0, 1)       (design rule, NOT fitted)
  risk    = terrain * rain
  rain_Nh: IEMRE hourly rain (data/cache/events/harvey2017/rain.json) in the N hours ending at or before t, bilinear to the edge's
  low point. depression_cm, hand_m: static terrain (data/cache/events/harvey2017/nowcast_static.npz, scripts/build_nowcast_features.py);
  hand_m is clipped to [HAND_MIN_M, HAND_MAX_M] and no river/canal within 2 km counts as HAND_MAX_M.
Why rain is not fitted: every flooded-street label carries a Sep 1-2 USGS peak time, so labels have no timing to fit rain
against, and the fitted rain weights came out 0 (the IEMRE grid is ~12 km, so rain barely varies across the bbox).
Bands: risk >= ELEVATED -> "elevated", >= HIGH -> "high" (terrain in the top 10% / 2% of edges under reference rain).
Everything else is absent: absence means "no nowcast signal", never dry or safe. The session parameter is accepted but
unused (rain and terrain are global). Outside the rain cache (live mode) the collection is empty and says so in "note"
and the X-Waterline-Note header.
"""
import json, math
from datetime import datetime, timedelta, timezone
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from . import events

router = APIRouter()

# Fitted on all Harvey edges by scripts/eval_nowcast.py ("production" in eval/results/nowcast.json). Signs constrained:
# depression can only raise risk, height above drainage can only lower it.
W = {"bias": -2.9781, "depression": 0.0632, "hand": -0.0346}
# ~1, 2 and 3 in: heavy enough to overwhelm Houston street drainage (a design choice, see module docstring)
RAIN_REF_MM = {1: 25.0, 3: 50.0, 6: 75.0}
ELEVATED, HIGH = 0.90, 0.98
HAND_MIN_M, HAND_MAX_M = -2.0, 20.0
LIVE_NOTE = "live rain not wired yet: the nowcast covers the Harvey replay only (rain cached Aug 25 - Sep 3 2017)"

_M = None  # lazily loaded model inputs; tests may assign one


def _ts(t):
    d = datetime.fromisoformat(t.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


class Inputs:
    """Per-edge static arrays + the rain grid, precomputed so risk_at() is a few vectorised ops."""

    def __init__(self, static, rain, w=None):
        self.ids = [str(x) for x in static["edge_id"]]
        lon, lat = np.asarray(static["lon"], float), np.asarray(static["lat"], float)
        self.valid = ~np.asarray(static["skip"], bool) & ~np.isnan(lon)
        self.dep_cm = np.nan_to_num(np.asarray(static["depression_cm"], float), nan=0.0).clip(0)
        self.hand_m = np.asarray(static["hand_cm"], float) / 100  # NaN = no river/canal within 2 km (reported as null)
        self.x_dep = np.log1p(self.dep_cm)
        self.x_hand = np.nan_to_num(self.hand_m, nan=HAND_MAX_M).clip(HAND_MIN_M, HAND_MAX_M)
        self.set_weights(w or W)
        self.t0, self.hours = _ts(rain["t0"]), int(rain["hours"])
        self.mm = np.array(rain["mm"], float)  # (points, hours); hour h ends at t0 + (h+1) h
        lons, lats = np.array(rain["lons"]), np.array(rain["lats"])
        # bilinear weights from the regular grid to each edge's low point: (edges, points)
        fx = np.nan_to_num((lon - lons[0]) / (lons[-1] - lons[0]) * (len(lons) - 1)).clip(0, len(lons) - 1 - 1e-9)
        fy = np.nan_to_num((lat - lats[0]) / (lats[-1] - lats[0]) * (len(lats) - 1)).clip(0, len(lats) - 1 - 1e-9)
        ix, iy = fx.astype(int), fy.astype(int)
        ax, ay = fx - ix, fy - iy
        self.B = np.zeros((len(lon), len(lons) * len(lats)), np.float32)
        rows = np.arange(len(lon))
        for dy, dx, wgt in ((0, 0, (1 - ay) * (1 - ax)), (0, 1, (1 - ay) * ax), (1, 0, ay * (1 - ax)), (1, 1, ay * ax)):
            np.add.at(self.B, (rows, (iy + dy) * len(lons) + ix + dx), wgt)

    def logit(self, w):
        return w["bias"] + w["depression"] * self.x_dep + w["hand"] * self.x_hand

    def set_weights(self, w):
        """terrain = percentile (0..1] of the terrain logit among valid edges; invalid edges get 0."""
        z = self.logit(w)
        ref = np.sort(z[self.valid])
        self.terrain = np.where(self.valid, np.searchsorted(ref, z, side="right") / len(ref), 0.0)

    def hours_before(self, t):
        """Number of cached hours that ended at or before t, or None when t is outside the cache."""
        e = math.floor((t - self.t0) / timedelta(hours=1))
        return e if 6 <= e <= self.hours else None

    def rain(self, e):
        """Per-edge 1, 3, 6 h accumulations (mm) from the hours ending at or before t (e = hours_before(t))."""
        acc = np.stack([np.nansum(self.mm[:, e - k:e], axis=1) for k in (1, 3, 6)], 1)  # (points, 3)
        return self.B @ acc  # (edges, 3)

    @staticmethod
    def rain_factor(r):
        return np.clip(np.max(r / np.array([RAIN_REF_MM[1], RAIN_REF_MM[3], RAIN_REF_MM[6]]), axis=1), 0, 1)

    def score(self, r):
        return self.terrain * self.rain_factor(r)


def inputs():
    global _M
    if _M is None:
        d = events.get(events.DEFAULT)["dir"]  # fitted and cached for Harvey only
        _M = Inputs(np.load(d / "nowcast_static.npz"), json.loads((d / "rain.json").read_text()))
    return _M


def risk_at(t):
    """(edge indices, risk, band, rain per edge) for the edges flagged at t, or None outside the rain cache."""
    M = inputs()
    e = M.hours_before(t)
    if e is None:
        return None
    r = M.rain(e)
    p = M.score(r)
    keep = np.flatnonzero(M.valid & (p >= ELEVATED))
    return keep, p[keep], np.where(p[keep] >= HIGH, "high", "elevated"), r[keep]


_GEOM = {}  # edge_id -> GeoJSON geometry, built once per edge


EVENT_NOTE = "The flood-risk nowcast was fitted and cached for the Harvey replay only."
DISABLED_NOTE = "Flood-risk nowcast is off: in evaluation it did not beat a terrain-only baseline (eval/results/nowcast.json)."


@router.get("/risk")
def risk(t: str | None = None, session: str | None = None, event: str | None = None):
    from .profiles import NOWCAST_ENABLED
    if not NOWCAST_ENABLED:
        return JSONResponse({"type": "FeatureCollection", "features": [], "note": DISABLED_NOTE}, headers={"X-Waterline-Note": DISABLED_NOTE})
    E = events.get(event)
    if E["id"] != events.DEFAULT:
        return JSONResponse({"type": "FeatureCollection", "features": [], "note": EVENT_NOTE}, headers={"X-Waterline-Note": EVENT_NOTE})
    try:
        when = _ts(t or E["replay"]["default_t"])
    except ValueError:
        raise HTTPException(400, "t must be ISO-8601")
    out = risk_at(when)
    if out is None:
        return JSONResponse({"type": "FeatureCollection", "features": [], "note": LIVE_NOTE}, headers={"X-Waterline-Note": LIVE_NOTE})
    from shapely.geometry import mapping
    from .terrain import roads  # shares the API's cached graph
    R, M = roads(), inputs()
    feats = []
    for j, p, band, r in zip(*out):
        eid = M.ids[j]
        if eid not in R.edges:
            continue
        g = _GEOM.get(eid) or _GEOM.setdefault(eid, mapping(R.edges[eid][3]))
        h = M.hand_m[j]
        feats.append({"type": "Feature", "geometry": g, "properties": {
            "edge_id": eid, "name": R.edges[eid][4], "risk": math.floor(float(p) * 1000) / 1000,  # floor: the shown value never crosses a band edge
            "band": str(band),
            "drivers": {"rain_3h_mm": round(float(r[1]), 1), "depression_cm": round(float(M.dep_cm[j])),
                        "hand_m": None if np.isnan(h) else round(float(h), 1)}}})
    return JSONResponse({"type": "FeatureCollection", "features": feats})  # skips jsonable_encoder: thousands of features
