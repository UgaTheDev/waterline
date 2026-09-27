"""Observations: the committed replay cache (read-only) + live uploads in SQLite."""
import json, os, pathlib, sqlite3, threading
from datetime import datetime
from .profiles import CACHE, DB_PATH

COLS = ["obs_id", "edge_id", "time", "lat", "lon", "status", "depth_cm", "low_cm", "high_cm", "confidence",
        "reference", "rationale", "credit", "image_url", "queue_state", "media_path", "mime", "session_id", "kind", "street", "provenance", "half_life_min",
        "flags"]  # flags: JSON list of "person_in_water"|"occupied_vehicle"; never reaches /segments or routing
REAL = ("depth_cm", "low_cm", "high_cm", "confidence", "lat", "lon", "half_life_min")


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class Store:
    def __init__(self):
        paths = [pathlib.Path(os.getenv("REPLAY_PATH", CACHE / "replay_observations.json")),  # override only for local dev fixtures
                 CACHE / "survey_observations.json",  # USGS high-water marks minus 3DEP ground (scripts/survey_layer.py)
                 CACHE / "inferred_observations.json"]  # stream A: terrain inference over the replay
        self.replay = [dict(o, time=ts(o["time"])) for p in paths if p.exists() for o in json.loads(p.read_text())]
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()  # ponytail: one writer lock, fine at demo scale
        self.db.execute(f"CREATE TABLE IF NOT EXISTS obs ({', '.join(c + (' REAL' if c in REAL else ' TEXT') for c in COLS)}, PRIMARY KEY(obs_id))")
        have = {r[1] for r in self.db.execute("PRAGMA table_info(obs)")}
        for c in COLS:  # additive migration for databases made by older versions
            if c not in have:
                self.db.execute(f"ALTER TABLE obs ADD COLUMN {c} {'REAL' if c in REAL else 'TEXT'}")

    def put(self, o):
        row = {c: o.get(c) for c in COLS}
        row["time"] = o["time"].isoformat() if isinstance(o["time"], datetime) else o["time"]
        if isinstance(row["provenance"], (dict, list)):
            row["provenance"] = json.dumps(row["provenance"])
        if isinstance(row["flags"], list):
            row["flags"] = json.dumps(row["flags"])
        with self.lock, self.db:
            self.db.execute(f"INSERT OR REPLACE INTO obs VALUES ({','.join('?' * len(COLS))})", [row[c] for c in COLS])

    def get(self, obs_id):
        r = self.db.execute("SELECT * FROM obs WHERE obs_id=?", (obs_id,)).fetchone()
        return dict(r, time=ts(r["time"])) if r else None

    def queued(self):
        return [dict(r, time=ts(r["time"])) for r in self.db.execute("SELECT * FROM obs WHERE queue_state='queued'")]

    def all(self, session=None):
        """Replay cache + global live reports + reports sandboxed to this session (filed while viewing the replay)."""
        q = "SELECT * FROM obs WHERE queue_state='done' AND (session_id IS NULL OR session_id=?)"
        return self.replay + [dict(r, time=ts(r["time"])) for r in self.db.execute(q, (session or "",))]
