"""HTTP API. Contract: backend/API.md. Run: uvicorn backend.app:app --port 8000"""
import json, re, time, uuid
from collections import OrderedDict, defaultdict, deque
from typing import Literal
from datetime import datetime, timezone
import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from shapely.geometry import Point
from . import agent, alerts, depth, events, nowcast, profiles as P, responder, simulate, terrain
from .fusion import states_at
from .geocode import geocode
from .store import Store, ts

app = FastAPI(title="Waterline")
app.add_middleware(GZipMiddleware, minimum_size=1024)  # /segments at the survey peak: 4.4 MB -> 166 KB
app.add_middleware(CORSMiddleware, allow_origins=P.ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])
store = Store()
for r in (nowcast.router, responder.router, simulate.router):  # v2 streams own these modules (frozen contracts)
    app.include_router(r)
MEDIA = P.CACHE / "media"          # replay frames (public domain / CC BY, credited)
UPLOADS = P.DB_PATH.parent / "uploads"  # never served
MAX_BYTES = 15 * 1024 * 1024
Lang = Literal["en", "es"]  # reply language for /chat, /dashcam and upload status; anything else is a 422


def roads(event=None):
    """The event's road graph: loaded lazily, LRU of events.MAX_LOADED events (backend/events.py)."""
    return events.load(event, "roads")


def _t(t: str | None, event=None):
    try:
        return ts(t) if t else ts(events.get(event)["replay"]["default_t"])
    except ValueError:
        raise HTTPException(400, "t must be ISO-8601")


def _evidence(o):
    return {"obs_id": o["obs_id"], "image_url": o.get("image_url"), "reference": o.get("reference"), "depth_cm": o.get("depth_cm"),
            "low_cm": o.get("low_cm"), "high_cm": o.get("high_cm"), "confidence": o.get("confidence"),
            "time": o["time"].isoformat(), "rationale": o.get("rationale"), "credit": o.get("credit"),
            "source_url": o.get("source_url"), "location_precision": o.get("precision") or "exact", "kind": o.get("display_kind") or o.get("kind") or "photo",
            "street": o.get("street")}


def _public(s):
    return {**{k: s[k] for k in ("state", "depth_cm", "low_cm", "high_cm", "confidence")}, "basis": s.get("basis", "observed"),
            "obs_time": s["obs_time"].isoformat(), "evidence": [_evidence(o) for o in s["evidence"]]}


def _session(s):
    return s if isinstance(s, str) and re.fullmatch(r"[0-9a-f-]{8,40}", s) else None


def _ingest(lat, lon, t, session, event=None):
    """(event id, obs time, session_id), or None when the point is outside coverage. Reports filed while viewing an
    event's replay are stamped with the replay time, carry that event and are sandboxed to the filer's session, so
    visitors can't change the shared replay; they must fall inside that event's bbox. Otherwise the report is live and
    global, and belongs to whichever event's bbox contains it."""
    E, s = events.get(event), _session(session)
    try:
        when = ts(t) if t else None
    except ValueError:
        when = None
    if when and s and ts(E["replay"]["start"]) <= when <= ts(E["replay"]["end"]):
        return (E["id"], when, s) if events.inside(E, lat, lon) else None
    eid = events.for_point(lat, lon)
    return (eid, datetime.now(timezone.utc), None) if eid else None


def _outside():
    return f"That location is outside the coverage area ({events.coverage()})."


def _states(t, session=None, routing=False, event=None):
    """routing=True drops inferred observations: leave-one-out showed 30-60% coverage and implausible values near
    channels (eval/results/terrain_loo.json), so inference is display-only context, never what blocks or clears a road."""
    E = events.get(event)
    R = roads(E["id"])  # a report applies to both directions of the same street
    display_only = {"inferred"} | (set() if events.survey_routes(E) else {"survey"})
    obs = store.all(_session(session), E["id"])
    if routing:
        obs = [o for o in obs if o.get("kind") not in display_only]
    else:  # shown hatched like inferred streets: estimated, not used for routing
        obs = [{**o, "kind": "inferred", "display_kind": o["kind"]} if o.get("kind") == "survey" and "survey" in display_only else o for o in obs]
    return states_at([{**o, "edge_id": tw} for o in obs if o.get("edge_id") in R.edges for tw in R.twin_ids(o["edge_id"])], t)


