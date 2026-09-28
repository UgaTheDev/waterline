"""Download the drivable OSM road graph for an event bbox -> data/cache/events/<id>/graph.graphml.gz (run once).
Harvey's graph predates this and stays uncompressed (graph.graphml); backend/events.py reads either.
    python -m scripts.build_graph [event_id]          (default harvey2017)
"""
import gzip
import osmnx as ox
from backend import events


def build(E):
    ox.settings.http_user_agent = "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"
    # osmnx 2.1's slot check misreads the current Overpass status page and sleeps forever; this is a few queries, run once
    ox.settings.overpass_rate_limit = False
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
