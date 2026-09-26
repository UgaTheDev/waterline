"""USGS STN high-water marks (public domain) -> candidate eval rows.

  python eval/fetch_stn.py count                 # per-event counts, picks the replay event
  python eval/fetch_stn.py download 180 --n 150  # photos + eval/stn_candidates.csv for labeling

A candidate is a photo attached to an HWM with height_above_gnd > 0 (feet above ground at
the mark). That is the ground truth: the flood line's height above ground.
"""
import argparse, csv, json, pathlib, sys, urllib.request

API = "https://stn.wim.usgs.gov/STNServices"
EVENTS = {180: "2017 Harvey", 312: "2021 Ida", 334: "2023 July MA NY VT Flood",
          346: "2024 Helene", 357: "2025 July TX Flood"}
PHOTO = 1  # filetype_id 1 = Photo
ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw/stn"


def get(path):
    with urllib.request.urlopen(f"{API}/{path}", timeout=120) as r:
        return json.load(r)


def candidates(event_id):
    rows = []
    for f in get(f"Events/{event_id}/Files.json"):
        h = f.get("hwm") or {}
        hag = h.get("height_above_gnd")
        if f.get("filetype_id") != PHOTO or not hag or hag <= 0:
            continue
        rows.append({
            "file_id": f["file_id"], "hwm_id": h["hwm_id"], "event_id": event_id,
            "true_cm": round(hag * 30.48, 1), "environment": h.get("hwm_environment"),
            "quality_id": h.get("hwm_quality_id"), "lat": h["latitude_dd"], "lon": h["longitude_dd"],
            "photo_date": f.get("photo_date"), "description": (f.get("description") or "")[:200],
        })
    return rows


def count():
    for eid, name in EVENTS.items():
        try:
            rows = candidates(eid)
        except Exception as e:  # one event failing shouldn't hide the others
            print(f"{eid} {name}: ERROR {e}")
            continue
        riv = sum(r["environment"] == "Riverine" for r in rows)
        band = sum(15 < r["true_cm"] <= 120 for r in rows)  # the decision band: 6 in to 4 ft
        print(f"{eid:>4} {name:<26} photos_with_depth={len(rows):>5} riverine={riv:>5} 15-120cm={band:>5}")


def download(event_id, n):
    rows = [r for r in candidates(event_id) if r["true_cm"] <= 300]
    # spread over depth so the eval isn't all one bucket; ponytail: stride sample, stratify if skewed
    rows.sort(key=lambda r: r["true_cm"])
    rows = rows[:: max(1, len(rows) // n)][:n]
    out = RAW / str(event_id)
    out.mkdir(parents=True, exist_ok=True)
    for r in rows:
        p = out / f"{r['file_id']}.jpg"
        if not p.exists():
            try:
                urllib.request.urlretrieve(f"{API}/Files/{r['file_id']}/item", p)
            except Exception as e:
                print("skip", r["file_id"], e, file=sys.stderr)
                continue
        r["path"] = str(p.relative_to(ROOT))
    rows = [r for r in rows if "path" in r]
    dst = ROOT / "eval/stn_candidates.csv"
    with open(dst, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} photos -> {out}, rows -> {dst}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["count", "download"])
    ap.add_argument("event_id", nargs="?", type=int)
    ap.add_argument("--n", type=int, default=150)
    a = ap.parse_args()
    count() if a.cmd == "count" else download(a.event_id, a.n)
