#!/usr/bin/env python3
# Precision note (2026-09-28): of 103 harvested non-Harvey photos, only 19 (18%) showed flood water on a road with a
# reference object; the rest (relief logistics, aerials, rail washouts, debris) were dropped by visual review.
"""Harvest eval-only flood-road photos from other US flood events: Hurricane Ida
(2021, NY/NJ/PA/LA), Hurricane Helene (2024, NC/SC/GA/TN) and the July 2023
Vermont/northeastern floods. Eval-only, so no location/geotag work (unlike
scripts/harvest_commons.py, which also builds the Harvey replay manifest).

Reuses the license filter, User-Agent style and throttling from
scripts/harvest_commons.py and scripts/harvest_openverse.py.

Usage: python3 scripts/harvest_more_events.py
Writes images to <main repo>/data/raw/eval_pool/ (gitignored) and appends
rows (with an `event` column) to eval/pool.csv. Re-runnable: skips paths
already in pool.csv.
"""
import csv, json, os, re, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# images are gitignored: only exist in the main repo checkout, not in a worktree
MAIN_REPO = "/Users/kushzingade/Documents/Hackathons/NVIDIA"
POOL_DIR = os.path.join(MAIN_REPO, "data", "raw", "eval_pool")
POOL_CSV_PATH = os.path.join(ROOT, "eval", "pool.csv")
FIELDS = ["path", "source", "license", "credit", "lat", "lon", "group", "event"]

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "WaterlineFloodDemo/1.0 (Nebius x NVIDIA hackathon eval data harvest; https://github.com/UgaTheDev)"}

# Category names verified via list=search over the Category namespace (see
# harvest_commons.py's own note on why a blind geosearch pulls in unrelated
# photos): each is the real, on-topic category for that state/event.
COMMONS_CATEGORIES = {
    "ida2021": [
        "Category:Effects of Hurricane Ida (2021) in Louisiana",
        "Category:Effects of Hurricane Ida (2021) in New Jersey",
        "Category:Effects of Hurricane Ida (2021) in New York City",
        "Category:Effects of Hurricane Ida (2021) in Pennsylvania",
    ],
    "helene2024": [
        "Category:Effects of Hurricane Helene (2024) in North Carolina",
        "Category:Effects of Hurricane Helene (2024) in South Carolina",
        "Category:Effects of Hurricane Helene (2024) in Georgia (U.S. state)",
        "Category:Effects of Hurricane Helene (2024) in Tennessee",
    ],
    "vermont2023": [
        "Category:July 2023 northeastern United States flash floods",
    ],
}

OPENVERSE_QUERIES = {
    "ida2021": ["hurricane ida flooded street", "hurricane ida flooding new jersey", "hurricane ida flooding new orleans"],
    "helene2024": ["hurricane helene flooded road", "hurricane helene flooding asheville", "helene flood north carolina"],
    "vermont2023": ["vermont flood 2023 road", "vermont flooding montpelier"],
}

ALLOWED_LICENSES = {"public domain", "pd", "cc0"}
PD_PREFIXES = ("pd-", "public domain")
CC_BY_ONLY = "cc-by"  # accept cc-by-*, reject cc-by-sa

WATER_KEYWORDS = ("flood", "flooding", "flooded", "high water", "inundat", "submerg", "underwater")
ROAD_KEYWORDS = ("road", "street", "highway", "drive", "avenue", "car", "vehicle", "truck", "traffic")
GAUGE_EXCLUDE_KEYWORDS = ("gauge", "staff gauge", "measuring tape", "yardstick", "ruler")
NONMATCH_KEYWORDS = ("satellite", "aerial", "radar", "map", "press conference", "briefing", "podium",
                     "portrait", "headshot", "seal", "logo", "flag", "interior", "hearing")

MAX_COMMONS_CALLS = 40
_commons_calls = 0


def api_get(params):
    global _commons_calls
    if _commons_calls >= MAX_COMMONS_CALLS:
        raise RuntimeError("Commons API call budget exhausted")
    url = API + "?" + urllib.parse.urlencode(dict(params, format="json"))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    _commons_calls += 1
    time.sleep(1.0)
    return data


def category_members(cat_title):
    titles, cont = [], None
    while True:
        params = {"action": "query", "list": "categorymembers", "cmtitle": cat_title, "cmnamespace": 6, "cmlimit": 500}
        if cont:
            params["cmcontinue"] = cont
        data = api_get(params)
        titles.extend(m["title"] for m in data.get("query", {}).get("categorymembers", []))
        cont = data.get("continue", {}).get("cmcontinue")
        if not cont:
            break
    return titles


def get_imageinfo(titles):
    results = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        params = {"action": "query", "titles": "|".join(batch), "prop": "imageinfo",
                  "iiprop": "url|extmetadata|size", "iiurlwidth": 1280}
        data = api_get(params)
        for _, page in data.get("query", {}).get("pages", {}).items():
            if page.get("title"):
                results[page["title"]] = page
    return results


def license_ok(short_name, license_code):
    s, c = (short_name or "").lower(), (license_code or "").lower()
    if s in ALLOWED_LICENSES or c in ALLOWED_LICENSES:
        return True
    if s.startswith(PD_PREFIXES) or c.startswith("pd"):
        return True
    if (s.startswith(CC_BY_ONLY) and "sa" not in s) or (c.startswith(CC_BY_ONLY) and "sa" not in c):
        return True
    return False


