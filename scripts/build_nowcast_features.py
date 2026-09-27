"""Static per-edge terrain features for the nowcast: data/cache/nowcast_static.npz. Run: python -m scripts.build_nowcast_features

- ground_cm: lowest 3DEP ground along the edge (5 m cells, NAVD88 cm), and where it is (lon, lat).
- depression_cm: sink-filled DEM minus DEM at that low point. Fill = priority-flood on the 5 m DEM, drained from the bbox
  border (pure Python, ~2 min). Bare-earth DEM: road embankments over culverts read as dams, so some "depressions" drain.
- hand_cm: edge ground minus the ground at the nearest OSM river|canal point (the bayous) within 2 km; NaN beyond.
  Waterway ground = lowest 5 m cell within 10 m of the mapped line (the line is often drawn beside the channel bed).
  Fetched: river|stream|canal|drain. Referenced: river|canal only. Against the nearest of all four, street ditches and
  small drains become "the drainage" and HAND ranks deep-water streets worse (AUC 0.535 vs 0.575 survey+inferred,
  0.568 vs 0.641 survey only). NOTE: that choice was made looking at all labels, so it is not held out.
- skip: bridge / tunnel edges (bare-earth DEM is not the deck) -> the nowcast never scores them.
"""
import heapq
import numpy as np
import osmnx as ox
from scipy import ndimage
from scipy.spatial import cKDTree
from backend import terrain
from backend.profiles import BBOX, CACHE

STEP_M = 5
HAND_MAX_M = 2000


def fill(z):
    """Priority-flood (Barnes et al. 2014): lowest spill elevation of every cell, drained from the border."""
    rows, cols = z.shape
    out = z.copy()
    done = np.zeros(z.shape, bool)
    done[0, :] = done[-1, :] = done[:, 0] = done[:, -1] = True
    rr, cc = np.nonzero(done)
    pq = list(zip(z[rr, cc].tolist(), rr.tolist(), cc.tolist()))
    heapq.heapify(pq)
    flat, zf, df = out.ravel(), z.ravel(), done.ravel()
    offs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    while pq:
        h, r, c = heapq.heappop(pq)
        for dr, dc in offs:
            a, b = r + dr, c + dc
            if 0 <= a < rows and 0 <= b < cols:
                i = a * cols + b
                if not df[i]:
                    df[i] = True
                    v = zf[i] if zf[i] > h else h
                    flat[i] = v
                    heapq.heappush(pq, (v, a, b))
    return out


def main():
    D, R = terrain.dem(), terrain.roads()
    z = np.nan_to_num(D.z, nan=np.nanmin(D.z))  # voids (none in the current DEM) drain like water
    dep_grid = fill(z) - z
    print("filled; cells deeper than 30 cm:", float((dep_grid > 30).mean()))

    ids = R.ids
    n = len(ids)
    ground, lon, lat, dep, skip = *(np.full(n, np.nan, np.float32) for _ in range(4)), np.zeros(n, bool)
    for j, eid in enumerate(ids):
        u, v, k, geom, _, _ = R.edges[eid]
        if terrain._bridge(R.G[u][v][k]):
            skip[j] = True
            continue
        xy = np.asarray(geom.coords)
        seg = np.hypot(*(np.diff(np.column_stack(R.to_m(xy[:, 0], xy[:, 1])), axis=0).T))
        p = np.vstack([xy[:1]] + [xy[i] + np.outer(np.linspace(0, 1, max(1, int(L // STEP_M)) + 1)[1:], xy[i + 1] - xy[i]) for i, L in enumerate(seg)])
        rr, cc = D.cell(p[:, 0], p[:, 1])
        ok = (rr >= 0) & (rr < D.rows) & (cc >= 0) & (cc < D.cols)
        if not ok.any():
            skip[j] = True
            continue
        rr, cc, p = rr[ok], cc[ok], p[ok]
        g = D.z[rr, cc]
        i = int(np.nanargmin(g))
        ground[j], (lon[j], lat[j]) = g[i], p[i]
        dep[j] = dep_grid[rr[i], cc[i]]

    w, s, e, nn = BBOX
    pad = 0.02  # ~2 km: a channel just outside the bbox still drains edges near its border
    ww = ox.features_from_bbox((w - pad, s - pad, e + pad, nn + pad), {"waterway": ["river", "stream", "canal", "drain"]})
    pts = []
    for geom in ww.geometry[ww["waterway"].isin(["river", "canal"])]:
        for line in getattr(geom, "geoms", [geom]):
            if line.geom_type in ("LineString", "LinearRing"):
                L = line.length * 111000
                pts.append(np.array([line.interpolate(f, normalized=True).coords[0] for f in np.linspace(0, 1, max(2, int(L // 10)))]))
    pts = np.vstack(pts)
    rr, cc = D.cell(pts[:, 0], pts[:, 1])
    ok = (rr >= 0) & (rr < D.rows) & (cc >= 0) & (cc < D.cols)
    pts, rr, cc = pts[ok], rr[ok], cc[ok]
    zmin = ndimage.minimum_filter(np.nan_to_num(D.z, nan=np.inf), size=5)  # 5x5 cells: ~10 m either side of the line
    wg = zmin[rr, cc]
    print("waterway sample points in DEM:", len(pts))
    tree = cKDTree(np.column_stack(R.to_m(pts[:, 0], pts[:, 1])))
    have = ~np.isnan(lon)
    d, k = tree.query(np.column_stack(R.to_m(lon[have], lat[have])), distance_upper_bound=HAND_MAX_M)
    hand = np.full(n, np.nan, np.float32)
    near = np.isfinite(d)
    hv = np.full(have.sum(), np.nan, np.float32)
    hv[near] = ground[have][near] - wg[k[near]]
    hand[have] = hv
    np.savez_compressed(CACHE / "nowcast_static.npz", edge_id=np.array(ids), ground_cm=ground, lon=lon, lat=lat,
                        depression_cm=dep.round(1), hand_cm=hand.round(0), skip=skip)
    print("edges", n, "skipped", int(skip.sum()), "no waterway within 2 km", int(np.isnan(hand[~skip]).sum()),
          "median hand m", float(np.nanmedian(hand) / 100), "edges in a >30 cm depression", int((dep > 30).sum()))


if __name__ == "__main__":
    main()
