"""Static replay snapshot for judging (Dec 1-15): freezes /config, /events, /alerts, /segments
(every few hours across the default event's replay window) and /eval into
web/public/snapshot/<event>/, for the web fallback (web/lib/fallback.ts) to serve when the live
backend is unreachable.

No server: FastAPI's TestClient drives backend/app.py in-process against a throwaway, empty
DB_PATH, so the export never touches session-scoped reports or uploads (no `session` query param
is ever sent, and the temp DB starts empty regardless).

    python -m scripts.export_snapshot [--step-hours N] [--event ID]

A step whose output would be too large: rerun with a larger --step-hours (fewer times).
"""
import argparse, json, os, pathlib, tempfile
from datetime import datetime, timedelta, timezone


def _parse(s):
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _iso(d):
    return d.isoformat().replace("+00:00", "Z")


def _fname(d):
    return d.strftime("%Y-%m-%dT%H-%M-%SZ")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step-hours", type=float, default=3.0)
    ap.add_argument("--event", default=None, help="event id (default: the default event)")
    args = ap.parse_args()

    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    os.environ["DB_PATH"] = tmp.name  # must be set before backend.app (and .profiles) import

    from fastapi.testclient import TestClient
    from backend import events
    from backend.app import app

    c = TestClient(app)

    def get(path):
        r = c.get(path)
        r.raise_for_status()
        return r.json()

    def write(p, obj):
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(obj, separators=(",", ":")))  # compact: gzips well, small on disk either way

    eid = args.event or events.DEFAULT
    out = pathlib.Path(__file__).resolve().parent.parent / "web/public/snapshot" / eid

    cfg = get(f"/config?event={eid}")
    write(out / "config.json", cfg)
    write(out / "events.json", get("/events"))
    write(out / "eval.json", get(f"/eval?event={eid}"))

    t0, t1 = _parse(cfg["replay"]["start"]), _parse(cfg["replay"]["end"])
    step = timedelta(hours=args.step_hours)
    times, t = [], t0
    while t < t1:
        times.append(t)
        t += step
    times.append(t1)

    for d in times:
        iso = _iso(d)
        write(out / "segments" / f"{_fname(d)}.json", get(f"/segments?t={iso}&event={eid}"))
        write(out / "alerts" / f"{_fname(d)}.json", get(f"/alerts?t={iso}&event={eid}"))

    write(out / "index.json", {"event": eid, "times": [_iso(d) for d in times]})

    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"{eid}: {len(times)} times, {size / 1e6:.2f} MB at {out}")
    if size > 15 * 1024 * 1024:
        print("over the ~15 MB budget: rerun with a larger --step-hours")


if __name__ == "__main__":
    main()