def download(url, dest_path):
    if os.path.exists(dest_path):
        return True
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as resp, open(dest_path, "wb") as out:
            out.write(resp.read())
        time.sleep(1.0)
        return True
    except Exception as e:
        print(f"download failed for {url}: {e}")
        return False


def build_credit(meta):
    artist = re.sub("<[^>]+>", "", meta.get("Artist", {}).get("value", "Unknown"))
    artist = " ".join(artist.split())
    license_short = meta.get("LicenseShortName", {}).get("value") or meta.get("License", {}).get("value") or "Unknown"
    return f"{artist}, {license_short}, via Wikimedia Commons"


def looks_like_flooded_road(text):
    return any(k in text for k in WATER_KEYWORDS) and any(k in text for k in ROAD_KEYWORDS) \
        and not any(k in text for k in GAUGE_EXCLUDE_KEYWORDS) and not any(k in text for k in NONMATCH_KEYWORDS)


def harvest_commons_event(event, categories, existing_paths, per_event_target=90):
    rows = []
    titles = []
    for cat in categories:
        try:
            titles.extend(category_members(cat))
        except RuntimeError:
            break
    pages = get_imageinfo(titles) if titles else {}
    for title, page in pages.items():
        if len(rows) >= per_event_target:
            break
        pageid = page.get("pageid")
        rel_path = os.path.relpath(os.path.join(POOL_DIR, f"{event}-{pageid}.jpg"), MAIN_REPO)
        if rel_path in existing_paths:
            continue
        imageinfo = page.get("imageinfo")
        if not imageinfo:
            continue
        info = imageinfo[0]
        meta = info.get("extmetadata", {})
        if not license_ok(meta.get("LicenseShortName", {}).get("value"), meta.get("License", {}).get("value")):
            continue
        description = meta.get("ImageDescription", {}).get("value", "")
        text = (title + " " + description).lower()
        if not looks_like_flooded_road(text):
            continue
        dest_path = os.path.join(POOL_DIR, f"{event}-{pageid}.jpg")
        if not download(info.get("thumburl") or info.get("url"), dest_path):
            continue
        rows.append({"path": rel_path, "source": f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
                     "license": meta.get("LicenseShortName", {}).get("value") or meta.get("License", {}).get("value") or "Unknown",
                     "credit": build_credit(meta), "lat": "", "lon": "", "group": "", "event": event})
        existing_paths.add(rel_path)
    return rows


def flickr_id(s):
    m = re.search(r"(\d{10,11})", s or "")
    return m.group(1) if m else None


def harvest_openverse_event(event, queries, existing_paths, seen_ids, per_event_target=40):
    rows = []
    for q in queries:
        for page in range(1, 3):
            if len(rows) >= per_event_target:
                return rows
            url = "https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(
                {"q": q, "license": "by,cc0,pdm", "page_size": 20, "page": page, "mature": "false"})
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                d = json.loads(r.read())
            time.sleep(1)
            for x in d.get("results", []):
                fid = flickr_id(x["foreign_landing_url"]) or x["id"]
                if fid in seen_ids:
                    continue
                if any(k in (x.get("title") or "").lower() for k in NONMATCH_KEYWORDS):
                    continue
                seen_ids.add(fid)
                rel_path = os.path.relpath(os.path.join(POOL_DIR, f"{event}-ov-{fid}.jpg"), MAIN_REPO)
                if rel_path in existing_paths:
                    continue
                dest = os.path.join(POOL_DIR, f"{event}-ov-{fid}.jpg")
                if not download(x["url"], dest):
                    continue
                lic = f"{'CC ' + x['license'].upper() if x['license'] not in ('pdm', 'cc0') else x['license'].upper()} {x.get('license_version') or ''}".strip()
                rows.append({"path": rel_path, "source": x["foreign_landing_url"], "license": lic,
                             "credit": f"{x.get('creator') or 'Unknown'}, {lic}, via {x['source'].title()}",
                             "lat": "", "lon": "", "group": "", "event": event})
                existing_paths.add(rel_path)
            if page >= d.get("page_count", 1):
                break
    return rows


def main():
    os.makedirs(POOL_DIR, exist_ok=True)
    pool = list(csv.DictReader(open(POOL_CSV_PATH))) if os.path.exists(POOL_CSV_PATH) else []
    for r in pool:
        r.setdefault("event", "harvey2017")  # existing rows are all Harvey
    existing_paths = {r["path"] for r in pool}
    seen_flickr = {flickr_id(r["source"]) for r in pool} | {flickr_id(r["path"]) for r in pool}

    added_by_event = {}
    for event, cats in COMMONS_CATEGORIES.items():
        new = harvest_commons_event(event, cats, existing_paths)
        pool.extend(new)
        added_by_event[event] = added_by_event.get(event, 0) + len(new)

    for event, queries in OPENVERSE_QUERIES.items():
        new = harvest_openverse_event(event, queries, existing_paths, seen_flickr)
        pool.extend(new)
        added_by_event[event] = added_by_event.get(event, 0) + len(new)

    with open(POOL_CSV_PATH, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in pool:
            w.writerow({k: r.get(k, "") for k in FIELDS})

    print(f"pool now {len(pool)} rows. Added: {added_by_event}. Commons calls: {_commons_calls}")


if __name__ == "__main__":
    main()
