"""Run Cosmos over the replay photos once and cache everything, so the hosted demo needs no GPU.

  COSMOS_URL=http://<vm>:8000/v1 COSMOS_KEY=... python -m scripts.batch_replay
Reads data/cache/replay_manifest.csv; writes data/cache/replay_observations.json + data/cache/media/*.jpg.
Resumable: observations already in the output are skipped. Stop the GPU VM afterwards.
"""
import csv, json, sys
import osmnx as ox
from backend import depth
from backend.profiles import CACHE, ROOT
from backend.router import Roads

out_p, media = CACHE / "replay_observations.json", CACHE / "media"
media.mkdir(parents=True, exist_ok=True)
done = {o["obs_id"]: o for o in json.loads(out_p.read_text())} if out_p.exists() else {}
roads = Roads(ox.load_graphml(CACHE / "graph.graphml"))
c = depth.client()
rows = list(csv.DictReader(open(CACHE / "replay_manifest.csv")))
skipped = []
for i, r in enumerate(rows):
    if r["obs_id"] in done:
        continue
    if r.get("use_in_replay", "yes") != "yes":  # visual check: river views would mark a dry bridge as flooded
        skipped.append((r["obs_id"], r["use_in_replay"]))
        continue
    if r.get("precision") == "neighbourhood":  # a centroid would pin the water on an arbitrary street
        skipped.append((r["obs_id"], "location only known to neighbourhood"))
        continue
    eid = roads.snap(float(r["lat"]), float(r["lon"]))
    if not eid:
        skipped.append((r["obs_id"], "no road within snap distance"))
        continue
    frame = depth.prepare_image((ROOT / r["path"]).read_bytes())
    (media / f"{r['obs_id']}.jpg").write_bytes(depth.prepare_image(frame, max_px=800))
    done[r["obs_id"]] = {"obs_id": r["obs_id"], "edge_id": eid, "time": r["time"], "lat": float(r["lat"]), "lon": float(r["lon"]),
                         **depth.estimate(frame, c=c), "credit": r["credit"], "source_url": r["source_url"],
                         "location_source": r.get("location_source") or "exif", "precision": r.get("precision") or "exact",
                         "image_url": f"/media/{r['obs_id']}.jpg"}
    out_p.write_text(json.dumps(list(done.values()), indent=1))  # write every step: safe to interrupt
    print(f"{i + 1}/{len(rows)} {r['obs_id']} {done[r['obs_id']]['status']} high={done[r['obs_id']]['high_cm']}", file=sys.stderr)
print(f"{len(done)} observations cached; skipped {len(skipped)}: {skipped[:5]}")
