"""Observations: the committed replay cache (read-only) + live uploads in SQLite."""
import json, os, pathlib, sqlite3, threading
from datetime import datetime
from .profiles import CACHE, DB_PATH

COLS = ["obs_id", "edge_id", "time", "lat", "lon", "status", "depth_cm", "low_cm", "high_cm", "confidence",
        "reference", "rationale", "credit", "image_url", "queue_state", "media_path", "mime"]


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class Store:
    def __init__(self):
        paths = [pathlib.Path(os.getenv("REPLAY_PATH", CACHE / "replay_observations.json")),  # override only for local dev fixtures
                 CACHE / "survey_observations.json"]  # USGS high-water marks minus 3DEP ground (scripts/survey_layer.py)
        self.replay = [dict(o, time=ts(o["time"])) for p in paths if p.exists() for o in json.loads(p.read_text())]
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()  # ponytail: one writer lock, fine at demo scale
        self.db.execute(f"CREATE TABLE IF NOT EXISTS obs ({', '.join(c + ' TEXT' if c not in ('depth_cm','low_cm','high_cm','confidence','lat','lon') else c + ' REAL' for c in COLS)}, PRIMARY KEY(obs_id))")

    def put(self, o):
        row = {c: o.get(c) for c in COLS}
        row["time"] = o["time"].isoformat() if isinstance(o["time"], datetime) else o["time"]
        with self.lock, self.db:
            self.db.execute(f"INSERT OR REPLACE INTO obs VALUES ({','.join('?' * len(COLS))})", [row[c] for c in COLS])

    def get(self, obs_id):
        r = self.db.execute("SELECT * FROM obs WHERE obs_id=?", (obs_id,)).fetchone()
        return dict(r, time=ts(r["time"])) if r else None

    def queued(self):
        return [dict(r, time=ts(r["time"])) for r in self.db.execute("SELECT * FROM obs WHERE queue_state='queued'")]

    def all(self):
        live = [dict(r, time=ts(r["time"])) for r in self.db.execute("SELECT * FROM obs WHERE queue_state='done'")]
        return self.replay + live