_hits = defaultdict(deque)


def limit(req: Request, key: str, n: int, per_s: int):
    q, now = _hits[(key, req.client.host if req.client else "?")], time.time()
    while q and now - q[0] > per_s:
        q.popleft()
    if len(q) >= n:
        raise HTTPException(429, "Too many requests, try again shortly.")
    q.append(now)
    if len(_hits) > 20000:  # bound memory under a crowd of one-off clients; ponytail: coarse reset, fine at demo scale
        _hits.clear()


_spend = defaultdict(deque)


def budget(key: str):
    """Site-wide hourly cap on calls that cost money. Over budget is an explicit 503, never a silent pass."""
    q, now = _spend[key], time.time()
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= P.BUDGET_PER_HOUR[key]:
        raise HTTPException(503, "Waterline is at its hourly capacity for this feature. No warnings until it resets; if water covers the road, turn around.")
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


@app.get("/events")
def list_events():
    return [events.public(e) for e in events.registry().values()]


@app.get("/config")
def config(event: str | None = None):
    E = events.get(event)
    return {"id": E["id"], "city": E["city"], "event": E["name"], "bbox": E["bbox"], "center": E["map_view"]["center"], "zoom": E["map_view"]["zoom"],
            "replay": E["replay"], "vehicles": [{"id": k, **v, "responder_only": k == "rescue"} for k, v in P.VEHICLES.items()],
            "thresholds": P.THRESHOLDS, "live": False, "features": {"risk": P.NOWCAST_ENABLED and E["id"] == events.DEFAULT}}


_seg_cache = OrderedDict()  # (event, t, data version) -> serialized FeatureCollection; only for views without sandboxed rows


def _segments_body(t, session, event):
    R = roads(event)
    return json.dumps({"type": "FeatureCollection", "features": [R.feature(eid, _public(s)) for eid, s in _states(t, session, event=event).items()
                                                                  if eid in R.edges]}, separators=(",", ":")).encode()


@app.get("/segments")
def segments(t: str | None = None, session: str | None = None, event: str | None = None):
    """Every visitor at the same replay time sees the same map unless they filed sandboxed reports, so the common case
    is cached (load test: p95 25 s at 50 concurrent clients before). The key includes Store.version, so a new report
    can never be hidden behind a stale entry."""
    E, when = events.get(event), _t(t, event)
    sid = _session(session)
    if store.has_session_rows(sid, E["id"]):
        return Response(_segments_body(when, sid, E["id"]), media_type="application/json")
    key = (E["id"], when.isoformat(), Store.version)
    body = _seg_cache.get(key)
    if body is None:
        body = _seg_cache[key] = _segments_body(when, None, E["id"])
        while len(_seg_cache) > 64:
            _seg_cache.popitem(last=False)
    return Response(body, media_type="application/json")


@app.get("/alerts")
def get_alerts(t: str | None = None, event: str | None = None):
    return {"type": "FeatureCollection", "features": alerts.active(_t(t, event), event)}


class RouteReq(BaseModel):
    to: dict | str
    vehicle: str = "sedan"
    t: str | None = None
    session: str | None = None
    event: str | None = None
    model_config = {"extra": "allow"}  # "from" is a Python keyword; read it from extras


def _loc(x, event=None):
    if isinstance(x, dict) and "lat" in x and "lon" in x:
        return {"lat": float(x["lat"]), "lon": float(x["lon"]), "label": x.get("label") or "selected point"}
    if isinstance(x, str) and x.strip():
        return geocode(x, event)
    return None


def _route(a, b, vehicle, t, session=None, event=None):
    if vehicle not in P.VEHICLES:
        raise HTTPException(400, f"vehicle must be one of {list(P.VEHICLES)}")
    return roads(event).route(a, b, vehicle, _states(t, session, routing=True, event=event), alerts.polygons(alerts.active(t, event), event))


def _public_route(r):
    for a in r.get("avoided", []):
        a["evidence"] = [_evidence(o) for o in a["evidence"]]
    return r


