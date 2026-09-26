"""Openverse (no key) -> more CC BY / CC0 / PD Harvey flood photos for the eval pool (no location needed).

  python3 scripts/harvest_openverse.py
Openverse strips no licensing info but has no geotags, so these are eval-only, never replay.
Dedupes against eval/pool.csv by Flickr photo id (many Commons files are Flickr mirrors).
"""
import csv, json, pathlib, re, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {"User-Agent": "WaterlineFloodDemo/1.0 (Nebius x NVIDIA hackathon; https://github.com/UgaTheDev)"}
POOL, RAW = ROOT / "eval/pool.csv", ROOT / "data/raw/eval_pool"
QUERIES = ["hurricane harvey flooded street", "hurricane harvey houston flood", "harvey flood car", "harvey flooding road"]
SKIP = re.compile(r"satellite|aerial|map|radar|nasa|goes|landsat|press conference|briefing", re.I)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def flickr_id(s):
    m = re.search(r"(\d{10,11})", s or "")
    return m.group(1) if m else None


pool = list(csv.DictReader(open(POOL))) if POOL.exists() else []
seen = {flickr_id(r["source"]) for r in pool} | {flickr_id(r["path"]) for r in pool}
RAW.mkdir(parents=True, exist_ok=True)
added = 0
for q in QUERIES:
    for page in range(1, 4):
        d = json.loads(get("https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(
            {"q": q, "license": "by,cc0,pdm", "page_size": 20, "page": page, "mature": "false"})))
        time.sleep(1)
        for x in d.get("results", []):
            fid = flickr_id(x["foreign_landing_url"]) or x["id"]
            if fid in seen or SKIP.search(x.get("title") or ""):
                continue
            seen.add(fid)
            dest = RAW / f"ov-{fid}.jpg"
            try:
                if not dest.exists():
                    dest.write_bytes(get(x["url"]))
                    time.sleep(0.5)
            except Exception as e:
                print("skip", fid, e)
                continue
            lic = f"{'CC ' + x['license'].upper() if x['license'] not in ('pdm', 'cc0') else x['license'].upper()} {x.get('license_version') or ''}".strip()
            pool.append({"path": str(dest.relative_to(ROOT)), "source": x["foreign_landing_url"], "license": lic,
                         "credit": f"{x.get('creator') or 'Unknown'}, {lic}, via {x['source'].title()}", "lat": "", "lon": ""})
            added += 1
        if page >= d.get("page_count", 1):
            break
w = csv.DictWriter(open(POOL, "w", newline=""), fieldnames=["path", "source", "license", "credit", "lat", "lon"])
w.writeheader()
w.writerows(pool)
print(f"added {added}; pool now {len(pool)}")
