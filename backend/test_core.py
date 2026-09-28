"""Safety invariants. Run: .venv/bin/python -m backend.test_core"""
import os, tempfile
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")  # never touch the real uploads db
from datetime import datetime, timedelta, timezone
import networkx as nx
from .agent import violates, template
from .depth import finalize, parse
from .fusion import edge_state
from .router import Roads

T0 = datetime(2017, 8, 28, 6, tzinfo=timezone.utc)


def obs(minutes=0, high=40, status="ok", conf=0.8, eid="A-B-0"):
    return {"obs_id": f"o{minutes}{high}", "edge_id": eid, "time": T0 + timedelta(minutes=minutes), "status": status,
            "depth_cm": high * 0.7 if status == "ok" else None, "low_cm": high * 0.5 if status == "ok" else None,
            "high_cm": high if status == "ok" else None, "confidence": conf}


def grid():
    """A-B-C is the short way (200 m); A-D-C the detour (300 m). Two-way streets."""
    G = nx.MultiDiGraph()
    for n, (x, y) in {"A": (0, 0), "B": (0.001, 0), "C": (0.002, 0), "D": (0.001, 0.001)}.items():
        G.add_node(n, x=-95.4 + x, y=29.7 + y)
    for u, v, L in [("A", "B", 100), ("B", "C", 100), ("A", "D", 150), ("D", "C", 150)]:
        G.add_edge(u, v, 0, length=L, name=f"{u}{v} St")
        G.add_edge(v, u, 0, length=L, name=f"{u}{v} St")
    return Roads(G)


def route_names(r):
    return [a["name"] for a in r["avoided"]]


def test_fusion():
    assert edge_state([], T0) is None, "no reports must be unknown"
    assert edge_state([obs(60)], T0) is None, "future observations must not leak into the past"
    s = edge_state([obs()], T0 + timedelta(hours=6))
    assert s["state"] == "stale" and s["high_cm"] == 40, "decayed reports go stale (last-known kept), never dry"
    s = edge_state([obs(0, 50), obs(10, 5)], T0 + timedelta(minutes=15))
    assert s["high_cm"] == 50, "a fresh shallow photo can't erase a fresh deep one"
    assert edge_state([obs(status="unknown")], T0)["state"] == "reported_unknown"


def test_router():
    R, t = grid(), T0
    a, c = (29.7, -95.4), (29.7, -95.398)
    flooded = {"A-B-0": edge_state([obs(high=16)], t), "B-A-0": edge_state([obs(high=16)], t)}
    sedan = R.route(a, c, "sedan", flooded)
    assert sedan["found"] and route_names(sedan) == ["AB St"] and sedan["distance_m"] == 300, sedan
    truck = R.route(a, c, "truck", flooded)
    assert truck["found"] and truck["distance_m"] == 200 and not truck["avoided"], "16 cm is under the truck limit"
    unk = {"A-B-0": edge_state([obs(status="unknown")], t)}
    for v in ("sedan", "truck"):
        assert R.route(a, c, v, unk)["distance_m"] == 300, "water photographed with unreadable depth blocks every vehicle"
    everything = {e: edge_state([obs(high=80, eid=e)], t) for e in R.edges}
    r = R.route(a, c, "sedan", everything)
    assert not r["found"] and "No route" in r["reason"], "no route must never relax the limit"
    assert R.snap(29.7, -95.3995) in ("A-B-0", "B-A-0") and R.snap(29.72, -95.3995) is None


def test_depth_parsing():
    assert finalize(parse("sorry, I can't tell"))["status"] == "unknown"
    assert finalize(parse('{"depth_cm": -5}'))["high_cm"] is None, "invalid output must be unknown, not 0"
    e = finalize(parse('<think>tire...</think>{"water_visible": true, "reference_objects": [{"name": "car tire", '
                       '"typical_height_cm": 65, "water_line_fraction": 0.6}], "depth_cm": 39, "low_cm": 50, "high_cm": 30, '
                       '"confidence": 0.7, "rationale": "x"}'))
    assert (e["low_cm"], e["depth_cm"], e["high_cm"], e["reference"]) == (30, 39, 50, "car tire"), e


