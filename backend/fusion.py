"""Observations -> per-road-segment flood state at time t.

An observation (dict): obs_id, edge_id, time (aware datetime), status ("ok" | "unknown"),
depth_cm, low_cm, high_cm, confidence, plus evidence fields (reference, rationale, credit, image_url).
"""
from collections import defaultdict
from .profiles import HALF_LIFE_MIN, MIN_WEIGHT, VEHICLES

BLOCKS_ALL_CM = max(v["limit_cm"] for v in VEHICLES.values())


def weight(o, t):
    age_min = (t - o["time"]).total_seconds() / 60
    # photos decay fast; USGS survey peaks describe hours of flooding (half_life_min set per observation)
    return (o.get("confidence") or 0.5) * 0.5 ** (age_min / (o.get("half_life_min") or HALF_LIFE_MIN))


def edge_state(obs, t):
    """None = no reports at all (unknown). Otherwise a state dict. Never returns 'dry'."""
    past = [o for o in obs if o["time"] <= t]  # no peeking at the future during replay
    if not past:
        return None
    live = [o for o in past if weight(o, t) >= MIN_WEIGHT]
    evidence = sorted(live or past, key=lambda o: o["time"], reverse=True)[:5]
    if not live:
        last = evidence[0]
        return {"state": "stale", "high_cm": last.get("high_cm"), "depth_cm": last.get("depth_cm"),
                "low_cm": last.get("low_cm"), "confidence": None, "obs_time": last["time"], "evidence": evidence}
    known = [o for o in live if o["status"] == "ok"]
    unknown_live = any(o["status"] != "ok" for o in live)
    # Water photographed at an unreadable depth has an unbounded upper bound: while that report is live, a readable
    # shallower one (even a dry photo) must not clear the street. Only a reading that already blocks every vehicle wins.
    if not known or (unknown_live and max(o["high_cm"] for o in known) <= BLOCKS_ALL_CM):
        return {"state": "reported_unknown", "high_cm": None, "depth_cm": None, "low_cm": None,
                "confidence": None, "obs_time": evidence[0]["time"], "evidence": evidence}
    # Route on the worst plausible depth among reports that still count. Recession shows up
    # as the deep reports decay; a single shallow photo can't erase a fresh deep one.
    top = max(known, key=lambda o: (o["high_cm"], o.get("kind") != "inferred"))  # a tie goes to the observed report
    return {"state": "reported", "basis": "inferred" if top.get("kind") == "inferred" else "observed", "high_cm": top["high_cm"], "depth_cm": top["depth_cm"], "low_cm": top["low_cm"],
            "confidence": top["confidence"], "obs_time": top["time"], "evidence": evidence}


def states_at(observations, t):
    by_edge = defaultdict(list)
    for o in observations:
        if o.get("edge_id"):
            by_edge[o["edge_id"]].append(o)
    out = {}
    for eid, obs in by_edge.items():
        s = edge_state(obs, t)
        if s:
            out[eid] = s
    return out
