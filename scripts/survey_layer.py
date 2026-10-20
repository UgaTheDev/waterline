"""USGS survey layer: estimated peak water depth on roads near surveyed high-water marks.

  depth on a road = HWM water-surface elevation (STN, NAVD88) - lowest road ground elevation (3DEP 1 m, NAVD88)

Only roads within RADIUS_M of a mark; bridges/tunnels excluded (bare-earth DEM is the ground under a
bridge, not the deck); roads above the water surface are skipped, never marked dry. Observation time is the mark's
peak time (see marks()). Writes data/cache/events/<id>/survey_observations.json.
    python -m scripts.survey_layer [event_id]          (default harvey2017)
    python -m scripts.survey_layer [event_id] --validate

Peak timing, in order (recorded per mark in "peak_source" and in each observation's provenance and rationale):
  1. the USGS STN peak summary for the mark;
  2. else the peak of the nearest USGS NWIS stream gauge inside the event bbox with discharge (00060) or stage (00065)
     data during the replay window (a peak on the window's first or last sample is not a peak, so it doesn't count);
  3. else the hour of peak rainfall at the mark from the IEM IEMRE hourly point API.
  No time at all: the mark is dropped. A time is never invented silently.
"""
import io, json, math, pathlib, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
import numpy as np
from PIL import Image
from shapely.geometry import Point
from backend import events

STN = "https://api.waterdata.usgs.gov/stnservices"  # moved from stn.wim.usgs.gov/STNServices in 2026; old host 301s to a web page
NWIS = "https://waterservices.usgs.gov/nwis/iv/"
IEMRE = "https://mesonet.agron.iastate.edu/api/1/iemre/hourly.json"
DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
UA = {"User-Agent": "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"}
RADIUS_M = 150
CHIP_DEG, CHIP_PX = 0.0025, 250  # +/- ~250 m around each mark at ~2 m/px
NAVD88, MAX_QUALITY = 2, 4       # quality 1-4 = +/-0.05..0.40 ft; 5 (VP) and 6 (unknown) are dropped
QUALITY_FT = {1: 0.05, 2: 0.10, 3: 0.20, 4: 0.40}
# Error allowance. Validated against the 26 Harvey bbox marks with a surveyed height above ground (--validate,
# 2026-09-26): median +11 cm, MAE 36 cm, 3/26 underestimated by >20 cm (worst -69). 0.33 + 0.5 ft covers all but the worst.
DEM_FT, SLOPE_FT = 0.33, 0.5  # ponytail: flat allowance; interpolate the water surface between marks if this proves loose
FT = 30.48
IEMRE_DEG = 0.125  # IEMRE grid spacing: marks in the same cell share one rain lookup
TIMING_TEXT = {"usgs_peak_summary": "peak time estimated by USGS",
               "stream_gauge": "peak time estimated from the nearest stream gauge",
               "rainfall_peak": "peak time estimated from the rainfall peak"}


def get(url, **kw):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA, **kw), timeout=120) as r:
        return r.read()


def hwms(E):
    """The event's marks inside its bbox, in the old STNServices field names. The 2026 API's event list has no elevations,
    so each mark's detail record is fetched (in parallel) and the result cached in the event dir."""
    cache = E["dir"] / "stn_hwms.json"
    if cache.exists():
        return json.loads(cache.read_text())
    w, s, e, n = E["bbox"]
    ids = [h["id"] for h in getj(f"{STN}/events/{E['stn_event_id']}/hwms/") if s <= h["latitude_dd"] <= n and w <= h["longitude_dd"] <= e]
    num = lambda v: float(v) if v not in (None, "") else None
    def one(i):
        d = getj(f"{STN}/hwms/{i}/")
        return {**d, "hwm_id": d["id"], "elev_ft": num(d.get("elev_ft")), "vdatum_id": d.get("vdatum"), "hwm_type_id": d.get("hwm_type"),
                "hwm_quality_id": d.get("hwm_quality"), "peak_summary_id": d.get("peak_summary"), "height_above_gnd": num(d.get("height_above_ground")),
                "hwm_locationdescription": d.get("location_description")}
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(8) as ex:  # ponytail: 8 at a time keeps a few hundred marks to ~a minute without hammering USGS
        out = list(ex.map(one, ids))
    cache.write_text(json.dumps(out))
    return out


def getj(url, tries=4):
    for a in range(tries):
        try:
            return json.loads(get(url))
        except Exception as ex:
            if a == tries - 1:
                raise
            print(f"  retry {url[:80]}: {ex}")
            time.sleep(3 * 2 ** a)


