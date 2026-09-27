"""Stream E (responder mode). CONTRACT, frozen 2026-09-27. Token-guarded (header X-Responder-Token == env RESPONDER_TOKEN).
GET /responder/queue -> [{obs_id, flags: ["person_in_water"|"occupied_vehicle"], evidence, reviewed}] "needs human review".
POST /responder/review {obs_id, action: "seen"|"dismissed"} -> {ok}. Flags never feed routing or the public map."""
import hmac, json, os
from datetime import datetime, timezone
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from .profiles import DB_PATH
from .store import Store, ts

router = APIRouter(prefix="/responder")
UPLOADS = DB_PATH.parent / "uploads"
_store = Store()  # separate connection to the same DB file; obs table is shared with app.py's Store
_store.db.execute("CREATE TABLE IF NOT EXISTS reviews (obs_id TEXT PRIMARY KEY, action TEXT, time TEXT)")


def _auth(token):
    want = os.getenv("RESPONDER_TOKEN")
    if not want or not token or not hmac.compare_digest(token.encode(), want.encode()):  # bytes: non-ASCII can't 500
        raise HTTPException(401, "Responder access needs a token.")


def _flags(o):
    try:
        f = json.loads(o.get("flags") or "[]")
    except (TypeError, ValueError):
        f = []
    return f if isinstance(f, list) else []


def _evidence(o):
    """Same shape as app.py's _evidence (Evidence in API.md)."""
    return {"obs_id": o["obs_id"], "image_url": o.get("image_url"), "reference": o.get("reference"),
            "depth_cm": o.get("depth_cm"), "low_cm": o.get("low_cm"), "high_cm": o.get("high_cm"),
            "confidence": o.get("confidence"), "time": o["time"].isoformat(), "rationale": o.get("rationale"),
            "credit": o.get("credit"), "source_url": o.get("source_url"), "location_precision": o.get("precision") or "exact",
            "kind": o.get("kind") or "photo", "street": o.get("street")}


@router.get("/queue")
def queue(x_responder_token: str | None = Header(None)):
    _auth(x_responder_token)
    rows = _store.db.execute(
        "SELECT * FROM obs WHERE flags IS NOT NULL AND flags != '' AND flags != '[]' ORDER BY time DESC").fetchall()
    reviewed = {r["obs_id"] for r in _store.db.execute("SELECT obs_id FROM reviews")}
    out = []
    for r in rows:
        o = dict(r, time=ts(r["time"]))
        out.append({"obs_id": o["obs_id"], "flags": _flags(o), "evidence": _evidence(o),
                     "reviewed": o["obs_id"] in reviewed, "label": "Needs human review"})
    return out


@router.post("/review")
def review(body: dict, x_responder_token: str | None = Header(None)):
    _auth(x_responder_token)
    obs_id, action = body.get("obs_id"), body.get("action")
    if not isinstance(obs_id, str) or len(obs_id) > 64:
        raise HTTPException(400, "obs_id must be a string")
    if action not in ("seen", "dismissed"):
        raise HTTPException(400, "action must be 'seen' or 'dismissed'")
    if not obs_id or not _store.get(obs_id):
        raise HTTPException(404, "unknown obs_id")
    with _store.lock, _store.db:
        _store.db.execute("INSERT OR REPLACE INTO reviews VALUES (?, ?, ?)",
                           (obs_id, action, datetime.now(timezone.utc).isoformat()))
    return {"ok": True}


@router.get("/media/{obs_id}")
def media(obs_id: str, x_responder_token: str | None = Header(None)):
    _auth(x_responder_token)
    o = _store.get(obs_id)
    if not o or not _flags(o) or not o.get("media_path"):
        raise HTTPException(404)
    p = (UPLOADS / o["media_path"]).resolve()
    if p.parent != UPLOADS.resolve() or not p.is_file():  # no path traversal
        raise HTTPException(404)
    return FileResponse(p)
