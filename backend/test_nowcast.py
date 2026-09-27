"""Nowcast invariants on the real Harvey caches. Run: .venv/bin/python -m backend.test_nowcast"""
import time
from datetime import timedelta
import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from . import nowcast
from .nowcast import _ts

PEAK = "2017-08-27T06:00:00Z"  # heaviest rain in the cache


def test_no_future_leak():
    M = nowcast.inputs()
    for t in ("2017-08-26T12:00:00Z", PEAK, "2017-08-27T06:30:00Z", "2017-08-29T00:00:00Z"):
        e = M.hours_before(_ts(t))
        rain, before = M.rain(e), M.score(M.rain(e))
        saved = M.mm.copy()
        try:
            M.mm[:, e:] = 500.0  # rewrite every hour that ends after t
            assert np.array_equal(M.rain(e), rain) and np.array_equal(M.score(M.rain(e)), before), f"rain after {t} leaked into {t}"
            M.mm[:, e - 1] += 50.0  # ...while the hour ending at t does count
            assert (M.rain(e) > rain).all(), "the last hour before t must count"
        finally:
            M.mm[:] = saved
    # hour h ends at t0 + (h+1) h: at exactly that instant it counts, a second earlier it does not
    t = M.t0 + timedelta(hours=10)
    assert M.hours_before(t) == 10 and M.hours_before(t - timedelta(seconds=1)) == 9


def test_endpoint():
    app = FastAPI()
    app.include_router(nowcast.router)
    c = TestClient(app)
    r = c.get("/risk", params={"t": PEAK, "session": "abc"})
    assert r.status_code == 200
    fc = r.json()
    assert fc["type"] == "FeatureCollection" and fc["features"], "heavy rain should flag something"
    bands = set()
    for f in fc["features"]:
        assert f["type"] == "Feature" and f["geometry"]["type"] == "LineString"
        p = f["properties"]
        assert set(p) == {"edge_id", "name", "risk", "band", "drivers"}, p
        assert set(p["drivers"]) == {"rain_3h_mm", "depression_cm", "hand_m"}, p
        assert 0 <= p["risk"] <= 1 and p["risk"] >= nowcast.ELEVATED
        assert p["band"] in ("elevated", "high"), "never low / dry / safe"
        assert p["band"] == ("high" if p["risk"] >= nowcast.HIGH else "elevated")
        assert p["drivers"]["rain_3h_mm"] >= 0 and (p["drivers"]["hand_m"] is None or isinstance(p["drivers"]["hand_m"], float))
        bands.add(p["band"])
    assert bands == {"elevated", "high"}, bands
    t = time.time()
    for _ in range(3):
        c.get("/risk", params={"t": PEAK})
    ms = (time.time() - t) / 3 * 1000
    assert ms < 300, f"/risk took {ms:.0f} ms"
    # no rain in the last 6 h (Sep 1): nothing flagged, and no low/dry labels either
    assert c.get("/risk", params={"t": "2017-09-01T20:00:00Z"}).json()["features"] == []
    # outside the rain cache (live mode): explicitly empty, not faked
    for t in ("2026-09-27T12:00:00Z", "2017-08-20T00:00:00Z"):
        r = c.get("/risk", params={"t": t})
        assert r.status_code == 200 and r.json()["features"] == [] and "not wired" in r.json()["note"]
        assert "not wired" in r.headers["X-Waterline-Note"]
    assert c.get("/risk", params={"t": "nope"}).status_code == 400
    return ms, len(fc["features"]), len(r.content)


if __name__ == "__main__":
    test_no_future_leak()
    ms, n, _ = test_endpoint()
    print(f"nowcast OK ({n} edges flagged at peak rain, {ms:.0f} ms warm)")
