#!/usr/bin/env python3
"""Harvest license-clean Hurricane Harvey (Houston) street-flooding photos
from Wikimedia Commons for two uses: a demo replay (needs a location) and a
depth-estimation eval pool (doesn't).

Source: Category:Effects of Hurricane Harvey in Houston (349 files, verified
via the API to be the precise, on-topic category -- a blind geosearch around
Houston bbox points pulls in unrelated business/storefront photos instead).
It has no subcategories, and no other Commons category name matched "Houston
flood(ing)" better than this one (checked via list=search on the Category
namespace).

Usage: python3 scripts/harvest_commons.py

Writes:
  data/raw/replay/<pageid>.jpg      (1280px thumbnails, gitignored)
  data/raw/eval_pool/<pageid>.jpg   (1280px thumbnails, gitignored)
  data/cache/replay_manifest.csv     (obs_id,path,lat,lon,time,license,credit,source_url,title,shows_water,location_source,precision)
  eval/pool.csv                      (path,source,license,credit,lat,lon)

Re-runnable: skips files already in the manifest / pool.
"""
import csv
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime

API = "https://commons.wikimedia.org/w/api.php"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
UA = "WaterlineFloodDemo/1.0 (Nebius x NVIDIA hackathon demo data harvest; https://github.com/UgaTheDev)"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLAY_DIR = os.path.join(ROOT, "data", "raw", "replay")
POOL_DIR = os.path.join(ROOT, "data", "raw", "eval_pool")
MANIFEST_PATH = os.path.join(ROOT, "data", "cache", "replay_manifest.csv")
POOL_CSV_PATH = os.path.join(ROOT, "eval", "pool.csv")

CATEGORY = "Category:Effects of Hurricane Harvey in Houston"

# Supplementary source for the replay manifest: geosearch around flood-relevant
# Houston points. Unlike the category above, these files aren't already known
# to be Harvey-related, so they're only kept if BOTH a flood keyword and a
# matching 2017 date show up.
GEOSEARCH_POINTS = [
    (29.76, -95.37, 8000),   # downtown
    (29.69, -95.46, 6000),   # Meyerland
    (29.76, -95.42, 6000),   # Memorial / Buffalo Bayou
    (30.05, -95.19, 6000),   # Kingwood
]

ALLOWED_LICENSES = {"public domain", "pd", "cc0"}
PD_PREFIXES = ("pd-", "public domain")
CC_BY_ONLY = "cc-by"  # accept cc-by-*, reject cc-by-sa

WATER_KEYWORDS = (
    "flood", "flooding", "flooded", "high water", "inundat", "submerg",
    "underwater",
)
GAUGE_EXCLUDE_KEYWORDS = ("gauge", "staff gauge", "measuring tape", "yardstick", "ruler")

# Visually checked with the Read tool and rejected: same night-shoot series as
# neighboring kept photos, but this one only shows rain-wet pavement, no
# standing floodwater. Text keywords can't tell these apart, so it's a
# manual pin rather than a rule.
MANUAL_EXCLUDE_OBS_IDS = {"commons-62012927"}

LAT_MIN, LAT_MAX = 29.5, 30.2
LON_MIN, LON_MAX = -95.8, -95.0
DATE_MIN = datetime(2017, 8, 25)
DATE_MAX = datetime(2017, 9, 2)
# Tighter window required specifically for caption-geocoded replay rows (no
# GPS to corroborate the date, so we're stricter about the time source).
CAPTION_DATE_MIN = datetime(2017, 8, 26)
CAPTION_DATE_MAX = datetime(2017, 8, 31, 23, 59, 59)

POOL_TARGET = 150

