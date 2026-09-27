"""HTTP API. Contract: backend/API.md. Run: uvicorn backend.app:app --port 8000"""
import json, re, time, uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from functools import lru_cache
import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from shapely.geometry import Point
from . import agent, alerts, depth, profiles as P
from .fusion import states_at
from .geocode import geocode
from .router import Roads
from .store import Store, ts

app = FastAPI(title="Waterline")
app.add_middleware(CORSMiddleware, allow_origins=P.ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])
store = Store()
MEDIA = P.CACHE / "media"          # replay frames (public domain / CC BY, credited)
UPLOADS = P.DB_PATH.parent / "uploads"  # never served
MAX_BYTES = 15 * 1024 * 1024


@lru_cache(1)
def roads():
    import osmnx as ox  # heavy import, only once
    return Roads(ox.load_graphml(P.CACHE / "graph.graphml"))


def _t(t: str | None):
    try:
        return ts(t) if t else ts(P.REPLAY["default_t"])
    except ValueError:
        raise HTTPException(400, "t must be ISO-8601")


def _evidence(o):
    return {"obs_id": o["obs_id"], "image_url": o.get("image_url"), "reference": o.get("reference"), "depth_cm": o.get("depth_cm"),
            "low_cm": o.get("low_cm"), "high_cm": o.get("high_cm"), "confidence": o.get("confidence"),
            "time": o["time"].isoformat(), "rationale": o.get("rationale"), "credit": o.get("credit"),
            "source_url": o.get("source_url"), "location_precision": o.get("precision") or "exact", "kind": o.get("kind") or "photo",
            "street": o.get("street")}


def _public(s):
    return {**{k: s[k] for k in ("state", "depth_cm", "low_cm", "high_cm", "confidence")},
            "obs_time": s["obs_time"].isoformat(), "evidence": [_evidence(o) for o in s["evidence"]]}


def _session(s):
    return s if isinstance(s, str) and re.fullmatch(r"[0-9a-f-]{8,40}", s) else None


def _ingest(t, session):
    """(obs time, session_id). Reports filed while viewing the replay are stamped with the replay time and
    sandboxed to the filer's session, so visitors can't change the shared replay. Otherwise: live, global."""
    s = _session(session)
    try:
        when = ts(t) if t else None
    except ValueError:
        when = None
    if when and s and ts(P.REPLAY["start"]) <= when <= ts(P.REPLAY["end"]):
        return when, s
    return datetime.now(timezone.utc), None


def _states(t, session=None):
    R = roads()  # a report applies to both directions of the same street
    return states_at([{**o, "edge_id": tw} for o in store.all(_session(session)) if o.get("edge_id") in R.edges for tw in R.twin_ids(o["edge_id"])], t)


_hits = defaultdict(deque)


def limit(req: Request, key: str, n: int, per_s: int):
    q, now = _hits[(key, req.client.host if req.client else "?")], time.time()
    while q and now - q[0] > per_s:
        q.popleft()
    if len(q) >= n:
        raise HTTPException(429, "Too many requests, try again shortly.")
    q.append(now)


@app.get("/health")
def health():
    if P.DEPTH_PROVIDER != "cosmos":
        return {"ok": True, "gpu": "not needed", "depth_model": P.DEPTH_MODEL if P.TF_KEY else "unconfigured"}
    if not P.COSMOS_URL:
        return {"ok": True, "gpu": "unconfigured"}
    try:
        httpx.get(P.COSMOS_URL.rstrip("/") + "/models", headers={"Authorization": f"Bearer {P.COSMOS_KEY}"}, timeout=3).raise_for_status()
        return {"ok": True, "gpu": "up"}
    except Exception:
        return {"ok": True, "gpu": "down"}


@app.get("/config")
def config():
    w, s, e, n = P.BBOX
    return {"city": P.CITY, "event": P.EVENT, "bbox": P.BBOX, "center": [(w + e) / 2, (s + n) / 2], "zoom": 12, "replay": P.REPLAY,
            "vehicles": [{"id": k, **v} for k, v in P.VEHICLES.items()], "thresholds": P.THRESHOLDS, "live": False}


@app.get("/segments")
def segments(t: str | None = None, session: str | None = None):
    R = roads()
    return {"type": "FeatureCollection", "features": [R.feature(eid, _public(s)) for eid, s in _states(_t(t), session).items() if eid in R.edges]}


@app.get("/alerts")
def get_alerts(t: str | None = None):
    return {"type": "FeatureCollection", "features": alerts.active(_t(t))}


class RouteReq(BaseModel):
    to: dict | str
    vehicle: str = "sedan"
    t: str | None = None
    session: str | None = None
    model_config = {"extra": "allow"}  # "from" is a Python keyword; read it from extras


def _loc(x):
    if isinstance(x, dict) and "lat" in x and "lon" in x:
        return {"lat": float(x["lat"]), "lon": float(x["lon"]), "label": x.get("label") or "selected point"}
    if isinstance(x, str) and x.strip():
        return geocode(x)
    return None


