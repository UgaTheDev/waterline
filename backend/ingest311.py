"""Houston 311 flood reports -> observation dicts. ponytail: no real export exists yet (a recon stream is checking
whether 2017 records survive); this only prepares the parser + csv loader for when one shows up."""
import csv, uuid
from datetime import datetime, timezone
from .agent import reached_cm
from .store import ts


def parse_text_report(text, lat, lon, time=None):
    """Free-text 311 description -> observation dict, or None if no depth is described.
    Never files depth 0 or "dry": no depth word means no observation, not a clear road."""
    cm = reached_cm(text)
    if cm is None:
        return None
    when = ts(time) if isinstance(time, str) else (time or datetime.now(timezone.utc))
    return {
        "obs_id": f"report311-{uuid.uuid4().hex[:10]}", "lat": float(lat), "lon": float(lon), "time": when,
        "status": "ok", "depth_cm": round(cm, 1), "low_cm": round(cm * 0.5, 1),
        "high_cm": round(max(cm * 1.5, cm + 20), 1), "confidence": 0.4,
        "reference": f"311 report: {text.strip()[:60]}", "rationale": "Houston 311 description; depth mapped from wording.",
        "kind": "report311", "precision": "street", "credit": "Houston 311",
    }


def load_csv(path):
    """Houston 311 export (columns: description, lat, lon, created) -> list of observation dicts,
    skipping rows with no depth wording."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = (parse_text_report(row.get("description"), row.get("lat"), row.get("lon"), row.get("created"))
                for row in csv.DictReader(f))
        return [o for o in rows if o]
