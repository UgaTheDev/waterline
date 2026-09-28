"""Dedupe eval/pool.csv: cluster near-duplicate burst shots, keep one rep per cluster.

  python scripts/dedupe_pool.py            # writes eval/pool.csv + eval/pool_dupes.csv in place

Uses dHash (difference hash, 8x8 -> 64 bit) since it's a few lines with pillow+numpy
and robust enough for near-duplicate bursts (crops/recompressions/minor exposure
shifts score close in Hamming distance; unrelated photos score ~32/64, near random).

Threshold picked at 10 (of 64 bits) by building side-by-side contact sheets
(scratch space) for real pairs at every distance from 0 to 20 and eyeballing
them: distances 0-11 were all true positives (identical Openverse re-uploads,
crops, or burst frames of the same scene/moment), but distance 12 was already
a false positive (two unrelated flood photos, wet-road textures happen to
gradient-hash close). Since 12 breaks and 11 holds but is right at the edge,
10 is used to leave margin. This dataset has lots of visually-similar wet
pavement/greenery, which pushes unrelated-photo distances down from the
usual ~32 random-hash midpoint, so lower is safer than higher here. Anything
missed under this threshold is caught by the group-aware split below, which
only needs the dupes it does catch to keep whole clusters on one side.
"""
import csv, pathlib, sys
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
POOL = ROOT / "eval/pool.csv"
DUPES = ROOT / "eval/pool_dupes.csv"
# images are gitignored: only exist in the main repo checkout, not in this worktree
MAIN_REPO = pathlib.Path("/Users/kushzingade/Documents/Hackathons/NVIDIA")
FIELDS = ["path", "source", "license", "credit", "lat", "lon", "group", "event"]
DIST_THRESHOLD = 10  # Hamming distance over 64 bits; see docstring


def dhash(path, size=8):
    img = Image.open(path).convert("L").resize((size + 1, size), Image.LANCZOS)
    a = np.asarray(img, dtype=np.int16)
    diff = a[:, 1:] > a[:, :-1]
    bits = "".join("1" if b else "0" for b in diff.flatten())
    return int(bits, 2)


def hamming(a, b):
    return bin(a ^ b).count("1")


def resolution(path):
    with Image.open(path) as im:
        return im.width * im.height


def cluster(rows_with_hash):
    """Union-find over pairs within DIST_THRESHOLD. O(n^2) over ~216 images; fine."""
    n = len(rows_with_hash)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(n):
        for j in range(i + 1, n):
            if hamming(rows_with_hash[i][1], rows_with_hash[j][1]) <= DIST_THRESHOLD:
                union(i, j)

    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return groups


def main():
    rows = list(csv.DictReader(open(POOL)))
    hashes = []
    for r in rows:
        p = MAIN_REPO / r["path"]
        try:
            hashes.append((r, dhash(p)))
        except Exception as e:
            sys.exit(f"failed to hash {p}: {e}")

    groups = cluster(hashes)

    kept, dupes = [], []
    # stable group ids: sorted by min original row index, so reruns are idempotent
    for gid, idxs in enumerate(sorted(groups.values(), key=min)):
        members = [hashes[i][0] for i in idxs]
        rep = max(members, key=lambda r: resolution(MAIN_REPO / r["path"]))
        for m in members:
            out = {**m, "group": gid}
            if m["path"] == rep["path"]:
                kept.append(out)
            else:
                dupes.append({"path": m["path"], "kept": rep["path"], "group": gid})

    kept.sort(key=lambda r: r["group"])
    with open(POOL, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        for r in kept:
            w.writerow({k: r.get(k, "") for k in FIELDS})

    with open(DUPES, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["path", "kept", "group"])
        w.writeheader()
        w.writerows(dupes)

    print(f"{len(rows)} -> {len(kept)} kept, {len(dupes)} dupes removed, {len(groups)} groups")


def demo():
    """ponytail check: hamming distance sanity, and cluster() finds transitive groups."""
    assert hamming(0b1010, 0b1010) == 0
    assert hamming(0b1111, 0b0000) == 4
    fake = [(None, 0b0000), (None, 0b0001), (None, 0b1111)]
    groups = cluster(fake)
    global DIST_THRESHOLD
    old = DIST_THRESHOLD
    try:
        DIST_THRESHOLD = 1
        groups = cluster(fake)
        assert len(groups) == 2, groups  # {0,1} close, {2} far
    finally:
        DIST_THRESHOLD = old
    print("demo ok")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        demo()
    else:
        main()