def _route(a, b, vehicle, t, session=None):
    if vehicle not in P.VEHICLES:
        raise HTTPException(400, f"vehicle must be one of {list(P.VEHICLES)}")
    return roads().route(a, b, vehicle, _states(t, session), alerts.polygons(alerts.active(t)))


def _public_route(r):
    for a in r.get("avoided", []):
        a["evidence"] = [_evidence(o) for o in a["evidence"]]
    return r


@app.post("/route")
def route(req: RouteReq, request: Request):
    limit(request, "route", 30, 60)
    a, b = _loc((req.model_extra or {}).get("from")), _loc(req.to)
    if not a or not b:
        raise HTTPException(404, f"Couldn't find the {'start' if not a else 'destination'} in {P.CITY}.")
    t = _t(req.t)
    r = _route((a["lat"], a["lon"]), (b["lat"], b["lon"]), req.vehicle, t, req.session)
    return _public_route({**r, "from": a, "to": b})


class ChatReq(BaseModel):
    messages: list[dict]
    vehicle: str = "sedan"
    t: str | None = None
    location: dict | None = None
    session: str | None = None


def _file_report(lat, lon, t, session, kind, fields):
    """Store a done observation snapped to a road. Returns public evidence, or {"error": ...}."""
    w, s, e, n = P.BBOX
    if not (s <= lat <= n and w <= lon <= e):
        return {"error": f"outside the {P.CITY} coverage area"}
    eid = roads().snap(lat, lon)
    if not eid:
        return {"error": f"no road within {P.SNAP_M} m of that spot"}
    when, sid = _ingest(t, session)
    o = {"obs_id": f"{kind}-{uuid.uuid4().hex[:10]}", "edge_id": eid, "time": when, "lat": lat, "lon": lon, "status": "ok",
         "queue_state": "done", "session_id": sid, "kind": kind, "image_url": None, "credit": f"{kind.title()} report", **fields}
    store.put(o)
    return {**_evidence(o), "edge_id": eid, "street": roads().edges[eid][4]}


@app.post("/chat")
def chat(req: ChatReq, request: Request):
    limit(request, "chat", 10, 60)
    t = _t(req.t)
    R = roads()

    def near(lat, lon):
        st = _states(t, req.session)
        ids = [R.ids[int(i)] for i in R.tree.query(Point(*R.to_m(lon, lat)).buffer(600))]
        seen, out = set(), []
        for eid in ids:
            s = st.get(eid)
            if s and R.edges[eid][4] not in seen:
                seen.add(R.edges[eid][4])
                out.append({"name": R.edges[eid][4], "state": s["state"], "high_cm": s["high_cm"], "time": s["obs_time"].isoformat()})
        return out[:10] or "no reports near here (unknown, not dry)"

    def report(lat, lon, cm, reached):
        # eyewitness words are coarse: low confidence, wide bounds, conservative upper bound
        return _file_report(lat, lon, req.t, req.session, "voice", {
            "depth_cm": cm, "low_cm": round(cm * 0.5, 1), "high_cm": round(max(cm * 1.5, cm + 20), 1), "confidence": 0.35,
            "reference": f"eyewitness: water reached {reached}", "rationale": "Spoken report; depth mapped from what the water reached.",
            "precision": "street"})

    ctx = {"route_fn": lambda a, b, v: _route(a, b, v if v in P.VEHICLES else req.vehicle, t, req.session), "near_fn": near,
           "alerts_fn": lambda: alerts.active(t), "location": req.location, "vehicle": req.vehicle, "report_fn": report}
    out = agent.chat(req.messages, ctx)
    if out["route"]:
        out["route"] = _public_route(out["route"])
    return out


def _sniff(b: bytes):
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if b[4:8] == b"ftyp" and b[8:12] not in (b"heic", b"heix", b"mif1"):
        return "video/mp4"
    return None


def _process(obs_id):
    o = store.get(obs_id)
    if not o or o["queue_state"] != "queued":
        return
    try:
        media = (UPLOADS / o["media_path"]).read_bytes()
        est = depth.estimate(media, o["mime"])
    except Exception:
        return  # GPU off or unreachable: stays queued, retried on the next upload
    store.put({**o, **est, "queue_state": "done"})


def _upload_view(o):
    if not o:
        raise HTTPException(404, "unknown upload")
    status = {"queued": "queued", "done": "done"}.get(o["queue_state"], "rejected")
    return {"obs_id": o["obs_id"], "status": status, "result": _evidence(o) if status == "done" else None,
            "message": "Queued: the depth model is starting or offline; it will process this when it's online." if status == "queued" else "Processed."}