def test_wording():
    assert violates("Main St is safe to drive") and violates("You can safely take I-45")
    assert not violates("That road is unsafe.") and not violates("It is not safe.")
    for bad in ["the safest way is Main St", "Main is safer", "s-a-f-e to drive", "It's \u0455afe", "sa\u00adfe route", "Yale St is dry", "the road is clear", "all clear on I-45"]:
        assert violates(bad), bad
    for ok in ["unknown is not dry", "No deep water reported along it", "If you see water, turn around.", "Photo is clear and sharp"]:
        assert not violates(ok), ok
    for r in [None, {"found": False, "reason": "No route avoids reported deep water for a sedan.", "avoided": []},
              {"found": True, "distance_m": 3000, "avoided": [{"name": "Main St", "reason": "reported up to 40 cm"}], "unknown_m": 500, "warnings": []}]:
        assert not violates(template(r)), template(r)
        assert not violates(template(r, "es")), template(r, "es")
    # Spanish: affirmative safety claims are caught, negations are allowed
    for bad in ["La calle Main es segura", "Es seguro manejar por I-45", "Tome esta ruta segura", "Yale St está seco", "La calle está despejada",
                "El camino es transitable", "Puede pasar sin peligro", "Las calles siguen secas", "Es muy seguro", "ES SEGURO"]:
        assert violates(bad), bad
    for ok in ["No es seguro manejar", "La calle no está seca", "No se reporta agua profunda", "Sin reportes no significa seco",
               "¡Dé la vuelta, no se ahogue!", "Esa calle es insegura", "La calle es intransitable", "No estoy seguro de la ubicación"]:
        assert not violates(ok), ok
    assert template(None, "es").startswith("No pude") and "Dé la vuelta" in template({"found": False, "reason": "x", "avoided": []}, "es")


def test_eval_metrics():
    from eval.run_eval import metrics
    ok = lambda true, high: {"true_cm": true, "status": "ok", "depth_cm": high - 5, "low_cm": high - 10, "high_cm": high, "reference": "curb"}
    m = metrics([ok(40, 14), ok(40, 50), {"true_cm": 30, "status": "unknown"}, ok(5, 10)])
    assert m["misses"] == 1 and abs(m["miss_rate"] - 1 / 3) < 1e-9, "only a passable call on deep water is a miss; unknown is blocked"
    assert m["abstain_rate"] == 0.25 and m["false_block_rate"] == 0


def test_voice_mapping():
    from .agent import reached_cm, to_speech
    assert reached_cm("up to my knees") == 50 and reached_cm("over the tire tops") == 65 and reached_cm("ankle deep") == 10
    assert reached_cm("halfway up the car door") == 45 and reached_cm("it's a boat ship") is None and reached_cm("wet") is None
    assert to_speech("**Avoid** Main St: 40 cm, 3.2 km") == "Avoid Main St: 40 centimetres, 3.2 kilometres"
    assert to_speech("Evite Main St: 40 cm, 3.2 km", "es") == "Evite Main St: 40 centímetros, 3.2 kilómetros"
    from .app import _speak_dash, _UPLOAD_MSG
    es = _speak_dash("Yale Street", {"depth_cm": 30, "high_cm": 45}, "sedan", True, "es")
    assert es.startswith("Agua reportada adelante en Yale Street") and "sedán es 15" in es and not violates(es)
    assert _speak_dash("Yale Street", {"depth_cm": 30, "high_cm": 45}, "sedan", True).startswith("Water reported ahead")
    assert _UPLOAD_MSG["es"].keys() == _UPLOAD_MSG["en"].keys()


