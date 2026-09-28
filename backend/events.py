"""Event registry: one directory per replayed flood event, data/cache/events/<id>/.

event.json: {id, name, city, bbox [w,s,e,n], replay {start,end,default_t}, map_view {center,zoom}, stn_event_id, wfo [..],
credits [..]}. Next to it: graph.graphml (or graph.graphml.gz), dem_5m.npz, alerts.geojson, survey_observations.json,
inferred_observations.json, and optionally replay_observations.json / replay_manifest.csv / rain.json / nowcast_static.npz.
Built by scripts/add_event.py.

Memory: the road graph dominates (Harvey alone is ~700 MB RSS with its DEM). Graphs and DEMs load lazily on first use and
stay in an LRU of MAX_LOADED events (env MAX_LOADED_EVENTS, default 2); the least recently used event is dropped when a
third one loads. With the default 2 and two events, both stay resident.
"""
import gzip, json, os, re, threading
from collections import OrderedDict
from fastapi import HTTPException
from .profiles import CACHE

DIR = CACHE / "events"
DEFAULT = "harvey2017"
MAX_LOADED = int(os.getenv("MAX_LOADED_EVENTS", "2"))

_REG = None  # id -> event dict (+ "dir"); tests may assign one


def registry():
    global _REG
    if _REG is None:
        _REG = {}
        for p in sorted(DIR.glob("*/event.json")):
            e = json.loads(p.read_text())
            _REG[e["id"]] = {**e, "dir": p.parent}
    return _REG


def get(event_id=None):
    """The event dict, DEFAULT when None/empty. Unknown ids are a 400, never a silent fallback to Harvey."""
    eid = event_id or DEFAULT
    e = registry().get(eid) if isinstance(eid, str) and re.fullmatch(r"[a-z0-9_-]{1,40}", eid) else None
    if not e:
        raise HTTPException(400, f"unknown event; one of {list(registry())}")
    return e


def inside(e, lat, lon):
    w, s, ea, n = e["bbox"]
    return s <= lat <= n and w <= lon <= ea


def for_point(lat, lon):
    """Id of the event whose bbox contains the point, or None (outside coverage)."""
    return next((k for k, e in registry().items() if inside(e, lat, lon)), None)


def coverage():
    return "; ".join(e["city"] for e in registry().values())


def public(e):
    return {"id": e["id"], "name": e["name"], "city": e["city"], "replay": e["replay"],
            "center": e["map_view"]["center"], "zoom": e["map_view"]["zoom"]}


def _roads(e):
    import osmnx as ox  # heavy import, only once
    from .router import Roads
    p = e["dir"] / "graph.graphml"
    if p.exists():
        return Roads(ox.load_graphml(p))
    with gzip.open(e["dir"] / "graph.graphml.gz", "rt", encoding="utf-8") as f:  # committed compressed to keep the repo small
        return Roads(ox.load_graphml(graphml_str=f.read()))


def _dem(e):
    import numpy as np
    from .terrain import Dem
    d = np.load(e["dir"] / "dem_5m.npz")
    return Dem(d["z_cm"], d["bbox"])


LOADERS = {"roads": _roads, "dem": _dem}  # tests may swap these for synthetic builders
_loaded = OrderedDict()  # event id -> {"roads": Roads, "dem": Dem}, most recently used last
_lock = threading.Lock()       # guards _loaded
_load_lock = threading.Lock()  # ponytail: one load at a time (a load is seconds and ~GB), per-event locks if that queues


def load(event_id, kind):
    """Lazily loaded, LRU-cached per-event resource ("roads" | "dem")."""
    e = get(event_id)
    with _lock:
        hit = _loaded.get(e["id"], {}).get(kind)
        if hit is not None:
            _loaded.move_to_end(e["id"])
            return hit
    with _load_lock:
        with _lock:  # another thread may have loaded it while we waited
            hit = _loaded.get(e["id"], {}).get(kind)
        if hit is None:
            hit = LOADERS[kind](e)
        with _lock:
            _loaded.setdefault(e["id"], {})[kind] = hit
            _loaded.move_to_end(e["id"])
            while len(_loaded) > MAX_LOADED:
                _loaded.popitem(last=False)  # drop the least recently used event (graph + DEM together)
        return hit


def loaded():
    with _lock:
        return list(_loaded)