@app.post("/route")
def route(req: RouteReq, request: Request):
    limit(request, "route", 30, 60)
    E = events.get(req.event)
    a, b = _loc((req.model_extra or {}).get("from"), E["id"]), _loc(req.to, E["id"])
    if not a or not b:
        raise HTTPException(404, f"Couldn't find the {'start' if not a else 'destination'} in {E['city']}.")
    t = _t(req.t, E["id"])
    r = _route((a["lat"], a["lon"]), (b["lat"], b["lon"]), req.vehicle, t, req.session, E["id"])
    return _public_route({**r, "from": a, "to": b})


class ChatReq(BaseModel):
    messages: list[dict]
    vehicle: str = "sedan"
    t: str | None = None
    location: dict | None = None
    session: str | None = None
    event: str | None = None
    lang: Lang = "en"


def _file_report(lat, lon, t, session, kind, fields, event=None):
    """Store a done observation snapped to a road of the event it belongs to (see _ingest).
    Returns public evidence, or {"error": ...}."""
    placed = _ingest(lat, lon, t, session, event)
    if not placed:
        return {"error": f"outside the coverage area ({events.coverage()})"}
    ev, when, sid = placed
    R = roads(ev)
    eid = R.snap(lat, lon)
    if not eid:
        return {"error": f"no road within {P.SNAP_M} m of that spot"}
    o = {"obs_id": f"{kind}-{uuid.uuid4().hex[:10]}", "edge_id": eid, "time": when, "lat": lat, "lon": lon, "status": "ok",
         "queue_state": "done", "session_id": sid, "kind": kind, "image_url": None, "credit": f"{kind.title()} report", "event": ev, **fields}
    store.put(o)
    for inf in terrain.infer(o):  # stream A: spread this report over connected low terrain (additive only)
        store.put({**inf, "queue_state": "done", "session_id": sid, "event": ev})
    return {**_evidence(o), "edge_id": eid, "street": R.edges[eid][4]}


@app.post("/chat")
def chat(req: ChatReq, request: Request):
    limit(request, "chat", 10, 60)
    if len(req.messages) > 20 or len(json.dumps(req.messages, default=str)) > 30000:
        raise HTTPException(413, "Conversation too long; start a new one.")
    ev = events.get(req.event)["id"]
    budget("chat")
    t = _t(req.t, ev)
    R = roads(ev)

    def near(lat, lon):
        st = _states(t, req.session, event=ev)
        ids = [R.ids[int(i)] for i in R.tree.query(Point(*R.to_m(lon, lat)).buffer(600))]
        seen, out = set(), []
        for eid in ids:
            s = st.get(eid)
            if s and R.edges[eid][4] not in seen:
                seen.add(R.edges[eid][4])
                out.append({"name": R.edges[eid][4], "state": s["state"], "basis": s.get("basis", "observed"), "high_cm": s["high_cm"],
                            "time": s["obs_time"].isoformat()})
        return out[:10] or "no reports near here (unknown, not dry)"

    def report(lat, lon, cm, reached):
        # eyewitness words are coarse: low confidence, wide bounds, conservative upper bound
        return _file_report(lat, lon, req.t, req.session, "voice", {
            "depth_cm": cm, "low_cm": round(cm * 0.5, 1), "high_cm": round(max(cm * 1.5, cm + 20), 1), "confidence": 0.35,
            "reference": f"eyewitness: water reached {reached}", "rationale": "Spoken report; depth mapped from what the water reached.",
            "precision": "street"}, ev)

    ctx = {"route_fn": lambda a, b, v: _route(a, b, v if v in P.VEHICLES else req.vehicle, t, req.session, ev), "near_fn": near,
           "alerts_fn": lambda: alerts.active(t, ev), "location": req.location, "vehicle": req.vehicle, "report_fn": report, "event": ev,
           "lang": req.lang}
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


MAX_ATTEMPTS = 3


def _process(obs_id):
    if not store.claim(obs_id):
        return  # another worker has it, or it's no longer queued
    o = store.get(obs_id)
    try:
        media = (UPLOADS / o["media_path"]).read_bytes()
        est = depth.estimate(media, o["mime"])
    except Exception:
        tries = int(o.get("attempts") or 0) + 1  # model offline: retry later, but a poison file can't loop forever
        store.put({**o, "attempts": tries, "queue_state": "queued" if tries < MAX_ATTEMPTS else "failed"})
        return
    if est.get("status") == "ok" and not est.get("water_visible"):
        store.put({**o, **est, "queue_state": "no_water"})  # a dry photo is not evidence that the street is clear
        return
    store.put({**o, **est, "queue_state": "done"})


