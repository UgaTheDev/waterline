"""Geotagged, license-clean Harvey street-flood photos from Flickr -> replay manifest + eval pool.

  set -a; . ./.env; set +a; python3 scripts/harvest_flickr.py      (needs FLICKR_KEY)

Only licenses whose Flickr name is CC BY (not BY-SA/NC/ND), CC0, Public Domain Mark, US Government Work
or "No known copyright restrictions". Street-level geo accuracy only. New replay rows are
use_in_replay=unchecked: a human looks at each before it can mark a street as flooded.
"""
import csv, json, os, pathlib, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEY = os.environ["FLICKR_KEY"]
UA = {"User-Agent": "WaterlineFloodDemo/1.0 (Nebius x NVIDIA hackathon demo data harvest; https://github.com/UgaTheDev)"}
BBOX = "-95.50,29.66,-95.33,29.81"  # matches backend/profiles.py
MANIFEST, POOL = ROOT / "data/cache/replay_manifest.csv", ROOT / "eval/pool.csv"
RAW = ROOT / "data/raw/replay"
MAX_PAGES = 8  # 250 results each
HOU = ZoneInfo("America/Chicago")


def call(method, **p):
    p.update(method=method, api_key=KEY, format="json", nojsoncallback=1)
    with urllib.request.urlopen(urllib.request.Request("https://api.flickr.com/services/rest/?" + urllib.parse.urlencode(p), headers=UA), timeout=60) as r:
        d = json.load(r)
    time.sleep(1)
    if d.get("stat") != "ok":
        raise RuntimeError(d.get("message"))
    return d


def allowed_licenses():
    ok = {}
    for l in call("flickr.photos.licenses.getInfo")["licenses"]["license"]:
        n = l["name"].lower()
        by_only = "attribution" in n and not any(k in n for k in ("sharealike", "noncommercial", "noderivs", "no derivatives", "non-commercial"))
        if by_only or any(k in n for k in ("public domain", "cc0", "united states government", "no known copyright")):
            ok[str(l["id"])] = l["name"]
    return ok


def main():
    lic = allowed_licenses()
    print("licenses:", lic)
    rows, seen = [], set()
    for text in ("flood", "flooding", "harvey"):
        for page in range(1, MAX_PAGES + 1):
            d = call("flickr.photos.search", bbox=BBOX, text=text, license=",".join(lic), has_geo=1, accuracy=15,
                     min_taken_date="2017-08-26 00:00:00", max_taken_date="2017-08-31 23:59:59", content_type=1,
                     extras="geo,date_taken,license,owner_name,url_l,url_c", per_page=250, page=page)
            ph = d["photos"]
            for p in ph["photo"]:
                if p["id"] not in seen and (p.get("url_l") or p.get("url_c")) and int(p.get("accuracy", 0)) >= 15:
                    seen.add(p["id"])
                    rows.append(p)
            if page >= ph["pages"]:
                break
    print(f"{len(rows)} candidate photos")

    manifest = list(csv.DictReader(open(MANIFEST))) if MANIFEST.exists() else []
    have = {r["obs_id"] for r in manifest}
    fields = list(manifest[0]) if manifest else ["obs_id", "path", "lat", "lon", "time", "license", "credit", "source_url", "title",
                                                 "shows_water", "location_source", "precision", "use_in_replay"]
    RAW.mkdir(parents=True, exist_ok=True)
    added = 0
    for p in rows:
        oid = f"flickr-{p['id']}"
        if oid in have:
            continue
        dest = RAW / f"{oid}.jpg"
        if not dest.exists():
            try:
                with urllib.request.urlopen(urllib.request.Request(p.get("url_l") or p["url_c"], headers=UA), timeout=60) as r:
                    dest.write_bytes(r.read())
                time.sleep(0.5)
            except Exception as e:
                print("skip", oid, e)
                continue
        # Flickr datetaken is camera-local time: Houston
        iso = datetime.strptime(p["datetaken"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=HOU).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        manifest.append({"obs_id": oid, "path": str(dest.relative_to(ROOT)), "lat": p["latitude"], "lon": p["longitude"], "time": iso,
                         "license": lic[str(p["license"])], "credit": f"{p['ownername']}, {lic[str(p['license'])]}, via Flickr",
                         "source_url": f"https://www.flickr.com/photos/{p['owner']}/{p['id']}", "title": p["title"][:120],
                         "shows_water": "maybe", "location_source": "flickr_geo", "precision": "exact", "use_in_replay": "unchecked"})
        have.add(oid)
        added += 1
    w = csv.DictWriter(open(MANIFEST, "w", newline=""), fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    w.writerows(manifest)

    pool = list(csv.DictReader(open(POOL))) if POOL.exists() else []
    in_pool = {r["path"] for r in pool}
    for r in manifest:
        if r["obs_id"].startswith("flickr-") and r["path"] not in in_pool:
            pool.append({"path": r["path"], "source": r["source_url"], "license": r["license"], "credit": r["credit"], "lat": r["lat"], "lon": r["lon"]})
    w = csv.DictWriter(open(POOL, "w", newline=""), fieldnames=["path", "source", "license", "credit", "lat", "lon"])
    w.writeheader()
    w.writerows(pool)
    print(f"added {added} replay candidates (unchecked); pool now {len(pool)}")


if __name__ == "__main__":
    main()