def test_api_sandbox_and_dashcam():
    """Replay-time reports stay in the filer's session; dry or unreadable dashcam frames file nothing."""
    import io
    from fastapi.testclient import TestClient
    from PIL import Image
    from . import app as A
    c = TestClient(A.app)
    S1, S2, T = "aaaaaaaa-1111", "bbbbbbbb-2222", "2017-08-28T06:00:00Z"
    ev = A._file_report(29.7780, -95.3990, T, S1, "voice", {"depth_cm": 50, "low_cm": 25, "high_cm": 75, "confidence": 0.35})
    assert ev["street"] == "Yale Street", ev
    seen = lambda s: any(f["properties"]["edge_id"] == ev["edge_id"] for f in c.get("/segments", params={"t": T, "session": s}).json()["features"])
    assert seen(S1) and not seen(S2) and not seen(None), "a replay-time report must be visible only to its session"
    buf = io.BytesIO(); Image.new("RGB", (64, 64)).save(buf, "JPEG"); jpg = buf.getvalue()
    post = lambda: c.post("/dashcam", files={"frame": ("f.jpg", jpg, "image/jpeg")}, data={"lat": 29.7780, "lon": -95.3990, "t": T, "session": S1})
    real = A.depth.estimate
    try:
        A.depth.estimate = lambda *a, **k: (_ for _ in ()).throw(ConnectionError())
        assert post().status_code == 503, "model offline must be explicit, never silence"
        A.depth.estimate = lambda *a, **k: {"status": "ok", "water_visible": False, "depth_cm": 0, "low_cm": 0, "high_cm": 3, "confidence": 0.9}
        assert post().json() == {"water": False, "filed": False, "speak": None}, "a dry frame files nothing"
        A.depth.estimate = lambda *a, **k: {"status": "unknown", "high_cm": None}
        assert post().json()["filed"] is False, "an unreadable frame files nothing"
        A.depth.estimate = lambda *a, **k: {"status": "ok", "water_visible": True, "depth_cm": 30, "low_cm": 20, "high_cm": 45,
                                            "confidence": 0.8, "reference": "car tire", "rationale": "x"}
        r = post().json()
        assert r["filed"] and r["over_limit"] and "Rerouting" in r["speak"] and not violates(r["speak"]), r
        assert post().json()["filed"] is False, "same street within 2 min is not re-filed"
    finally:
        A.depth.estimate = real


def test_global_budget():
    from fastapi import HTTPException
    from . import app as A
    A._spend.clear()
    old = A.P.BUDGET_PER_HOUR["chat"]
    A.P.BUDGET_PER_HOUR["chat"] = 2
    try:
        A.budget("chat"); A.budget("chat")
        try:
            A.budget("chat"); raise AssertionError("third call must be refused")
        except HTTPException as e:
            assert e.status_code == 503 and "turn around" in e.detail
    finally:
        A.P.BUDGET_PER_HOUR["chat"] = old
        A._spend.clear()