# Houston-area neighbourhoods/landmarks and a generic "<name> St/Rd/Ave/..."
# pattern, used to spot caption text worth geocoding.
NEIGHBORHOODS = (
    "Meyerland", "Kingwood", "Buffalo Bayou", "Braeswood", "Westbury",
    "Bellaire", "Spring Branch", "Greenspoint", "Memorial", "Katy", "Cypress",
    "Humble", "Channelview", "Woodway", "Uptown", "Galleria", "Montrose",
    "Heights", "Midtown", "Sharpstown", "Alief", "Gulfton", "Clear Lake",
    "Pasadena", "Baytown", "League City", "Friendswood", "Pearland",
    "Sugar Land", "Missouri City", "Addicks", "Barker Reservoir",
    "Loop 610", "Beltway 8", "Sam Houston Tollway",
)
NEIGHBORHOOD_RE = re.compile("|".join(re.escape(n) for n in NEIGHBORHOODS), re.IGNORECASE)
# Require the words before the suffix to be capitalized (a proper noun), so
# generic phrasing like "above a flooded street" or "the access street"
# doesn't get picked up as if it were a real street name.
STREET_RE = re.compile(
    r"\b([A-Z][\w']*(?:\s+[A-Z][\w']*){0,2}\s+"
    r"(?:Street|St\.?|Road|Rd\.?|Drive|Dr\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|"
    r"Freeway|Fwy\.?|Highway|Hwy\.?|Lane|Ln\.?))\b"
)
INTERSTATE_RE = re.compile(
    r"\bI-\d{1,3}\b|\bUS-\d{1,3}\b|\bHighway\s+\d+\b|\bInterstate\s+\d{1,3}\b",
    re.IGNORECASE,
)

MAX_COMMONS_CALLS = 50
MAX_NOMINATIM_CALLS = 30
_commons_calls = 0
_nominatim_calls = 0


def api_get(params):
    global _commons_calls
    if _commons_calls >= MAX_COMMONS_CALLS:
        raise RuntimeError("Commons API call budget exhausted")
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    _commons_calls += 1
    time.sleep(1.0)
    return data


def nominatim_geocode(query):
    global _nominatim_calls
    if _nominatim_calls >= MAX_NOMINATIM_CALLS:
        return None
    params = {
        "q": query,
        "format": "jsonv2",
        "viewbox": "-95.50,29.81,-95.33,29.66",
        "bounded": 1,
        "limit": 1,
    }
    url = NOMINATIM + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"geocode failed for {query!r}: {e}")
        data = []
    _nominatim_calls += 1
    time.sleep(1.0)
    return data[0] if data else None


def category_members(cat_title):
    titles = []
    cont = None
    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": cat_title,
            "cmnamespace": 6,
            "cmlimit": 500,
        }
        if cont:
            params["cmcontinue"] = cont
        data = api_get(params)
        titles.extend(m["title"] for m in data.get("query", {}).get("categorymembers", []))
        cont = data.get("continue", {}).get("cmcontinue")
        if not cont:
            break
    return titles


def geosearch(lat, lon, radius):
    params = {
        "action": "query",
        "list": "geosearch",
        "gscoord": f"{lat}|{lon}",
        "gsradius": radius,
        "gsnamespace": 6,
        "gslimit": 200,
    }
    data = api_get(params)
    return [item["title"] for item in data.get("query", {}).get("geosearch", [])]


def get_imageinfo_and_coords(titles):
    results = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        params = {
            "action": "query",
            "titles": "|".join(batch),
            "prop": "imageinfo|coordinates",
            "iiprop": "url|extmetadata|size|timestamp",
            "iiurlwidth": 1280,
            "coprop": "type",
            "colimit": "max",  # default is 10 coordinates per request, which silently drops geotags
        }
        data = api_get(params)
        pages = data.get("query", {}).get("pages", {})
        for _, page in pages.items():
            title = page.get("title")
            if title:
                results[title] = page
    return results


def license_ok(short_name, license_code):
    s = (short_name or "").lower()
    c = (license_code or "").lower()
    if s in ALLOWED_LICENSES or c in ALLOWED_LICENSES:
        return True
    if s.startswith(PD_PREFIXES) or c.startswith("pd"):
        return True
    if s.startswith(CC_BY_ONLY) and "sa" not in s:
        return True
    if c.startswith(CC_BY_ONLY) and "sa" not in c:
        return True
    return False


