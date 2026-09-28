"""Archived NWS flood warning polygons for an event's replay window and WFOs (Iowa Environmental Mesonet)
-> data/cache/events/<id>/alerts.geojson.    python -m scripts.fetch_alerts [event_id]          (default harvey2017)
Harvey's file was fetched for 2017-08-25..09-02 (a day before the replay start, so warnings already in force count)."""
import io, json, urllib.parse, urllib.request, zipfile, tempfile, pathlib
from datetime import datetime, timedelta
import geopandas as gpd
from backend import events

URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py"
FLOOD = {"FF": "Flash Flood Warning", "FL": "Flood Warning", "FA": "Areal Flood Warning"}  # VTEC phenomena, significance W
UA = {"User-Agent": "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"}


def fetch(E):
    t0 = datetime.fromisoformat(E["replay"]["start"].replace("Z", "+00:00")) - timedelta(days=1)  # warnings issued before the window
    t1 = datetime.fromisoformat(E["replay"]["end"].replace("Z", "+00:00"))
    q = [("sts", t0.strftime("%Y-%m-%dT%H:%MZ")), ("ets", t1.strftime("%Y-%m-%dT%H:%MZ"))] + [("wfo[]", w) for w in E["wfo"]] + [
        ("limitps", 1), ("phenomena", "FF,FL,FA"), ("significance", "W,W,W"), ("accept", "shapefile")]
    req = urllib.request.Request(f"{URL}?{urllib.parse.urlencode(q)}", headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, tempfile.TemporaryDirectory() as d:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(d)
        df = gpd.read_file(next(pathlib.Path(d).glob("*.shp"))).to_crs(4326)
    df = df[df["PHENOM"].isin(list(FLOOD)) & (df["SIG"] == "W") & (df["GTYPE"] == "P")]  # storm-based polygons, not whole counties
    iso = lambda s: f"{s[:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:00Z"  # IEM times: YYYYMMDDHHMM UTC
    feats = [{"type": "Feature", "geometry": json.loads(gpd.GeoSeries([row.geometry]).to_json())["features"][0]["geometry"],
              "properties": {"event": FLOOD[row.PHENOM], "issued": iso(row.ISSUED), "expires": iso(row.EXPIRED), "source": "NWS via IEM"}}
             for row in df.itertuples()]
    p = E["dir"] / "alerts.geojson"
    p.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"{len(feats)} flood warning polygons -> {p} ({p.stat().st_size / 1e3:.0f} KB)")
    return feats


if __name__ == "__main__":
    import sys
    fetch(events.get(sys.argv[1] if len(sys.argv) > 1 else None))
