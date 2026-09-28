"""Flood warning polygons (NWS; historical ones from the IEM archive, one file per event) and local reports (Tavily)."""
import json, time
from datetime import datetime, timezone
import httpx
from shapely.geometry import shape, box
from . import events
from .profiles import TAVILY_KEY

FLOOD = ("Flood", "Flash Flood")
UA = {"User-Agent": "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"}
_hist = {}  # event id -> archived features (data/cache/events/<id>/alerts.geojson, written by scripts/fetch_alerts.py)
_live = {}  # event id -> {"at", "features"}


def _ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _history(e):
    if e["id"] not in _hist:
        p = e["dir"] / "alerts.geojson"
        _hist[e["id"]] = json.loads(p.read_text())["features"] if p.exists() else []
    return _hist[e["id"]]


def _live_features(e):
    L = _live.setdefault(e["id"], {"at": 0.0, "features": []})
    if time.time() - L["at"] > 300:
        w, s, ea, n = e["bbox"]
        c = f"{(s + n) / 2:.4f},{(w + ea) / 2:.4f}"
        try:
            r = httpx.get("https://api.weather.gov/alerts/active", params={"point": c}, headers=UA, timeout=10)
            feats = [f for f in r.json().get("features", []) if f.get("geometry") and any(k in f["properties"]["event"] for k in FLOOD)]
            L.update(at=time.time(), features=[{"type": "Feature", "geometry": f["geometry"], "properties": {
                "event": f["properties"]["event"], "issued": f["properties"]["sent"], "expires": f["properties"]["expires"], "source": "NWS"}} for f in feats])
        except Exception:
            L["at"] = time.time() - 240  # retry in a minute, keep the last good set
    return L["features"]


def active(t: datetime, event=None):
    """GeoJSON features active at t for the event. Replay times use the archive; the present uses live NWS."""
    e = events.get(event)
    if (datetime.now(timezone.utc) - t).days < 1:
        return _live_features(e)
    return [f for f in _history(e) if _ts(f["properties"]["issued"]) <= t < _ts(f["properties"]["expires"])]


def polygons(features, event=None):
    area = box(*events.get(event)["bbox"])
    return [g for g in (shape(f["geometry"]) for f in features) if g.intersects(area)]


def local_reports(query: str, event=None):
    """Tavily search for local flood/road-closure reports. Returned as data for the agent to cite."""
    if not TAVILY_KEY:
        return {"error": "local reports unavailable (no Tavily key configured)"}
    r = httpx.post("https://api.tavily.com/search", headers={"Authorization": f"Bearer {TAVILY_KEY}"},
                   json={"query": f"{query} {events.get(event)['city']} flooding road closed", "max_results": 5, "search_depth": "basic"}, timeout=20)
    r.raise_for_status()
    return {"results": [{"title": x["title"], "url": x["url"], "snippet": x.get("content", "")[:300]} for x in r.json().get("results", [])]}
