"""Road graph from a local OpenStreetMap PBF extract, for when Overpass won't serve the area.

  python -m scripts.graph_from_pbf ida2021 data/raw/osm/NewYork.osm.pbf

Writes data/cache/events/<id>/graph.graphml.gz, the same thing scripts/build_graph.py produces, so add_event.py
skips its Overpass step afterwards. Reads the GDAL OSM driver's "lines" layer (bundled with pyogrio; no extra install),
keeps osmnx "drive" road classes, and splits ways at shared vertices: in OSM, ways that meet share a node, so an
identical vertex is an intersection. One-ways follow the tags (motorways and roundabouts are one-way by default).
Bridge/tunnel tags are kept because terrain inference excludes those edges. Extract: download.bbbike.org
(OpenStreetMap contributors, ODbL).
"""
import gzip, math, re, sys
from collections import Counter
import networkx as nx
import osmnx as ox
import pyogrio
from shapely.geometry import LineString
from backend import events

DRIVE = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "road",
         "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
_TAG = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')


def tags(s):
    return dict(_TAG.findall(s)) if isinstance(s, str) else {}  # untagged rows come back as NaN


def metres(a, b):
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540)


def build(E, pbf):
    w, s, e, n = E["bbox"]
    df = pyogrio.read_dataframe(pbf, layer="lines", bbox=(w, s, e, n), columns=["osm_id", "name", "highway", "other_tags"])
    df = df[df["highway"].isin(DRIVE)]
    ways, seen = [], Counter()
    for r in df.itertuples():
        t = tags(r.other_tags)
        if t.get("access") in ("private", "no") or t.get("motor_vehicle") == "no" or t.get("motorcar") == "no" or t.get("area") == "yes":
            continue
        geoms = getattr(r.geometry, "geoms", [r.geometry])
        for g in geoms:
            c = [(round(x, 7), round(y, 7)) for x, y in g.coords]
            if len(c) >= 2:
                ways.append((r, t, c))
                seen.update(set(c))  # a vertex shared by two ways is an intersection
    G = nx.MultiDiGraph(crs="epsg:4326")
    ids = {}

    def node(p):
        if p not in ids:
            ids[p] = len(ids) + 1
            G.add_node(ids[p], x=p[0], y=p[1])
        return ids[p]

    for r, t, c in ways:
        cuts = [0] + [i for i in range(1, len(c) - 1) if seen[c[i]] > 1] + [len(c) - 1]
        ow = t.get("oneway", "")
        forward_only = ow in ("yes", "true", "1") or (ow == "" and (r.highway == "motorway" or t.get("junction") == "roundabout"))
        backward_only = ow == "-1"
        base = {"osmid": int(r.osm_id) if str(r.osm_id).isdigit() else r.osm_id, "highway": r.highway, "oneway": forward_only or backward_only}
        if isinstance(r.name, str) and r.name:  # NaN is truthy: check the type
            base["name"] = r.name
        for k in ("bridge", "tunnel", "ref", "maxspeed"):
            if t.get(k) and t[k] != "no":
                base[k] = t[k]
        for a, b in zip(cuts, cuts[1:]):
            seg = c[a:b + 1]
            if seg[0] == seg[-1]:
                continue
            L = sum(metres(p, q) for p, q in zip(seg, seg[1:]))
            u, v = node(seg[0]), node(seg[-1])
            if not backward_only:
                G.add_edge(u, v, length=L, geometry=LineString(seg), **base)
            if not forward_only:
                G.add_edge(v, u, length=L, geometry=LineString(seg[::-1]), **base)
    G = G.subgraph(max(nx.weakly_connected_components(G), key=len)).copy()  # like osmnx: drop disconnected fragments
    tmp = E["dir"] / "graph.tmp.graphml"
    ox.save_graphml(G, tmp)
    out = E["dir"] / "graph.graphml.gz"
    with open(tmp, "rb") as f, gzip.open(out, "wb", compresslevel=9) as g:
        g.write(f.read())
    tmp.unlink()
    print(f"{len(G)} nodes, {G.number_of_edges()} edges -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return G


def _selftest():
    assert tags('"oneway"=>"yes","name:es"=>"A \\"B\\""') == {"oneway": "yes", "name:es": 'A \\"B\\"'}
    assert abs(metres((-73.9, 40.7), (-73.9, 40.71)) - 1105.4) < 1


if __name__ == "__main__":
    _selftest()
    build(events.registry(include_incomplete=True)[sys.argv[1]], sys.argv[2])
