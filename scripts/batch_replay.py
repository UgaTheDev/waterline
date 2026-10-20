"""Run the depth model over an event's replay photos once and cache everything, so the hosted demo needs no GPU.

  python -m scripts.batch_replay [event_id]          (default harvey2017; needs TF_KEY, or DEPTH_PROVIDER=cosmos + COSMOS_URL)
Reads data/cache/events/<id>/replay_manifest.csv; writes data/cache/events/<id>/replay_observations.json and the served
frames to data/cache/media/*.jpg (obs ids are unique across events). Resumable: observations already in the output are
skipped. If you used the Cosmos VM, stop it afterwards.
"""
import csv, json, os, sys, urllib.parse
os.environ.setdefault("WATERLINE_LOAD_ENV", "1")  # read keys from .env (shell values win)
from backend import depth, events
from backend.profiles import CACHE, ROOT

E = events.registry(include_incomplete=True)[sys.argv[1] if len(sys.argv) > 1 else events.DEFAULT]
out_p, media = E["dir"] / "replay_observations.json", CACHE / "media"
media.mkdir(parents=True, exist_ok=True)
done = {o["obs_id"]: o for o in json.loads(out_p.read_text())} if out_p.exists() else {}
roads = events.load(E["id"], "roads")
c = depth.client()
manifest = E["dir"] / "replay_manifest.csv"
rows = list(csv.DictReader(open(manifest))) if manifest.exists() else []
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
                         "image_url": f"/media/{r['obs_id']}.jpg",
                         "model": depth.model(), "endpoint": urllib.parse.urlparse(depth.P.TF_URL if depth.P.DEPTH_PROVIDER != "cosmos" else depth.P.COSMOS_URL).hostname}
    out_p.write_text(json.dumps(list(done.values()), indent=1))  # write every step: safe to interrupt
    print(f"{i + 1}/{len(rows)} {r['obs_id']} {done[r['obs_id']]['status']} high={done[r['obs_id']]['high_cm']}", file=sys.stderr)
print(f"{len(done)} observations cached; skipped {len(skipped)}: {skipped[:5]}")
