"""Multi-event invariants. Run: .venv/bin/python -m backend.test_events"""
import os, tempfile
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")  # never touch the real uploads db
import networkx as nx
from fastapi.testclient import TestClient
from . import events
from .router import Roads

IDA = "ida2021"


def _in(bbox, feats):
    w, s, e, n = bbox
    pad = 0.01  # OSM ways clipped by the bbox query can end just past it
    return all(w - pad <= x <= e + pad and s - pad <= y <= n + pad for f in feats for x, y in f["geometry"]["coordinates"])


def test_lru_evicts():
    """Synthetic events and graphs: the least recently used event is dropped, graph and DEM together."""
    saved = (events._REG, dict(events.LOADERS), events.MAX_LOADED, list(events._loaded.items()))
    built = []

    def fake_roads(e):
        G = nx.MultiDiGraph()
        G.add_node(1, x=e["bbox"][0], y=e["bbox"][1]); G.add_node(2, x=e["bbox"][2], y=e["bbox"][3])
        G.add_edge(1, 2, 0, length=100, name=f"{e['id']} St")
        built.append(e["id"])
        return Roads(G)
    try:
        events._REG = {k: {"id": k, "bbox": [i, 0, i + 0.001, 0.001]} for i, k in enumerate(("a1", "b2", "c3"))}
        events.LOADERS.update(roads=fake_roads, dem=lambda e: ("dem", e["id"]))
        events.MAX_LOADED = 2
        events._loaded.clear()
        ra = events.load("a1", "roads")
        events.load("b2", "roads")
        assert events.load("a1", "roads") is ra and built == ["a1", "b2"], "a hit must not reload"
        events.load("a1", "dem")  # same entry: DEM rides with its event
        events.load("c3", "roads")  # third event: b2 is least recently used
        assert events.loaded() == ["a1", "c3"], events.loaded()
        events.load("b2", "roads")
        assert built == ["a1", "b2", "c3", "b2"] and events.loaded() == ["c3", "b2"], (built, events.loaded())
        assert events.for_point(0.0005, 2.0005) == "c3" and events.for_point(50, 50) is None
    finally:
        events._REG, events.MAX_LOADED = saved[0], saved[2]
        events.LOADERS.clear(); events.LOADERS.update(saved[1])
        events._loaded.clear(); events._loaded.update(saved[3])


def test_api():
    if IDA not in events.registry():
        print("SKIP", "test_api", "(ida2021 not built yet: python -m scripts.add_event ida2021)")
        return
    from . import app as A
    c = TestClient(A.app)
    ev = {e["id"]: e for e in c.get("/events").json()}
    assert {"harvey2017", IDA} <= set(ev), ev
    assert set(ev[IDA]) == {"id", "name", "city", "replay", "center", "zoom"}
    assert c.get("/config").json()["event"] == "Hurricane Harvey (2017)", "no event param: Harvey"
    assert c.get("/config", params={"event": IDA}).json()["city"] == events.get(IDA)["city"]
    assert c.get("/segments", params={"event": "nope"}).status_code == 400, "unknown event is an error, not Harvey"

    H, I = events.get(), events.get(IDA)
    harvey = c.get("/segments").json()["features"]
    assert harvey and harvey == c.get("/segments", params={"event": "harvey2017"}).json()["features"], "Harvey default unchanged"
    assert _in(H["bbox"], harvey)
    ida = c.get("/segments", params={"event": IDA, "t": I["replay"]["default_t"]}).json()["features"]
    assert ida and _in(I["bbox"], ida), "Ida segments are Ida streets only"
    assert not {f["properties"]["edge_id"] for f in ida} & {f["properties"]["edge_id"] for f in harvey}

    # live reports: geolocated to the event whose bbox contains them, otherwise rejected
    rep = {"depth_cm": 50, "low_cm": 25, "high_cm": 75, "confidence": 0.35}
    assert "error" in A._file_report(41.5, -80.0, None, None, "voice", rep), "outside every bbox must be rejected"
    assert A._ingest(41.5, -80.0, None, None) is None
    lat, lon = (I["bbox"][1] + I["bbox"][3]) / 2, (I["bbox"][0] + I["bbox"][2]) / 2
    placed = A._ingest(lat, lon, None, None, "harvey2017")
    assert placed and placed[0] == IDA and placed[2] is None, "a live report in NYC belongs to Ida, whatever is being viewed"
    # a replay-time report carries the viewed event and must be inside its bbox
    S, T = "dddddddd-4444", I["replay"]["default_t"]
    assert A._ingest(lat, lon, T, S, IDA)[:1] == (IDA,) and A._ingest(29.75, -95.4, T, S, IDA) is None
    r = c.post("/upload", files={"file": ("p.jpg", b"\xff\xd8\xff" + b"\x00" * 64, "image/jpeg")}, data={"lat": 41.5, "lon": -80.0})
    assert r.status_code == 422 and "outside the coverage area" in r.json()["detail"], r.text


def test_ida_peak_provenance():
    if IDA not in events.registry():
        print("SKIP", "test_ida_peak_provenance", "(ida2021 not built yet: python -m scripts.add_event ida2021)")
        return
    from .store import Store
    obs = Store().replay[IDA]
    kinds = {o["kind"] for o in obs}
    assert obs and "survey" in kinds, kinds
    for o in obs:
        pt = (o.get("provenance") or {}).get("peak_time") or {}
        assert pt.get("source") in ("usgs_peak_summary", "stream_gauge", "rainfall_peak"), o["obs_id"]
        assert "peak time estimated" in o["rationale"], o["rationale"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)


def test_survey_routing_gate():
    """A survey layer routes only when its event's validation shows 0 street-level sedan misses."""
    import json, tempfile, pathlib as pl
    from backend import events as ev
    assert ev.survey_routes(ev.get("harvey2017")), "Harvey validated 0/25: survey routes"
    assert not ev.survey_routes({"id": "no_such_event_xyz"}), "unvalidated: display-only"
    ida = ev.registry(include_incomplete=True).get("ida2021")
    if ida:
        assert not ev.survey_routes(ida), "Ida 5/63 street-level misses: display-only"
    print("ok test_survey_routing_gate")


if __name__ == "__main__":
    test_survey_routing_gate()