_UPLOAD_MSG = {
    "en": {"queued": "Queued: the depth model is starting or offline; it will process this when it's online.", "done": "Processed.",
           "no_water": "No flood water visible in this photo, so no report was filed. That doesn't mean the street is clear.",
           "failed": "This file couldn't be processed. Try a clear JPEG photo of the water.", None: "Rejected."},
    "es": {"queued": "En cola: el modelo de profundidad está arrancando o fuera de línea; procesará esto cuando esté disponible.", "done": "Procesado.",
           "no_water": "No se ve agua de inundación en esta foto, así que no se registró ningún reporte. Eso no significa que la calle esté libre de agua.",
           "failed": "No se pudo procesar este archivo. Pruebe con una foto JPEG clara del agua.", None: "Rechazado."},
}


def _upload_view(o, lang="en"):
    if not o:
        raise HTTPException(404, "unknown upload")
    status = {"queued": "queued", "processing": "queued", "done": "done"}.get(o["queue_state"], "rejected")
    msg = _UPLOAD_MSG[lang]
    return {"obs_id": o["obs_id"], "status": status, "result": _evidence(o) if status == "done" else None,
            "message": msg.get(o["queue_state"], msg[None])}


@app.post("/upload", status_code=202)
def upload(request: Request, bg: BackgroundTasks, file: UploadFile = File(...), lat: float | None = Form(None), lon: float | None = Form(None),
                 t: str | None = Form(None), session: str | None = Form(None), event: str | None = Form(None),
                 lang: Lang = Form("en")):
    limit(request, "upload", 5, 600)
    events.get(event)  # unknown event: 400 before any work
    budget("upload")
    raw = file.file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 15 MB.")
    mime = _sniff(raw)
    if not mime:
        raise HTTPException(415, "Upload a JPEG, PNG or MP4.")
    if mime == "video/mp4" and P.DEPTH_PROVIDER != "cosmos":
        raise HTTPException(415, "Video uploads need the self-hosted depth model, which is offline. Upload a photo instead.")
    loc = (lat, lon) if lat is not None and lon is not None else (depth.exif_latlon(raw) if mime != "video/mp4" else None)
    if not loc:
        raise HTTPException(422, "We need a location: allow location access or enter it.")
    placed = _ingest(loc[0], loc[1], t, session, event)
    if not placed:
        raise HTTPException(422, _outside())
    ev, when, sid = placed
    eid = roads(ev).snap(*loc)
    if not eid:
        raise HTTPException(422, f"No road within {P.SNAP_M} m of that location.")
    obs_id = uuid.uuid4().hex[:12]
    UPLOADS.mkdir(parents=True, exist_ok=True)
    try:
        body = depth.prepare_image(raw) if mime.startswith("image") else raw  # images: EXIF stripped here
    except (ValueError, OSError):
        raise HTTPException(413, "That image is too large or unreadable.")
    name = f"{obs_id}.{'jpg' if mime.startswith('image') else 'mp4'}"
    (UPLOADS / name).write_bytes(body)
    store.put({"obs_id": obs_id, "edge_id": eid, "time": when, "lat": loc[0], "lon": loc[1], "status": "unknown",
               "credit": "Community upload", "image_url": None, "queue_state": "queued", "media_path": name,
               "session_id": sid, "kind": "photo", "event": ev,
               "mime": "image/jpeg" if mime.startswith("image") else mime})
    bg.add_task(_process, obs_id)
    for q in store.queued():  # at most 3 older retries per upload
        if q["obs_id"] != obs_id:
            bg.add_task(_process, q["obs_id"])
    return _upload_view(store.get(obs_id), lang)


DASHCAM_BYTES = 3 * 1024 * 1024
_dash_recent = {}  # (session or client, street) -> last filed epoch s. ponytail: in-memory, fine for one instance


