"""Bare-earth DEM for an event bbox at ~5 m/px from USGS 3DEP (public domain). Writes data/cache/events/<id>/dem_5m.npz.

Vertical datum: NAVD88, stored as int32 CENTIMETRES (int16 overflowed above 327 m: Kerrville wrapped to negative heights) (the 3DEP service returns float metres; x100, rounded).
  metres = z_cm / 100, feet = z_cm / 30.48. STN high-water mark elev_ft values are NAVD88 FEET: convert with * 30.48.
  NODATA = -32768. Grid: EPSG:4326, row 0 = north edge; cell (r, c) centre =
  (lon = w + (c + 0.5) * dx, lat = n - (r + 0.5) * dy), with bbox = [w, s, e, n] and shape = (rows, cols).
3DEP's bare-earth surface is the ground under a bridge, not the deck (see scripts/survey_layer.py).
    python -m scripts.build_dem [event_id]          (default harvey2017)
"""
import io, math, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image
from backend import events
from scripts.survey_layer import DEM

UA = {"User-Agent": "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()

RES_M, TILE = 5.0, 1000  # px per tile side; exportImage caps well above this
NODATA = -32768


def tile(w, s, e, n, cols, rows):
    q = urllib.parse.urlencode({"bbox": f"{w},{s},{e},{n}", "bboxSR": 4326, "imageSR": 4326, "size": f"{cols},{rows}",
                                "format": "tiff", "pixelType": "F32", "noData": -9999, "interpolation": "RSP_BilinearInterpolation", "f": "image"})
    for attempt in range(40):  # the 3DEP image server returns intermittent 502s
        try:
            a = np.array(Image.open(io.BytesIO(get(f"{DEM}?{q}"))), dtype=np.float32)
            if a.shape == (rows, cols):
                return a
            raise ValueError(f"shape {a.shape} != {(rows, cols)}")
        except Exception as ex:
            print(f"  retry {attempt + 1}: {ex}")
            time.sleep(min(30, 3 + 2 * attempt))
    raise SystemExit("3DEP still failing after retries")


def main(E):
    w, s, e, n = E["bbox"]
    lat0 = (s + n) / 2
    dx, dy = RES_M / (111320 * math.cos(math.radians(lat0))), RES_M / 110540
    cols, rows = math.ceil((e - w) / dx), math.ceil((n - s) / dy)
    e, s = w + cols * dx, n - rows * dy  # snap the far edges to whole cells
    z = np.full((rows, cols), NODATA, np.int32)
    for r0 in range(0, rows, TILE):
        for c0 in range(0, cols, TILE):
            h, wd = min(TILE, rows - r0), min(TILE, cols - c0)
            print(f"tile r{r0} c{c0} ({wd}x{h})")
            a = tile(w + c0 * dx, n - (r0 + h) * dy, w + (c0 + wd) * dx, n - r0 * dy, wd, h)
            ok = a > -1000
            z[r0:r0 + h, c0:c0 + wd][ok] = np.round(a[ok] * 100).astype(np.int32)
            time.sleep(0.5)
    out = E["dir"] / "dem_5m.npz"
    np.savez_compressed(out, z_cm=z, bbox=np.array([w, s, e, n]), shape=np.array(z.shape),
                        datum=np.array("NAVD88 centimetres (int32); nodata -32768; row 0 = north"))
    print(f"{out} {z.shape} {out.stat().st_size / 1e6:.1f} MB, nodata {np.mean(z == NODATA):.2%}, "
          f"range {z[z != NODATA].min() / 100:.1f}..{z[z != NODATA].max() / 100:.1f} m")


if __name__ == "__main__":
    import sys
    main(events.get(sys.argv[1] if len(sys.argv) > 1 else None))