def _utc(s):
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def _iso(d):
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _km(lat1, lon1, lat2, lon2):
    kx = 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * 110.54)


def gauge_peaks(E):
    """[{site, name, lat, lon, peak (UTC ISO), param}] for NWIS stream gauges in the bbox with data in the window."""
    w, s, e, n = E["bbox"]
    t0, t1 = _utc(E["replay"]["start"]), _utc(E["replay"]["end"])
    q = urllib.parse.urlencode({"format": "json", "bBox": f"{w:.4f},{s:.4f},{e:.4f},{n:.4f}", "parameterCd": "00065,00060",
                                "siteType": "ST", "startDT": t0.strftime("%Y-%m-%dT%H:%MZ"), "endDT": t1.strftime("%Y-%m-%dT%H:%MZ")})
    try:
        ts_all = getj(f"{NWIS}?{q}")["value"]["timeSeries"]
    except urllib.error.HTTPError as ex:
        if ex.code == 404:  # NWIS answers 404 when no site matches
            return []
        raise
    time.sleep(1)
    by_site = {}
    for ts in ts_all:
        si, var = ts["sourceInfo"], ts["variable"]
        nd = var.get("noDataValue")
        vals = [(float(x["value"]), _utc(x["dateTime"])) for v in ts["values"] for x in v["value"] if float(x["value"]) != nd]
        vals = [(v, t) for v, t in vals if t0 <= t <= t1]
        if len(vals) < 3:
            continue
        i = max(range(len(vals)), key=lambda k: vals[k][0])  # first sample at the maximum
        if i in (0, len(vals) - 1):
            continue  # rising or falling through the whole window: no peak inside it
        param = var["variableCode"][0]["value"]
        site = si["siteCode"][0]["value"]
        g = si["geoLocation"]["geogLocation"]
        cur = by_site.get(site)
        if cur is None or (param == "00060" and cur["param"] != "00060"):  # discharge over stage when both exist
            by_site[site] = {"site": site, "name": si["siteName"], "lat": float(g["latitude"]), "lon": float(g["longitude"]),
                             "peak": _iso(vals[i][1]), "param": param}
    return list(by_site.values())


def rain_peak(E, lat, lon, cache):
    """UTC ISO end of the hour with the most IEMRE rain at the grid cell of (lat, lon) inside the window, or None."""
    key = (round(lat / IEMRE_DEG) * IEMRE_DEG, round(lon / IEMRE_DEG) * IEMRE_DEG)
    if key not in cache:
        t0, t1 = _utc(E["replay"]["start"]), _utc(E["replay"]["end"])
        best = None
        for k in range((t1.date() - t0.date()).days + 3):  # IEMRE "date" is a local day: pad both ends
            d = t0.date() - timedelta(1) + timedelta(k)
            for r in getj(f"{IEMRE}?{urllib.parse.urlencode({'date': d.isoformat(), 'lat': key[0], 'lon': key[1]})}")["data"]:
                v, mm = _utc(r["valid_utc"]), r.get("hourly_precip_in")
                if mm is not None and t0 <= v <= t1 and (best is None or mm > best[0]):
                    best = (mm, v)
            time.sleep(1)
        cache[key] = {"peak": _iso(best[1]), "in": best[0], "lat": key[0], "lon": key[1]} if best and best[0] > 0 else None
    return cache[key]


def conformal_ft(E):
    """The event's conformal upper-bound allowance in feet (eval/results/survey_calibration_<id>.json), else 0."""
    p = events.CACHE.parent.parent / "eval/results" / f"survey_calibration_{E['id']}.json"
    try:
        cm = json.loads(p.read_text()).get("conformal_allowance_cm")
    except (OSError, ValueError):
        return 0.0
    return (cm or 0.0) / FT


