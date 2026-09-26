"""Download the drivable OSM road graph for the demo bbox -> data/cache/graph.graphml (run once)."""
import osmnx as ox
from backend.profiles import BBOX, CACHE

G = ox.graph_from_bbox(tuple(BBOX), network_type="drive", simplify=True)
CACHE.mkdir(parents=True, exist_ok=True)
ox.save_graphml(G, CACHE / "graph.graphml")
print(f"{len(G)} nodes, {G.number_of_edges()} edges -> {CACHE / 'graph.graphml'}")
