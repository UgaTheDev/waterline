"""Observations: the committed per-event replay caches (read-only) + live uploads in SQLite. Every observation carries
"event" (an id from backend/events.py); rows from databases made before events existed are the default event."""
import json, os, pathlib, sqlite3, threading
from datetime import datetime, timezone
from .profiles import DB_PATH
from . import events

COLS = ["obs_id", "edge_id", "time", "lat", "lon", "status", "depth_cm", "low_cm", "high_cm", "confidence",
        "reference", "rationale", "credit", "image_url", "queue_state", "media_path", "mime", "session_id", "kind", "street", "provenance", "half_life_min",
        "flags", "attempts", "event"]  # flags: JSON list of "person_in_water"|"occupied_vehicle"; never reaches /segments or routing
REAL = ("depth_cm", "low_cm", "high_cm", "confidence", "lat", "lon", "half_life_min", "attempts")


def ts(s):
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)  # naive input is UTC, never a 500


class Store:
    def __init__(self):
        self.replay = {}  # event id -> read-only replay observations
        for eid, e in events.registry().items():
            d = e["dir"]
            photos = pathlib.Path(os.getenv("REPLAY_PATH")) if os.getenv("REPLAY_PATH") and eid == events.DEFAULT else d / "replay_observations.json"
            paths = [photos,  # REPLAY_PATH overrides the default event's photos, only for local dev fixtures
                     d / "survey_observations.json",  # USGS high-water marks minus 3DEP ground (scripts/survey_layer.py)
                     d / "inferred_observations.json"]  # stream A: terrain inference over the replay
            self.replay[eid] = [dict(o, time=ts(o["time"]), event=eid) for p in paths if p.exists() for o in json.loads(p.read_text())]
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
        # ponytail: sqlite3.Connection isn't safe for concurrent execute() from multiple threads
        # (one uvicorn worker still runs sync endpoints across a threadpool of threads) -- under
        # load this raised "sqlite3.InterfaceError: bad parameter or other API misuse". The lock
        # already serializes writers; reads need it too, not a connection pool, at this traffic.
        with self.lock:
            r = self.db.execute("SELECT * FROM obs WHERE obs_id=?", (obs_id,)).fetchone()
        return dict(r, time=ts(r["time"])) if r else None

    def claim(self, obs_id):
        """Atomically take a queued upload so two workers never pay for the same media."""
        with self.lock, self.db:
            return self.db.execute("UPDATE obs SET queue_state='processing' WHERE obs_id=? AND queue_state='queued'", (obs_id,)).rowcount == 1

    def queued(self):
        with self.lock:
            return [dict(r, time=ts(r["time"])) for r in self.db.execute("SELECT * FROM obs WHERE queue_state='queued' ORDER BY time LIMIT 3")]

    def all(self, session=None, event=events.DEFAULT):
        """One event's replay cache + its global live reports + its reports sandboxed to this session."""
        q = "SELECT * FROM obs WHERE queue_state='done' AND (session_id IS NULL OR session_id=?) AND COALESCE(event, ?)=?"
        with self.lock:
            rows = self.db.execute(q, (session or "", events.DEFAULT, event)).fetchall()
        return self.replay.get(event, []) + [dict(r, time=ts(r["time"])) for r in rows]
