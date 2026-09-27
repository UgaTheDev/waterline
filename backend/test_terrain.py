"""Terrain inference invariants on a synthetic DEM. Run: .venv/bin/python -m backend.test_terrain"""
import time
import networkx as nx
import numpy as np
from . import terrain
from .router import Roads

W, S, E, N = -95.415, 29.69, -95.385, 29.71
LAT = 29.70


def setup():
    rows, cols = 443, 580  # ~5 m cells
    z = np.full((rows, cols), 1000, np.int16)  # flat ground 10 m NAVD88
    D = terrain.Dem(z, [W, S, E, N])
    c = lambda lon: int((lon - W) / D.dx)
    z[:, c(-95.3960):c(-95.3955)] = 2000  # N-S ridge east of the report
    r = lambda lat: int((N - lat) / D.dy)
    z[r(LAT + 0.0025):r(LAT - 0.0025), c(-95.4025):c(-95.4015)] = 1030  # knoll: below z_high, above z_mid
    z[r(LAT + 0.0002):r(LAT - 0.0002), c(-95.4032):c(-95.4028)] = 950  # dip on the west street
    terrain.DEM = terrain.Dem(z, [W, S, E, N])
    G = nx.MultiDiGraph()
    streets = {"SRC": -95.4000, "WEST": -95.4030, "KNOLL": -95.4020, "BRIDGE": -95.4010, "EAST": -95.3935, "FAR": -95.4100}
    for name, lon in streets.items():
        G.add_node(name + "a", x=lon, y=LAT - 0.002)
        G.add_node(name + "b", x=lon, y=LAT + 0.002)
        G.add_edge(name + "a", name + "b", 0, length=440, name=name, **({"bridge": "yes"} if name == "BRIDGE" else {}))
    terrain.ROADS = Roads(G)


def src(**kw):
    return {"obs_id": "p1", "edge_id": "SRCa-SRCb-0", "time": "2017-08-28T06:00:00Z", "lat": LAT, "lon": -95.4000, "status": "ok",
            "depth_cm": 20, "low_cm": 10, "high_cm": 40, "confidence": 0.6, "half_life_min": 45, "session_id": "s1", "kind": "photo", **kw}


def test_terrain():
    setup()
    t = time.time()
    out = terrain.infer(src())
    assert time.time() - t < 1, "must run in under 1 s per report"
    names = {terrain.ROADS.edges[o["edge_id"]][4] for o in out}
    assert "WEST" in names and "SRC" in names, names
    assert "EAST" not in names, "a ridge above the water surface blocks spread"
    assert "FAR" not in names, "radius cap"
    assert "BRIDGE" not in names, "bridges are excluded"
    assert "KNOLL" not in names, "ground above the water surface: skipped, never depth 0"
    west = next(o for o in out if o["edge_id"].startswith("WEST"))
    assert abs(west["depth_cm"] - 70) < 1, west  # surface 1020 - dip 950
    for o in out:
        assert o["depth_cm"] > 0 and o["high_cm"] >= o["depth_cm"] >= o["low_cm"] >= 0, o
        assert o["confidence"] < 0.6, "confidence stays below the source's"
        assert o["kind"] == "inferred" and o["provenance"] == {"method": "terrain-v1", "derived_from": ["p1"]}
        assert (o["time"], o["half_life_min"], o["session_id"]) == ("2017-08-28T06:00:00Z", 45, "s1")
        assert o["status"] == "ok", "never dry, never unknown"
    far = max(out, key=lambda o: float(o["reference"].split(" m away")[0].rsplit(" ", 1)[1]))
    near = next(o for o in out if o["edge_id"].startswith("SRC"))
    assert far["high_cm"] - far["depth_cm"] >= near["high_cm"] - near["depth_cm"] and far["confidence"] <= near["confidence"], "bounds widen with distance"
    assert terrain.infer(west) == [], "never infer from an inferred observation"
    assert terrain.infer(src(kind="survey")) == []
    assert terrain.infer(src(depth_cm=0)) == [] and terrain.infer(src(status="unknown", depth_cm=None, high_cm=None)) == []
    assert terrain.infer(src(edge_id="BRIDGEa-BRIDGEb-0", lon=-95.4010)) == [], "water on a deck says nothing about the ground"


if __name__ == "__main__":
    test_terrain()
    print("terrain ok")