def marks(E, peaks=True):
    """Usable marks in the event bbox; with peaks=True each gets "peak" (UTC ISO or None) and "peak_source"
    (provenance dict: {"source": usgs_peak_summary|stream_gauge|rainfall_peak, ...})."""
    w, s, e, n = E["bbox"]
    hs = [h for h in hwms(E) if h.get("elev_ft") and h.get("vdatum_id") == NAVD88 and (h.get("hwm_quality_id") or 9) <= MAX_QUALITY
          and h.get("hwm_type_id") != 9]  # type 9 = USACE daily tape-downs of a RECEDING channel (Harvey, Sep 9-16), not peaks
    if not peaks:
        return hs
    summaries, gauges, rain = {}, None, {}
    for h in hs:
        pid = h.get("peak_summary_id")
        if pid and pid not in summaries:
            try:
                summaries[pid] = getj(f"{STN}/peaksummaries/{pid}/").get("peak_date")
            except Exception:
                summaries[pid] = None
            time.sleep(0.5)
        if summaries.get(pid):
            h["peak"], h["peak_source"] = summaries[pid][:19] + "Z", {"source": "usgs_peak_summary", "peak_summary_id": pid}  # STN peaks are UTC
            continue
        if gauges is None:
            gauges = gauge_peaks(E)
            print(f"{len(gauges)} NWIS stream gauges with a peak in the bbox and window: {[g['site'] for g in gauges]}")
        if gauges:
            g = min(gauges, key=lambda g: _km(h["latitude_dd"], h["longitude_dd"], g["lat"], g["lon"]))
            h["peak"] = g["peak"]
            h["peak_source"] = {"source": "stream_gauge", "site": g["site"], "name": g["name"], "param": g["param"],
                                "distance_km": round(_km(h["latitude_dd"], h["longitude_dd"], g["lat"], g["lon"]), 1)}
            continue
        r = rain_peak(E, h["latitude_dd"], h["longitude_dd"], rain)
        h["peak"] = r["peak"] if r else None
        h["peak_source"] = {"source": "rainfall_peak", "dataset": "IEM IEMRE hourly", "cell": [r["lat"], r["lon"]], "peak_hour_in": r["in"]} if r else None
    return hs


def timing_text(h):
    src = h.get("peak_source") or {}
    t = TIMING_TEXT.get(src.get("source"), "peak time estimated by USGS")
    if src.get("source") == "stream_gauge":
        t += f" (USGS {src['site']}, {src['distance_km']} km away)"
    return t


def chip(lat, lon):
    w, s, e, n = lon - CHIP_DEG, lat - CHIP_DEG, lon + CHIP_DEG, lat + CHIP_DEG
    q = urllib.parse.urlencode({"bbox": f"{w},{s},{e},{n}", "bboxSR": 4326, "imageSR": 4326, "size": f"{CHIP_PX},{CHIP_PX}",
                                "format": "tiff", "pixelType": "F32", "noData": -9999, "interpolation": "RSP_BilinearInterpolation", "f": "image"})
    a = np.array(Image.open(io.BytesIO(get(f"{DEM}?{q}")))) * 3.28084  # metres -> feet
    a[a < -1000] = np.nan

    def sample(x, y):
        c, r = int((x - w) / (e - w) * CHIP_PX), int((n - y) / (n - s) * CHIP_PX)
        return a[r, c] if 0 <= r < CHIP_PX and 0 <= c < CHIP_PX else np.nan
    return sample