@app.post("/upload", status_code=202)
async def upload(request: Request, bg: BackgroundTasks, file: UploadFile = File(...), lat: float | None = Form(None), lon: float | None = Form(None),
                 t: str | None = Form(None), session: str | None = Form(None)):
    limit(request, "upload", 5, 600)
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 15 MB.")
    mime = _sniff(raw)
    if not mime:
        raise HTTPException(415, "Upload a JPEG, PNG or MP4.")
    loc = (lat, lon) if lat is not None and lon is not None else (depth.exif_latlon(raw) if mime != "video/mp4" else None)
    if not loc:
        raise HTTPException(422, "We need a location: allow location access or enter it.")
    w, s, e, n = P.BBOX
    if not (s <= loc[0] <= n and w <= loc[1] <= e):
        raise HTTPException(422, f"That location is outside the {P.CITY} coverage area.")
    eid = roads().snap(*loc)
    if not eid:
        raise HTTPException(422, f"No road within {P.SNAP_M} m of that location.")
    obs_id = uuid.uuid4().hex[:12]
    UPLOADS.mkdir(parents=True, exist_ok=True)
    body = depth.prepare_image(raw) if mime.startswith("image") else raw  # images: EXIF stripped here
    name = f"{obs_id}.{'jpg' if mime.startswith('image') else 'mp4'}"
    (UPLOADS / name).write_bytes(body)
    when, sid = _ingest(t, session)
    store.put({"obs_id": obs_id, "edge_id": eid, "time": when, "lat": loc[0], "lon": loc[1], "status": "unknown",
               "credit": "Community upload", "image_url": None, "queue_state": "queued", "media_path": name,
               "session_id": sid, "kind": "photo",
               "mime": "image/jpeg" if mime.startswith("image") else mime})
    for q in store.queued():
        bg.add_task(_process, q["obs_id"])
    return _upload_view(store.get(obs_id))


DASHCAM_BYTES = 3 * 1024 * 1024
_dash_recent = {}  # (session or client, street) -> last filed epoch s. ponytail: in-memory, fine for one instance


def _speak_dash(street, ev, vehicle, over):
    v = P.VEHICLES[vehicle]
    msg = (f"Water reported ahead on {street}, about {ev['depth_cm']:.0f} centimetres, possibly up to {ev['high_cm']:.0f}. "
           f"Your {v['label'].lower()}'s limit is {v['limit_cm']}.")
    return msg + (" Rerouting." if over else " Estimates can be wrong. If it looks deeper, turn around.")


@app.post("/dashcam")
async def dashcam(request: Request, frame: UploadFile = File(...), lat: float = Form(...), lon: float = Form(...),
                  vehicle: str = Form("sedan"), t: str | None = Form(None), session: str | None = Form(None)):
    limit(request, "dashcam", 40, 60)
    if vehicle not in P.VEHICLES:
        raise HTTPException(400, f"vehicle must be one of {list(P.VEHICLES)}")
    raw = await frame.read(DASHCAM_BYTES + 1)
    if len(raw) > DASHCAM_BYTES or _sniff(raw) != "image/jpeg":
        raise HTTPException(415, "Send one JPEG frame under 3 MB.")
    try:
        est = depth.estimate(depth.prepare_image(raw, max_px=1024))  # frame stays in memory; never written to disk
    except Exception:
        raise HTTPException(503, "Depth model offline. No warnings until it's back.")
    if est["status"] != "ok" or not est.get("water_visible") or (est["high_cm"] or 0) < 5:
        # an unreadable or dry frame files nothing: it is not evidence that the road is clear
        return {"water": False, "filed": False, "speak": None}
    eid = roads().snap(lat, lon)
    street = roads().edges[eid][4] if eid else None
    over = est["high_cm"] > P.VEHICLES[vehicle]["limit_cm"]
    key, now = (_session(session) or (request.client.host if request.client else "?"), street), time.time()
    if not eid or now - _dash_recent.get(key, 0) < 120:
        return {"water": True, "filed": False, "street": street, "over_limit": over, "evidence": None,
                "speak": None if eid else "Water ahead. Location unclear, so no report was filed."}
    _dash_recent[key] = now
    fields = {k: est[k] for k in ("depth_cm", "low_cm", "high_cm", "reference", "rationale")}
    ev = _file_report(lat, lon, t, session, "dashcam", {**fields, "confidence": round((est["confidence"] or 0.5) * 0.8, 2),
                                                        "precision": "street", "street": street})
    if "error" in ev:
        return {"water": True, "filed": False, "street": street, "over_limit": over, "evidence": None, "speak": None}
    return {"water": True, "filed": True, "edge_id": eid, "street": street, "over_limit": over, "evidence": ev,
            "speak": _speak_dash(street, ev, vehicle, over)}


@app.get("/upload/{obs_id}")
def upload_status(obs_id: str):
    return _upload_view(store.get(obs_id[:32]))


@app.get("/media/{name}")
def media(name: str):
    p = (MEDIA / name).resolve()
    if p.parent != MEDIA.resolve() or not p.is_file():  # no path traversal; replay frames only
        raise HTTPException(404)
    return FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/eval")
def eval_report():
    p = P.ROOT / "eval/results/test.json"
    return json.loads(p.read_text()) if p.exists() else {"n": 0}
