"""Stream E (responder mode). CONTRACT, frozen 2026-09-27. Token-guarded (header X-Responder-Token == env RESPONDER_TOKEN).
GET /responder/queue -> [{obs_id, flags: ["person_in_water"|"occupied_vehicle"], evidence, reviewed}] "needs human review".
POST /responder/review {obs_id, action: "seen"|"dismissed"} -> {ok}. Flags never feed routing or the public map."""
import hmac, os
from fastapi import APIRouter, Header, HTTPException

router = APIRouter(prefix="/responder")


def _auth(token):
    want = os.getenv("RESPONDER_TOKEN")
    if not want or not token or not hmac.compare_digest(token, want):
        raise HTTPException(401, "Responder access needs a token.")


@router.get("/queue")
def queue(x_responder_token: str | None = Header(None)):
    _auth(x_responder_token)
    return []  # stub until stream E lands


@router.post("/review")
def review(body: dict, x_responder_token: str | None = Header(None)):
    _auth(x_responder_token)
    return {"ok": True}
