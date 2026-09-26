"""Road graph, photo-to-road snapping, and vehicle-aware routing."""
import math
import networkx as nx
import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, mapping
from shapely.ops import transform
from .profiles import VEHICLES, SNAP_M, UNKNOWN_COST, ALERT_UNKNOWN_COST


def edge_id(u, v, k):
    return f"{u}-{v}-{k}"


def _name(d):
    n = d.get("name") or d.get("ref") or "unnamed road"
    return ", ".join(n) if isinstance(n, list) else str(n)


class Roads:
    def __init__(self, G):
        self.G = G
        lat0 = np.mean([d["y"] for _, d in G.nodes(data=True)])
        kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
        self.to_m = lambda x, y, z=None: (np.asarray(x) * kx, np.asarray(y) * ky)  # local metres
        self.edges = {}  # edge_id -> (u, v, k, lonlat LineString, name, length)
        for u, v, k, d in G.edges(keys=True, data=True):
            geom = d.get("geometry") or LineString([(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])])
            self.edges[edge_id(u, v, k)] = (u, v, k, geom, _name(d), d.get("length", 0.0))
        self.ids = list(self.edges)
        self.tree = STRtree([transform(self.to_m, self.edges[i][3]) for i in self.ids])
        self.mids = STRtree([self.edges[i][3].interpolate(0.5, normalized=True) for i in self.ids])
        nodes = list(G.nodes(data=True))
        self.node_ids = [n for n, _ in nodes]
        self.node_xy = np.column_stack(self.to_m([d["x"] for _, d in nodes], [d["y"] for _, d in nodes]))

    def snap(self, lat, lon):
        """Nearest edge within SNAP_M metres, or None. Both directions of a two-way street are
        the same road under water, so the caller should apply the observation to twin_ids()."""
        p = Point(*self.to_m(lon, lat))
        hit = self.tree.query_nearest(p, max_distance=SNAP_M)
        return self.ids[int(hit[0])] if len(hit) else None

    def twin_ids(self, eid):
        u, v, _, _, _, _ = self.edges[eid]
        return [edge_id(a, b, k) for a, b in ((u, v), (v, u)) if self.G.has_edge(a, b) for k in self.G[a][b]]

    def nearest_node(self, lat, lon):
        x, y = self.to_m(lon, lat)
        return self.node_ids[int(np.argmin(((self.node_xy - [x, y]) ** 2).sum(1)))]

    def edges_in(self, polygons):
        """Edge ids whose midpoint falls inside any polygon (lon/lat shapely geometries)."""
        out = set()
        for poly in polygons:
            for i in self.mids.query(poly, predicate="contains"):
                out.add(self.ids[int(i)])
        return out

    def feature(self, eid, props):
        return {"type": "Feature", "geometry": mapping(self.edges[eid][3]), "properties": {"edge_id": eid, "name": self.edges[eid][4], **props}}

    def route(self, a, b, vehicle, states, alert_polys=()):
        """a, b: (lat, lon). states: edge_id -> fusion state. Returns the API.md RouteResponse."""
        limit = VEHICLES[vehicle]["limit_cm"]
        in_alert = self.edges_in(alert_polys) if alert_polys else set()

        def reason(eid):
            s = states.get(eid)
            if not s or s["state"] == "stale":
                return None
            if s["state"] == "reported_unknown":
                # water was photographed but its depth couldn't be read: the upper bound is unbounded
                return "water reported, depth unreadable"
            if s["high_cm"] > limit:
                return f"reported up to {s['high_cm']:.0f} cm; {VEHICLES[vehicle]['label'].lower()} limit {limit} cm"
            return None

        def cost(u, v, keys):
            best = None
            for k, d in keys.items():
                eid = edge_id(u, v, k)
                if reason(eid):
                    continue  # blocked: never relaxed, even if that means no route
                s = states.get(eid)
                c = d.get("length", 1.0)
                if not s or s["state"] == "stale":
                    c *= ALERT_UNKNOWN_COST if eid in in_alert else UNKNOWN_COST
                best = c if best is None else min(best, c)
            return best

        src, dst = self.nearest_node(*a), self.nearest_node(*b)
        try:
            base = nx.shortest_path(self.G, src, dst, weight="length")
        except nx.NetworkXNoPath:
            base = []
        avoided, seen = [], set()
        for eid in self._path_edges(base, lambda u, v: min(self.G[u][v], key=lambda k: self.G[u][v][k].get("length", 0))):
            r, name = reason(eid), self.edges[eid][4]
            if r and name not in seen:
                seen.add(name)
                s = states[eid]
                avoided.append({"edge_id": eid, "name": name, "state": s["state"], "high_cm": s["high_cm"], "reason": r, "evidence": s["evidence"]})
        try:
            path = nx.shortest_path(self.G, src, dst, weight=cost)
        except nx.NetworkXNoPath:
            return {"found": False, "reason": f"No route avoids reported deep water for a {VEHICLES[vehicle]['label'].lower()}.", "avoided": avoided}

        chosen = list(self._path_edges(path, lambda u, v: min(self.G[u][v], key=lambda k: cost(u, v, {k: self.G[u][v][k]}) or math.inf)))
        coords, dist, unknown_m, unknown_alert_m = [], 0.0, 0.0, 0.0
        for eid in chosen:
            u, v, _, geom, _, length = self.edges[eid]
            pts = list(geom.coords)
            if pts and (round(pts[0][0], 7), round(pts[0][1], 7)) != (round(self.G.nodes[u]["x"], 7), round(self.G.nodes[u]["y"], 7)):
                pts.reverse()
            coords.extend(pts if not coords else pts[1:])
            dist += length
            s = states.get(eid)
            if not s or s["state"] in ("stale", "reported_unknown"):
                unknown_m += length
                unknown_alert_m += length if eid in in_alert else 0
        warnings = []
        if unknown_alert_m:
            warnings.append(f"Route passes {unknown_alert_m:.0f} m of streets with no recent reports inside an active flood warning.")
        return {"found": True, "geometry": {"type": "LineString", "coordinates": coords}, "distance_m": round(dist),
                "avoided": avoided, "unknown_m": round(unknown_m), "warnings": warnings}

    @staticmethod
    def _path_edges(path, pick_key):
        for u, v in zip(path, path[1:]):
            yield edge_id(u, v, pick_key(u, v))
