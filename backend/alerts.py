"""Flood warning polygons (NWS; historical ones from the IEM archive) and local reports (Tavily)."""
import json, time
from datetime import datetime, timezone
import httpx
from shapely.geometry import shape, box
from .profiles import BBOX, CACHE, TAVILY_KEY, CITY

FLOOD = ("Flood", "Flash Flood")
_hist_path = CACHE / "alerts_harvey.geojson"  # written by scripts/fetch_alerts.py
_hist = json.loads(_hist_path.read_text())["features"] if _hist_path.exists() else []
_live = {"at": 0.0, "features": []}


def _ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _live_features():
    if time.time() - _live["at"] > 300:
        w, s, e, n = BBOX
        c = f"{(s + n) / 2:.4f},{(w + e) / 2:.4f}"
        try:
            r = httpx.get("https://api.weather.gov/alerts/active", params={"point": c},
                          headers={"User-Agent": "waterline-flood-demo (github.com/UgaTheDev)"}, timeout=10)
            feats = [f for f in r.json().get("features", []) if f.get("geometry") and any(k in f["properties"]["event"] for k in FLOOD)]
            _live.update(at=time.time(), features=[{"type": "Feature", "geometry": f["geometry"], "properties": {
                "event": f["properties"]["event"], "issued": f["properties"]["sent"], "expires": f["properties"]["expires"], "source": "NWS"}} for f in feats])
        except Exception:
            _live["at"] = time.time() - 240  # retry in a minute, keep the last good set
    return _live["features"]


def active(t: datetime):
    """GeoJSON features active at t. Replay times use the archive; the present uses live NWS."""
    if (datetime.now(timezone.utc) - t).days < 1:
        return _live_features()
    return [f for f in _hist if _ts(f["properties"]["issued"]) <= t < _ts(f["properties"]["expires"])]


def polygons(features):
    area = box(*BBOX)
    return [g for g in (shape(f["geometry"]) for f in features) if g.intersects(area)]


def local_reports(query: str):
    """Tavily search for local flood/road-closure reports. Returned as data for the agent to cite."""
    if not TAVILY_KEY:
        return {"error": "local reports unavailable (no Tavily key configured)"}
    r = httpx.post("https://api.tavily.com/search", headers={"Authorization": f"Bearer {TAVILY_KEY}"},
                   json={"query": f"{query} {CITY} flooding road closed", "max_results": 5, "search_depth": "basic"}, timeout=20)
    r.raise_for_status()
    return {"results": [{"title": x["title"], "url": x["url"], "snippet": x.get("content", "")[:300]} for x in r.json().get("results", [])]}