def main(E, hs=None):
    hs = marks(E) if hs is None else hs
    print(f"{len(hs)} usable marks in bbox")
    R = events.load(E["id"], "roads")
    obs = []
    for i, h in enumerate(hs):
        peak = h.get("peak")
        if not peak:
            continue  # no timing: can't place it in the replay honestly
        lat, lon, wse = h["latitude_dd"], h["longitude_dd"], h["elev_ft"]
        here = Point(*R.to_m(lon, lat))
        dem = None
        for attempt in range(3):  # the 3DEP image server returns intermittent 502s
            try:
                dem = chip(lat, lon)
                break
            except Exception as ex:
                print("\ndem retry", h["hwm_id"], ex)
                time.sleep(3)
        if dem is None:
            continue
        time.sleep(0.5)
        for j in R.tree.query(here.buffer(RADIUS_M)):
            eid = R.ids[int(j)]
            u, v, k, geom, name, length = R.edges[eid]
            d = R.G[u][v][k]
            if d.get("bridge") or d.get("tunnel"):
                continue
            pts = [geom.interpolate(f, normalized=True) for f in np.linspace(0, 1, max(2, int(length // 5) + 1))]
            ground = [dem(p.x, p.y) for p in pts if here.distance(Point(*R.to_m(p.x, p.y))) <= RADIUS_M]
            ground = [g for g in ground if not np.isnan(g)]
            if not ground:
                continue
            low_ground = float(min(ground))
            depth_ft = wse - low_ground  # lowest point of the road near the mark = deepest water
            if depth_ft <= 0:
                continue  # road above the water surface: skip, never claim dry
            # Upper-bound allowance: the fixed error budget, widened to the event's split-conformal 95% allowance when one
            # exists (scripts/calibrate_survey.py). Wider only ever adds false blocks, never misses.
            band = max(QUALITY_FT[h["hwm_quality_id"]] + DEM_FT + SLOPE_FT, conformal_ft(E))
            dist = round(here.distance(Point(*R.to_m(*geom.interpolate(0.5, normalized=True).coords[0]))))
            obs.append({"obs_id": f"usgs-{h['hwm_id']}-{eid}", "edge_id": eid, "time": peak[:19] + "Z",
                        "lat": lat, "lon": lon, "status": "ok", "depth_cm": round(depth_ft * FT, 1),
                        "low_cm": round(max(0.0, depth_ft - band) * FT, 1), "high_cm": round((depth_ft + band) * FT, 1),
                        "confidence": 0.7, "half_life_min": 720, "kind": "survey",
                        "provenance": {"method": "usgs-hwm-minus-3dep", "derived_from": [f"usgs-hwm-{h['hwm_id']}"], "peak_time": h.get("peak_source")},
                        "reference": f"USGS high-water mark #{h['hwm_id']}, {dist} m away",
                        "rationale": f"Surveyed water surface {wse:.1f} ft minus lowest road ground {low_ground:.1f} ft (NAVD88); {timing_text(h)}.",
                        "credit": "USGS Short-Term Network + USGS 3DEP 1 m elevation, public domain",
                        "source_url": f"{STN}/hwms/{h['hwm_id']}/", "precision": "exact", "image_url": None})
        print(f"\r{i + 1}/{len(hs)} marks, {len(obs)} road observations", end="")
    p = E["dir"] / "survey_observations.json"
    p.write_text(json.dumps(obs, indent=1))
    print(f"\n{len(obs)} observations on {len({o['edge_id'] for o in obs})} road segments, {p.stat().st_size / 1e6:.1f} MB")
    return obs


def validate(E, out=None):
    """Routing gate for this event's survey layer (backend/events.survey_routes reads the JSON). At every mark with a
    surveyed height above ground: estimate = water surface - 3DEP ground at the mark, upper bound = estimate + the FIXED
    allowance (not the conformal one: that is fitted on these same marks, so it would pass by construction). A sedan miss
    = true depth > the sedan limit while the upper bound says it isn't. Street-level marks only: basement/ramp seed lines
    measure water pooled below grade, which produces no street observation (unknown, never dry)."""
    import statistics
    from backend.profiles import VEHICLES
    from scripts.calibrate_survey import BELOW_GRADE
    lim = VEHICLES["sedan"]["limit_cm"]

    def stats(hs):
        rows = []
        for h in hs:
            try:
                g = float(chip(h["latitude_dd"], h["longitude_dd"])(h["longitude_dd"], h["latitude_dd"]))
            except Exception:
                continue
            est, true = (h["elev_ft"] - g) * FT, h["height_above_gnd"] * FT
            rows.append((est, true, est + (QUALITY_FT[h["hwm_quality_id"]] + DEM_FT + SLOPE_FT) * FT))
            time.sleep(0.3)
        if not rows:
            return {"n": 0}
        err = [e - t for e, t, _ in rows]
        return {"n": len(rows), "median_err_cm": round(statistics.median(err)), "mae_cm": round(statistics.mean(map(abs, err))),
                "upper_bound_covers_truth": f"{sum(t <= hi for _, t, hi in rows)}/{len(rows)}",
                "dangerous_marks": sum(t > lim for _, t, _ in rows), "sedan_misses": sum(t > lim and hi <= lim for _, t, hi in rows)}

    hs = [h for h in hwms(E) if (h.get("height_above_gnd") or 0) > 0 and h.get("elev_ft") and h.get("vdatum_id") == NAVD88
          and (h.get("hwm_quality_id") or 9) <= MAX_QUALITY]
    street = [h for h in hs if not BELOW_GRADE.search(h.get("hwm_locationdescription") or "")]
    v = {"event": E["id"], **stats(hs), "method": "HWM water surface (STN, NAVD88) minus 3DEP ground at the mark vs surveyed "
         "height above ground; quality <= 4; upper bound = fixed allowance", "date": time.strftime("%Y-%m-%d"),
         "street_level_only": {"excluded": "marks described as basement/ramp/stair/inside/below grade", **stats(street)}}
    p = pathlib.Path(out) if out else events.CACHE.parent.parent / "eval/results" / f"survey_validation_{E['id']}.json"
    p.write_text(json.dumps(v, indent=1))
    print(json.dumps(v))
    return v

if __name__ == "__main__":
    import sys
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    E = events.get(args[0] if args else None)
    validate(E, next((a[6:] for a in sys.argv if a.startswith("--out=")), None)) if "--validate" in sys.argv else main(E)
