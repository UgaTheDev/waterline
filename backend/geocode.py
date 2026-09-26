"""Place name -> (lat, lon, label) via OpenStreetMap Nominatim, bounded to the city bbox, cached."""
import json, threading, time
import httpx
from .profiles import BBOX, CACHE

_path = CACHE / "geocode.json"
_cache = json.loads(_path.read_text()) if _path.exists() else {}
_lock = threading.Lock()
_last = [0.0]


def geocode(q: str):
    key = q.strip().lower()[:200]
    if key in _cache:
        return _cache[key]
    with _lock:  # Nominatim usage policy: max 1 request/second, identify yourself
        time.sleep(max(0.0, 1.0 - (time.time() - _last[0])))
        _last[0] = time.time()
        w, s, e, n = BBOX
        r = httpx.get("https://nominatim.openstreetmap.org/search",
                      params={"q": q, "format": "jsonv2", "limit": 1, "viewbox": f"{w},{n},{e},{s}", "bounded": 1},
                      headers={"User-Agent": "waterline-flood-demo (github.com/UgaTheDev)"}, timeout=15)
        r.raise_for_status()
        hits = r.json()
        out = {"lat": float(hits[0]["lat"]), "lon": float(hits[0]["lon"]), "label": hits[0]["display_name"]} if hits else None
        _cache[key] = out
        try:
            _path.write_text(json.dumps(_cache, indent=1))
        except OSError:
            pass
        return out
