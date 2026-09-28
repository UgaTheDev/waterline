"""Download the drivable OSM road graph for an event bbox -> data/cache/events/<id>/graph.graphml.gz (run once).
Harvey's graph predates this and stays uncompressed (graph.graphml); backend/events.py reads either.
    python -m scripts.build_graph [event_id]          (default harvey2017)
"""
import gzip, os, socket
import osmnx as ox

# Knob for a flaky Overpass: overpass-api.de resolves to two servers, and on 2026-09-28 one refused every connection.
# OVERPASS_IP=<ip> pins the host to one server (TLS still validates the real hostname).
if os.getenv("OVERPASS_IP"):
    _real = socket.getaddrinfo
    socket.getaddrinfo = lambda host, *a, **k: _real(os.environ["OVERPASS_IP"] if host == "overpass-api.de" else host, *a, **k)
from backend import events


def build(E):
    ox.settings.http_user_agent = "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"
    # osmnx 2.1's slot check misreads the current Overpass status page and sleeps forever; this is a few queries, run once
    ox.settings.overpass_rate_limit = False
    # One query for a dense 225 km2 city (NYC) gets refused by Overpass under load; ~20 km2 chunks go through.
    ox.settings.max_query_area_size = 20e6
    ox.settings.requests_timeout = 300
    # Overpass allows 2 slots per client; back-to-back chunk queries get refused mid-run, so pace them.
    import time
    from osmnx import _overpass
    if not getattr(_overpass, "_paced", False):
        _orig = _overpass._overpass_request
        def _paced(data, *a, **k):
            time.sleep(float(os.getenv("OVERPASS_PAUSE_S", "15")))
            return _orig(data, *a, **k)
        _overpass._overpass_request, _overpass._paced = _paced, True
    G = ox.graph_from_bbox(tuple(E["bbox"]), network_type="drive", simplify=True)
    tmp = E["dir"] / "graph.tmp.graphml"
    ox.save_graphml(G, tmp)
    out = E["dir"] / "graph.graphml.gz"
    with open(tmp, "rb") as f, gzip.open(out, "wb", compresslevel=9) as g:
        g.write(f.read())
    tmp.unlink()
    print(f"{len(G)} nodes, {G.number_of_edges()} edges -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return G


if __name__ == "__main__":
    import sys
    build(events.get(sys.argv[1] if len(sys.argv) > 1 else None))
