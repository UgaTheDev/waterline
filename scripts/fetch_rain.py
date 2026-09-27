"""Hourly Harvey rainfall on a 5x5 point grid over the bbox, from the IEM reanalysis (IEMRE) point API (no key).
Writes data/cache/rain_harvey.json: {t0, hours, lons, lats, mm: [point][hour]} with point = row-major (lat, lon).
mm[p][h] is the rain in the hour ENDING at t0 + (h+1) h (IEMRE valid_utc; source units are inches, stored as mm).
Missing hours are null (never 0). Run: python -m scripts.fetch_rain
"""
import json, time
from datetime import date, datetime, timedelta, timezone
import httpx
import numpy as np
from backend.profiles import BBOX, CACHE

URL = "https://mesonet.agron.iastate.edu/api/1/iemre/hourly.json"
UA = {"User-Agent": "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"}
N = 5
T0 = datetime(2017, 8, 25, tzinfo=timezone.utc)  # hour 0 ends at T0 + 1 h
T1 = datetime(2017, 9, 4, tzinfo=timezone.utc)
DAYS = [date(2017, 8, 24) + timedelta(d) for d in range(12)]  # IEMRE "date" is a local (CDT) day: pad both ends


def get(client, **params):
    for a in range(6):
        try:
            r = client.get(URL, params=params, timeout=60)
            if r.status_code == 200:
                return r.json()["data"]
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(5 * 2 ** a)  # 5..160 s, ~5 min total before giving up
    raise RuntimeError(f"IEMRE failed for {params}")


def main():
    w, s, e, n = BBOX
    lons, lats = np.linspace(w, e, N).round(4).tolist(), np.linspace(s, n, N).round(4).tolist()
    hours = int((T1 - T0).total_seconds() // 3600)
    mm = []
    with httpx.Client(headers=UA) as c:
        for la in lats:
            for lo in lons:
                row = [None] * hours
                for d in DAYS:
                    for rec in get(c, date=d.isoformat(), lon=lo, lat=la):
                        v = datetime.fromisoformat(rec["valid_utc"].replace("Z", "+00:00"))
                        h = int((v - T0).total_seconds() // 3600) - 1
                        if 0 <= h < hours and rec.get("hourly_precip_in") is not None:
                            row[h] = round(rec["hourly_precip_in"] * 25.4, 2)
                    time.sleep(1)
                mm.append(row)
                print(la, lo, "total mm", round(sum(x or 0 for x in row)), "missing", row.count(None), flush=True)
    out = {"source": "Iowa Environmental Mesonet IEMRE hourly reanalysis (mesonet.agron.iastate.edu)", "units": "mm per hour",
           "t0": T0.isoformat().replace("+00:00", "Z"), "hours": hours, "lons": lons, "lats": lats, "mm": mm}
    (CACHE / "rain_harvey.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
