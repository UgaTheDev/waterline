"""HTTP API. Contract: backend/API.md. Run: uvicorn backend.app:app --port 8000"""
import json, time, uuid
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
            "source_url": o.get("source_url"), "location_precision": o.get("precision") or "exact", "kind": o.get("kind") or "photo"}


def _public(s):
    return {**{k: s[k] for k in ("state", "depth_cm", "low_cm", "high_cm", "confidence")},
            "obs_time": s["obs_time"].isoformat(), "evidence": [_evidence(o) for o in s["evidence"]]}


def _states(t):
    R = roads()  # a report applies to both directions of the same street
    return states_at([{**o, "edge_id": tw} for o in store.all() if o.get("edge_id") in R.edges for tw in R.twin_ids(o["edge_id"])], t)


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
def segments(t: str | None = None):
    R = roads()
    return {"type": "FeatureCollection", "features": [R.feature(eid, _public(s)) for eid, s in _states(_t(t)).items() if eid in R.edges]}


@app.get("/alerts")
def get_alerts(t: str | None = None):
    return {"type": "FeatureCollection", "features": alerts.active(_t(t))}


class RouteReq(BaseModel):
    to: dict | str
    vehicle: str = "sedan"
    t: str | None = None
    model_config = {"extra": "allow"}  # "from" is a Python keyword; read it from extras


def _loc(x):
    if isinstance(x, dict) and "lat" in x and "lon" in x:
        return {"lat": float(x["lat"]), "lon": float(x["lon"]), "label": x.get("label") or "selected point"}
    if isinstance(x, str) and x.strip():
        return geocode(x)
    return None


def _route(a, b, vehicle, t):
    if vehicle not in P.VEHICLES:
        raise HTTPException(400, f"vehicle must be one of {list(P.VEHICLES)}")
    return roads().route(a, b, vehicle, _states(t), alerts.polygons(alerts.active(t)))


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
    r = _route((a["lat"], a["lon"]), (b["lat"], b["lon"]), req.vehicle, t)
    return _public_route({**r, "from": a, "to": b})


class ChatReq(BaseModel):
    messages: list[dict]
    vehicle: str = "sedan"
    t: str | None = None
    location: dict | None = None


@app.post("/chat")
def chat(req: ChatReq, request: Request):
    limit(request, "chat", 10, 60)
    t = _t(req.t)
    R = roads()

    def near(lat, lon):
        st = _states(t)
        ids = [R.ids[int(i)] for i in R.tree.query(Point(*R.to_m(lon, lat)).buffer(600))]
        seen, out = set(), []
        for eid in ids:
            s = st.get(eid)
            if s and R.edges[eid][4] not in seen:
                seen.add(R.edges[eid][4])
                out.append({"name": R.edges[eid][4], "state": s["state"], "high_cm": s["high_cm"], "time": s["obs_time"].isoformat()})
        return out[:10] or "no reports near here (unknown, not dry)"

    ctx = {"route_fn": lambda a, b, v: _route(a, b, v if v in P.VEHICLES else req.vehicle, t), "near_fn": near,
           "alerts_fn": lambda: alerts.active(t), "location": req.location, "vehicle": req.vehicle}
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
async def upload(request: Request, bg: BackgroundTasks, file: UploadFile = File(...), lat: float | None = Form(None), lon: float | None = Form(None)):
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
    now = datetime.now(timezone.utc)
    store.put({"obs_id": obs_id, "edge_id": eid, "time": now, "lat": loc[0], "lon": loc[1], "status": "unknown",
               "credit": "Community upload", "image_url": None, "queue_state": "queued", "media_path": name,
               "mime": "image/jpeg" if mime.startswith("image") else mime})
    for q in store.queued():
        bg.add_task(_process, q["obs_id"])
    return _upload_view(store.get(obs_id))


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