def parse_date(date_str, title, upload_timestamp=None, description=""):
    # Prefer EXIF/upload date metadata.
    if date_str:
        for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d", "%Y:%m:%d %H:%M:%S"):
            try:
                return datetime.strptime(date_str[:19].split(".")[0], fmt)
            except ValueError:
                continue
        try:
            return datetime.strptime(date_str[:10], "%Y-%m-%d")
        except ValueError:
            pass
    # Many DVIDS-sourced filenames embed a YYMMDD date prefix, e.g.
    # "170826-H-NI589-018 (...).jpg" or "20170907-FSA-SM-0929 (...).jpg".
    m = re.search(r"(?<!\d)(20)?(1[7-8])(\d{2})(\d{2})(?!\d)", title)
    if m:
        try:
            yy = "20" + m.group(2)
            return datetime.strptime(f"{yy}-{m.group(3)}-{m.group(4)}", "%Y-%m-%d")
        except ValueError:
            pass
    # Caption text like "8/27/17 - 12:15 PM update".
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(1[7-8])\b", description)
    if m:
        try:
            return datetime.strptime(f"20{m.group(3)}-{m.group(1)}-{m.group(2)}", "%Y-%m-%d")
        except ValueError:
            pass
    # Last resort: Commons upload timestamp (least trustworthy -- could be
    # years after the fact -- so callers should treat this as "caption date").
    if upload_timestamp:
        try:
            return datetime.strptime(upload_timestamp[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            pass
    return None


def shows_water(title, description):
    text = (title + " " + (description or "")).lower()
    return "yes" if any(k in text for k in WATER_KEYWORDS) else "maybe"


def load_csv(path):
    if os.path.exists(path):
        with open(path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    return []


def build_credit(meta):
    artist = re.sub("<[^>]+>", "", meta.get("Artist", {}).get("value", "Unknown"))
    artist = " ".join(artist.split())  # collapse embedded newlines/whitespace
    license_short = meta.get("LicenseShortName", {}).get("value") or meta.get("License", {}).get("value") or "Unknown"
    return artist, license_short, f"{artist}, {license_short}, via Wikimedia Commons"


def source_url_for(title):
    return f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"


def download(url, dest_path):
    if os.path.exists(dest_path):
        return True
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as resp, open(dest_path, "wb") as out:
            out.write(resp.read())
        time.sleep(1.0)
        return True
    except Exception as e:
        print(f"download failed for {url}: {e}")
        return False


# Words that legitimately precede a street suffix in prose without naming a
# real street, e.g. "a flooded street in Houston, Texas" -> "Houston Street".
STREET_STOPWORDS = {"houston", "texas", "harvey", "hurricane"}


def find_location_phrase(title, description):
    text = f"{title} {description}"
    m = NEIGHBORHOOD_RE.search(text)
    if m:
        return m.group(0)
    m = INTERSTATE_RE.search(text)
    if m:
        return m.group(0)
    m = STREET_RE.search(text)
    if m:
        phrase = m.group(0)
        name_part = re.sub(r"\s+\S+$", "", phrase)  # drop the suffix word
        if name_part.strip().lower() in STREET_STOPWORDS:
            return None
        return phrase
    return None


def build_replay_rows(pages, source_by_title, existing_ids):
    """Existing exif/geosearch-based replay harvest (unchanged behavior)."""
    rows = []
    for title, page in pages.items():
        pageid = page.get("pageid")
        obs_id = f"commons-{pageid}"
        if obs_id in existing_ids or obs_id in MANUAL_EXCLUDE_OBS_IDS:
            continue

        imageinfo = page.get("imageinfo")
        coords = page.get("coordinates")
        if not imageinfo or not coords:
            continue

        info = imageinfo[0]
        meta = info.get("extmetadata", {})
        short_name = meta.get("LicenseShortName", {}).get("value")
        license_code = meta.get("License", {}).get("value")
        if not license_ok(short_name, license_code):
            continue

        lat = coords[0].get("lat")
        lon = coords[0].get("lon")
        if lat is None or lon is None:
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue

        description = meta.get("ImageDescription", {}).get("value", "")
        date_str = meta.get("DateTimeOriginal", {}).get("value") or meta.get("DateTime", {}).get("value")
        dt = parse_date(date_str, title, description=description)
        source = source_by_title.get(title, "category")

        if source == "geosearch":
            if dt is None or not (DATE_MIN <= dt <= DATE_MAX):
                continue
        elif dt is not None and not (DATE_MIN <= dt <= DATE_MAX):
            continue

        water = shows_water(title, description)
        if source == "geosearch" and water != "yes":
            continue
        if water != "yes":
            skip_terms = ("logo", "portrait", "headshot", "seal", "flag")
            if any(t in title.lower() for t in skip_terms):
                continue

        _, license_short, credit = build_credit(meta)
        dest_path = os.path.join(REPLAY_DIR, f"{pageid}.jpg")
        thumb_url = info.get("thumburl") or info.get("url")
        if not download(thumb_url, dest_path):
            continue

        time_iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else "2017-08-27T17:00:00Z"
        rows.append({
            "obs_id": obs_id,
            "path": os.path.relpath(dest_path, ROOT),
            "lat": lat,
            "lon": lon,
            "time": time_iso,
            "license": license_short,
            "credit": credit,
            "source_url": source_url_for(title),
            "title": title,
            "shows_water": water,
            "location_source": "exif",
            "precision": "exact",
        })
        existing_ids.add(obs_id)
    return rows


def build_caption_replay_rows(cat_pages, existing_ids):
    """New: geocode images that lack GPS but name a specific Houston
    street/intersection/landmark in their title or description."""
    rows = []
    for title, page in cat_pages.items():
        pageid = page.get("pageid")
        obs_id = f"commons-{pageid}"
        if obs_id in existing_ids:
            continue
        if page.get("coordinates"):
            continue  # already has real GPS -- handled by build_replay_rows

        imageinfo = page.get("imageinfo")
        if not imageinfo:
            continue
        info = imageinfo[0]
        meta = info.get("extmetadata", {})
        short_name = meta.get("LicenseShortName", {}).get("value")
        license_code = meta.get("License", {}).get("value")
        if not license_ok(short_name, license_code):
            continue

        description = meta.get("ImageDescription", {}).get("value", "")
        if shows_water(title, description) != "yes":
            continue
        if any(k in (title + description).lower() for k in GAUGE_EXCLUDE_KEYWORDS):
            continue

        phrase = find_location_phrase(title, description)
        if not phrase:
            continue

        date_str = meta.get("DateTimeOriginal", {}).get("value") or meta.get("DateTime", {}).get("value")
        upload_ts = info.get("timestamp")
        dt = parse_date(date_str, title, upload_timestamp=upload_ts, description=description)
        if dt is None or not (CAPTION_DATE_MIN <= dt <= CAPTION_DATE_MAX):
            continue

        # Appending a redundant ", Houston, TX" measurably hurts Nominatim's
        # structured-query match rate for a bare street name; the viewbox
        # already scopes the search geographically.
        hit = nominatim_geocode(phrase)
        if not hit:
            continue
        lat, lon = float(hit["lat"]), float(hit["lon"])
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue
        osm_type = hit.get("addresstype") or hit.get("class")
        precision = "street" if osm_type in ("road", "highway") else "neighbourhood"

        _, license_short, credit = build_credit(meta)
        dest_path = os.path.join(REPLAY_DIR, f"{pageid}.jpg")
        if not download(info.get("thumburl") or info.get("url"), dest_path):
            continue

        rows.append({
            "obs_id": obs_id,
            "path": os.path.relpath(dest_path, ROOT),
            "lat": lat,
            "lon": lon,
            "time": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "license": license_short,
            "credit": credit,
            "source_url": source_url_for(title),
            "title": title,
            "shows_water": "yes",
            "location_source": "caption",
            "precision": precision,
        })
        existing_ids.add(obs_id)
    return rows


def build_pool_rows(cat_pages, existing_paths):
    rows = []
    for title, page in cat_pages.items():
        if len(rows) >= POOL_TARGET:
            break
        pageid = page.get("pageid")
        rel_path = os.path.relpath(os.path.join(POOL_DIR, f"{pageid}.jpg"), ROOT)
        if rel_path in existing_paths:
            continue

        imageinfo = page.get("imageinfo")
        if not imageinfo:
            continue
        info = imageinfo[0]
        meta = info.get("extmetadata", {})
        short_name = meta.get("LicenseShortName", {}).get("value")
        license_code = meta.get("License", {}).get("value")
        if not license_ok(short_name, license_code):
            continue

        description = meta.get("ImageDescription", {}).get("value", "")
        text = (title + " " + description).lower()
        if "flood" not in text:
            continue
        if any(k in text for k in GAUGE_EXCLUDE_KEYWORDS):
            continue

        coords = page.get("coordinates")
        lat = coords[0].get("lat") if coords else ""
        lon = coords[0].get("lon") if coords else ""

        _, license_short, credit = build_credit(meta)
        dest_path = os.path.join(POOL_DIR, f"{pageid}.jpg")
        if not download(info.get("thumburl") or info.get("url"), dest_path):
            continue

        rows.append({
            "path": rel_path,
            "source": source_url_for(title),
            "license": license_short,
            "credit": credit,
            "lat": lat,
            "lon": lon,
        })
        existing_paths.add(rel_path)
    return rows


def main():
    os.makedirs(REPLAY_DIR, exist_ok=True)
    os.makedirs(POOL_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(POOL_CSV_PATH), exist_ok=True)

    cat_titles = category_members(CATEGORY)
    source_by_title = {t: "category" for t in cat_titles}

    for lat, lon, radius in GEOSEARCH_POINTS:
        try:
            for t in geosearch(lat, lon, radius):
                source_by_title.setdefault(t, "geosearch")
        except RuntimeError:
            break

    titles = list(source_by_title.keys())
    pages = get_imageinfo_and_coords(titles) if titles else {}
    cat_pages = {t: p for t, p in pages.items() if source_by_title.get(t) == "category"}

    # --- replay manifest (migrate old rows, then add exif- and caption-based) ---
    manifest_rows = load_csv(MANIFEST_PATH)
    for row in manifest_rows:
        row.setdefault("location_source", "exif")
        row.setdefault("precision", "exact")
        row.setdefault("use_in_replay", "unchecked")  # batch_replay only uses rows a human marked "yes"
    existing_ids = {row["obs_id"] for row in manifest_rows}

    new_exif_rows = build_replay_rows(pages, source_by_title, existing_ids)
    for row in new_exif_rows:
        row["use_in_replay"] = "unchecked"
    manifest_rows.extend(new_exif_rows)

    new_caption_rows = build_caption_replay_rows(cat_pages, existing_ids)
    for row in new_caption_rows:
        row["use_in_replay"] = "unchecked"
    manifest_rows.extend(new_caption_rows)

    with open(MANIFEST_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "obs_id", "path", "lat", "lon", "time", "license", "credit",
            "source_url", "title", "shows_water", "location_source", "precision", "use_in_replay",
        ])
        writer.writeheader()
        writer.writerows(manifest_rows)

    # --- eval pool (no location needed) ---
    pool_rows = load_csv(POOL_CSV_PATH)
    existing_paths = {row["path"] for row in pool_rows}
    pool_rows.extend(build_pool_rows(cat_pages, existing_paths))

    with open(POOL_CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["path", "source", "license", "credit", "lat", "lon"])
        writer.writeheader()
        writer.writerows(pool_rows)

    print(
        f"Replay manifest: {len(manifest_rows)} rows "
        f"({len(new_exif_rows)} new exif, {len(new_caption_rows)} new caption). "
        f"Eval pool: {len(pool_rows)} rows. "
        f"Commons calls: {_commons_calls}, Nominatim calls: {_nominatim_calls}."
    )


if __name__ == "__main__":
    main()