def test_security_regressions():
    """Findings from the 2026-09-27 adversarial review."""
    import io
    from fastapi.testclient import TestClient
    from PIL import Image
    from . import app as A, depth as D, agent as G
    c = TestClient(A.app)
    # 2. decompression bomb rejected from the header, before decoding
    buf = io.BytesIO(); Image.new("1", (13000, 13000)).save(buf, "PNG")
    try:
        D.prepare_image(buf.getvalue()); raise AssertionError("bomb accepted")
    except ValueError:
        pass
    # 3. a live "depth unknown" report is not cleared by a dry reading; a reading that blocks everything still wins
    assert edge_state([obs(status="unknown"), obs(5, 2)], T0 + timedelta(minutes=10))["state"] == "reported_unknown"
    assert edge_state([obs(status="unknown"), obs(5, 120)], T0 + timedelta(minutes=10))["high_cm"] == 120
    # 9. naive timestamps are UTC, not a 500
    assert c.get("/segments", params={"t": "2017-09-01T20:00:00"}).status_code == 200
    assert c.get("/alerts", params={"t": "2017-09-01T20:00:00"}).status_code == 200
    # 4. list-valued chat content is flattened and capped; oversized bodies refused
    assert c.post("/chat", json={"messages": [{"role": "user", "content": ["x" * 40000]}]}).status_code == 413
    # 5. uploads: mp4 refused without the self-hosted model; a failing file stops retrying; a dry photo files nothing
    mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
    assert c.post("/upload", files={"file": ("v.mp4", mp4, "video/mp4")}, data={"lat": 29.778, "lon": -95.399}).status_code == 415
    jb = io.BytesIO(); Image.new("RGB", (64, 64)).save(jb, "JPEG")
    real = D.estimate
    try:
        D.estimate = lambda *a, **k: (_ for _ in ()).throw(ConnectionError())
        oid = c.post("/upload", files={"file": ("p.jpg", jb.getvalue(), "image/jpeg")}, data={"lat": 29.778, "lon": -95.399}).json()["obs_id"]
        for _ in range(A.MAX_ATTEMPTS + 2):
            A.store.db.execute("UPDATE obs SET queue_state='queued' WHERE obs_id=? AND queue_state='processing'", (oid,))
            A._process(oid)
        assert A.store.get(oid)["queue_state"] == "failed", "a poison file must stop retrying"
        D.estimate = lambda *a, **k: {"status": "ok", "water_visible": False, "depth_cm": 0, "low_cm": 0, "high_cm": 2, "confidence": 0.9, "flags": []}
        oid = c.post("/upload", files={"file": ("p.jpg", jb.getvalue(), "image/jpeg")}, data={"lat": 29.778, "lon": -95.399}).json()["obs_id"]
        v = c.get(f"/upload/{oid}").json()
        assert v["status"] == "rejected" and "no report was filed" in v["message"], v
    finally:
        D.estimate = real
    # 6. per-chat tool budget
    t = G.Tools({"location": None, "vehicle": "sedan", "alerts_fn": lambda: []})
    outs = [t.call("active_alerts", {}) for _ in range(G.Tools.MAX_CALLS + 1)]
    assert "error" in outs[-1] and "error" not in outs[0]
    # 12. non-ASCII responder token is a 401, not a 500
    os.environ["RESPONDER_TOKEN"] = "right-token"
    assert c.get("/responder/queue", headers={"X-Responder-Token": "caf\u00e9".encode("latin-1")}).status_code in (400, 401)


def test_inferred_is_display_only():
    """An inferred-only deep street shows on the map (basis inferred) but never blocks or reroutes."""
    from fastapi.testclient import TestClient
    from . import app as A
    c, S, T = TestClient(A.app), "cccccccc-3333", "2017-08-28T06:00:00Z"
    eid = A.roads().snap(29.7780, -95.3990)
    for tw in A.roads().twin_ids(eid):
        A.store.put({"obs_id": f"inf-test-{tw}", "edge_id": tw, "time": A.ts(T), "lat": 29.778, "lon": -95.399, "status": "ok",
                     "depth_cm": 80, "low_cm": 60, "high_cm": 100, "confidence": 0.3, "kind": "inferred",
                     "provenance": {"method": "terrain-v1", "derived_from": ["x"]}, "queue_state": "done", "session_id": S})
    f = [x for x in c.get("/segments", params={"t": T, "session": S}).json()["features"] if x["properties"]["edge_id"] == eid]
    assert f and f[0]["properties"]["basis"] == "inferred"
    r = c.post("/route", json={"from": {"lat": 29.7765, "lon": -95.3992}, "to": {"lat": 29.7795, "lon": -95.3992},
                               "vehicle": "sedan", "t": T, "session": S}).json()
    assert r["found"] and not any(a["name"] == "Yale Street" for a in r["avoided"]), "inferred depth must not decide routing"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