_VEH_ES = {"sedan": "sedán", "suv": "SUV", "truck": "camioneta", "rescue": "camión de rescate"}


def _speak_dash(street, ev, vehicle, over, lang="en"):
    v = P.VEHICLES[vehicle]
    if lang == "es":
        msg = (f"Agua reportada adelante en {street}, unos {ev['depth_cm']:.0f} centímetros, posiblemente hasta {ev['high_cm']:.0f}. "
               f"El límite de su {_VEH_ES.get(vehicle, v['label'].lower())} es {v['limit_cm']}.")
        return msg + (" Cambiando la ruta." if over else " Los cálculos pueden fallar. Si se ve más profunda, dé la vuelta.")
    msg = (f"Water reported ahead on {street}, about {ev['depth_cm']:.0f} centimetres, possibly up to {ev['high_cm']:.0f}. "
           f"Your {v['label'].lower()}'s limit is {v['limit_cm']}.")
    return msg + (" Rerouting." if over else " Estimates can be wrong. If it looks deeper, turn around.")


@app.post("/dashcam")
def dashcam(request: Request, frame: UploadFile = File(...), lat: float = Form(...), lon: float = Form(...),
                  vehicle: str = Form("sedan"), t: str | None = Form(None), session: str | None = Form(None), event: str | None = Form(None),
                  lang: Lang = Form("en")):
    limit(request, "dashcam", 40, 60)
    events.get(event)  # unknown event: 400 before paying for the model
    budget("dashcam")
    if vehicle not in P.VEHICLES:
        raise HTTPException(400, f"vehicle must be one of {list(P.VEHICLES)}")
    raw = frame.file.read(DASHCAM_BYTES + 1)
    if len(raw) > DASHCAM_BYTES or _sniff(raw) != "image/jpeg":
        raise HTTPException(415, "Send one JPEG frame under 3 MB.")
    try:
        img = depth.prepare_image(raw, max_px=1024)  # frame stays in memory; never written to disk
    except (ValueError, OSError):
        raise HTTPException(415, "Send one JPEG frame under 3 MB.")
    try:
        est = depth.estimate(img)
    except Exception:
        raise HTTPException(503, "Depth model offline. No warnings until it's back.")
    if est["status"] != "ok" or not est.get("water_visible") or (est["high_cm"] or 0) < 5:
        # an unreadable or dry frame files nothing: it is not evidence that the road is clear
        return {"water": False, "filed": False, "speak": None}
    placed = _ingest(lat, lon, t, session, event)
    R = roads(placed[0]) if placed else None  # outside every event's coverage: no road, nothing filed
    eid = R.snap(lat, lon) if R else None
    street = R.edges[eid][4] if eid else None
    over = est["high_cm"] > P.VEHICLES[vehicle]["limit_cm"]
    key, now = ((request.client.host if request.client else "?"), street), time.time()
    if len(_dash_recent) > 5000:
        for k in [k for k, v in _dash_recent.items() if now - v > 120]:
            del _dash_recent[k]
    if not eid or now - _dash_recent.get(key, 0) < 120:
        return {"water": True, "filed": False, "street": street, "over_limit": over, "evidence": None,
                "speak": None if eid else ("Agua adelante. La ubicación no es clara, así que no se registró ningún reporte." if lang == "es"
                                          else "Water ahead. Location unclear, so no report was filed.")}
    _dash_recent[key] = now
    fields = {k: est[k] for k in ("depth_cm", "low_cm", "high_cm", "reference", "rationale")}
    fields["flags"] = est.get("flags") or []
    ev = _file_report(lat, lon, t, session, "dashcam", {**fields, "confidence": round((est["confidence"] or 0.5) * 0.8, 2),
                                                        "precision": "street", "street": street}, event)
    if "error" in ev:
        return {"water": True, "filed": False, "street": street, "over_limit": over, "evidence": None, "speak": None}
    return {"water": True, "filed": True, "edge_id": eid, "street": street, "over_limit": over, "evidence": ev,
            "speak": _speak_dash(street, ev, vehicle, over, lang)}


@app.get("/upload/{obs_id}")
def upload_status(obs_id: str, lang: Lang = "en"):
    return _upload_view(store.get(obs_id[:32]), lang)


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
