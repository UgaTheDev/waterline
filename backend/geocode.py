"""Place name -> (lat, lon, label) via OpenStreetMap Nominatim, bounded to the event's bbox, cached."""
import json, threading, time
import httpx
from . import events
from .profiles import CACHE

_path = CACHE / "geocode.json"
_cache = json.loads(_path.read_text()) if _path.exists() else {}
_lock = threading.Lock()
_last = [0.0]


MAX_CACHE = 5000
_misses = [0]


def geocode(q: str, event=None):
    e = events.get(event)
    key = f"{e['id']}:{q.strip().lower()[:200]}"  # same words, different city
    if key in _cache:
        return _cache[key]
    # Nominatim policy: max 1 request/second, identify yourself. Don't queue behind a crowd of made-up place names:
    # give up (None, "couldn't find") if another lookup holds the lock for more than 2 s.
    if not _lock.acquire(timeout=2):
        return None
    try:
        time.sleep(max(0.0, 1.0 - (time.time() - _last[0])))
        _last[0] = time.time()
        w, s, ea, n = e["bbox"]
        r = httpx.get("https://nominatim.openstreetmap.org/search",
                      params={"q": q, "format": "jsonv2", "limit": 1, "viewbox": f"{w},{n},{ea},{s}", "bounded": 1},
                      headers={"User-Agent": "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"}, timeout=8)  # held under the lock: keep short
        r.raise_for_status()
        hits = r.json()
        out = {"lat": float(hits[0]["lat"]), "lon": float(hits[0]["lon"]), "label": hits[0]["display_name"]} if hits else None
        if len(_cache) >= MAX_CACHE:
            _cache.pop(next(iter(_cache)))  # oldest first (dicts keep insertion order)
        _cache[key] = out
        _misses[0] += 1
        if _misses[0] % 20 == 0:  # persist in batches, not a full rewrite per lookup
            try:
                _path.write_text(json.dumps(_cache))
            except OSError:
                pass
        return out
    finally:
        _lock.release()
