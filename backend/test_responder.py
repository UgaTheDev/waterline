"""Responder mode + 311 parser. Run: .venv/bin/python -m backend.test_responder"""
import os, tempfile
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")  # never touch the real uploads db
os.environ["RESPONDER_TOKEN"] = "test-token-123"
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from . import app as A
from .ingest311 import parse_text_report

HDR = {"X-Responder-Token": "test-token-123"}
c = TestClient(A.app)


def _flagged_obs(obs_id="flagged-1", flags='["person_in_water"]', media_path=None):
    A.store.put({"obs_id": obs_id, "edge_id": "A-B-0", "time": datetime.now(timezone.utc), "lat": 29.7, "lon": -95.4,
                 "status": "ok", "depth_cm": 60, "low_cm": 50, "high_cm": 80, "confidence": 0.8, "reference": "car tire",
                 "rationale": "x", "credit": "Community upload", "queue_state": "done", "kind": "photo",
                 "flags": flags, "media_path": media_path})
    return obs_id


def test_auth():
    assert c.get("/responder/queue").status_code == 401
    assert c.get("/responder/queue", headers={"X-Responder-Token": "wrong"}).status_code == 401
    assert c.get("/responder/queue", headers=HDR).status_code == 200


def test_queue_and_review():
    obs_id = _flagged_obs()
    q = c.get("/responder/queue", headers=HDR).json()
    item = next((x for x in q if x["obs_id"] == obs_id), None)
    assert item is not None, q
    assert item["flags"] == ["person_in_water"] and item["reviewed"] is False and item["label"] == "Needs human review"
    r = c.post("/responder/review", headers=HDR, json={"obs_id": obs_id, "action": "seen"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    q2 = c.get("/responder/queue", headers=HDR).json()
    assert next(x for x in q2 if x["obs_id"] == obs_id)["reviewed"] is True
    assert c.post("/responder/review", headers=HDR, json={"obs_id": obs_id, "action": "bogus"}).status_code == 400
    assert c.post("/responder/review", headers=HDR, json={"obs_id": "no-such-obs", "action": "seen"}).status_code == 404


def test_segments_never_carry_flags():
    _flagged_obs(obs_id="flagged-2")
    body = c.get("/segments").text
    assert "flags" not in body and "person_in_water" not in body, body


def test_media_refused_for_unflagged():
    unflagged = "unflagged-1"
    A.store.put({"obs_id": unflagged, "edge_id": "A-B-0", "time": datetime.now(timezone.utc), "lat": 29.7,
                 "lon": -95.4, "status": "ok", "queue_state": "done", "kind": "photo", "flags": None,
                 "media_path": "unflagged-1.jpg"})
    assert c.get(f"/responder/media/{unflagged}", headers=HDR).status_code == 404
    assert c.get("/responder/media/no-such-obs", headers=HDR).status_code == 404


def test_311_parser():
    assert parse_text_report("street is wet", 29.7, -95.4) is None
    o = parse_text_report("water up to my knees on Main St", 29.7, -95.4)
    assert o is not None and o["depth_cm"] == 50 and o["kind"] == "report311" and o["confidence"] == 0.4
    for cm in (o["depth_cm"], o["low_cm"], o["high_cm"]):
        assert cm != 0, o


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
