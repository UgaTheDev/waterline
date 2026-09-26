"""Archived NWS flood warning polygons for the replay (Iowa Environmental Mesonet) -> data/cache/alerts_harvey.geojson"""
import io, json, urllib.request, zipfile, tempfile, pathlib
import geopandas as gpd
from backend.profiles import CACHE

URL = ("https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py"
       "?sts=2017-08-25T00:00Z&ets=2017-09-02T00:00Z&wfo[]=HGX&limitps=1&phenomena=FF,FL,FA&significance=W,W,W&accept=shapefile")
FLOOD = {"FF": "Flash Flood Warning", "FL": "Flood Warning", "FA": "Areal Flood Warning"}  # VTEC phenomena, significance W

with urllib.request.urlopen(URL, timeout=120) as r, tempfile.TemporaryDirectory() as d:
    zipfile.ZipFile(io.BytesIO(r.read())).extractall(d)
    df = gpd.read_file(next(pathlib.Path(d).glob("*.shp"))).to_crs(4326)
df = df[df["PHENOM"].isin(list(FLOOD)) & (df["SIG"] == "W") & (df["GTYPE"] == "P")]  # storm-based polygons, not whole counties
iso = lambda s: f"{s[:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:00Z"  # IEM times: YYYYMMDDHHMM UTC
feats = [{"type": "Feature", "geometry": json.loads(gpd.GeoSeries([row.geometry]).to_json())["features"][0]["geometry"],
          "properties": {"event": FLOOD[row.PHENOM], "issued": iso(row.ISSUED), "expires": iso(row.EXPIRED), "source": "NWS via IEM"}}
         for row in df.itertuples()]
(CACHE / "alerts_harvey.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
print(f"{len(feats)} flood warning polygons")
