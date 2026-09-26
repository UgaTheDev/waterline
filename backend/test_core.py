"""Safety invariants. Run: .venv/bin/python -m backend.test_core"""
from datetime import datetime, timedelta, timezone
import networkx as nx
from .agent import violates, template
from .depth import finalize, parse
from .fusion import edge_state
from .router import Roads

T0 = datetime(2017, 8, 28, 6, tzinfo=timezone.utc)


def obs(minutes=0, high=40, status="ok", conf=0.8, eid="A-B-0"):
    return {"obs_id": f"o{minutes}{high}", "edge_id": eid, "time": T0 + timedelta(minutes=minutes), "status": status,
            "depth_cm": high * 0.7 if status == "ok" else None, "low_cm": high * 0.5 if status == "ok" else None,
            "high_cm": high if status == "ok" else None, "confidence": conf}


def grid():
    """A-B-C is the short way (200 m); A-D-C the detour (300 m). Two-way streets."""
    G = nx.MultiDiGraph()
    for n, (x, y) in {"A": (0, 0), "B": (0.001, 0), "C": (0.002, 0), "D": (0.001, 0.001)}.items():
        G.add_node(n, x=-95.4 + x, y=29.7 + y)
    for u, v, L in [("A", "B", 100), ("B", "C", 100), ("A", "D", 150), ("D", "C", 150)]:
        G.add_edge(u, v, 0, length=L, name=f"{u}{v} St")
        G.add_edge(v, u, 0, length=L, name=f"{u}{v} St")
    return Roads(G)


def route_names(r):
    return [a["name"] for a in r["avoided"]]


def test_fusion():
    assert edge_state([], T0) is None, "no reports must be unknown"
    assert edge_state([obs(60)], T0) is None, "future observations must not leak into the past"
    s = edge_state([obs()], T0 + timedelta(hours=6))
    assert s["state"] == "stale" and s["high_cm"] == 40, "decayed reports go stale (last-known kept), never dry"
    s = edge_state([obs(0, 50), obs(10, 5)], T0 + timedelta(minutes=15))
    assert s["high_cm"] == 50, "a fresh shallow photo can't erase a fresh deep one"
    assert edge_state([obs(status="unknown")], T0)["state"] == "reported_unknown"


def test_router():
    R, t = grid(), T0
    a, c = (29.7, -95.4), (29.7, -95.398)
    flooded = {"A-B-0": edge_state([obs(high=16)], t), "B-A-0": edge_state([obs(high=16)], t)}
    sedan = R.route(a, c, "sedan", flooded)
    assert sedan["found"] and route_names(sedan) == ["AB St"] and sedan["distance_m"] == 300, sedan
    truck = R.route(a, c, "truck", flooded)
    assert truck["found"] and truck["distance_m"] == 200 and not truck["avoided"], "16 cm is under the truck limit"
    unk = {"A-B-0": edge_state([obs(status="unknown")], t)}
    for v in ("sedan", "truck"):
        assert R.route(a, c, v, unk)["distance_m"] == 300, "water photographed with unreadable depth blocks every vehicle"
    everything = {e: edge_state([obs(high=80, eid=e)], t) for e in R.edges}
    r = R.route(a, c, "sedan", everything)
    assert not r["found"] and "No route" in r["reason"], "no route must never relax the limit"
    assert R.snap(29.7, -95.3995) in ("A-B-0", "B-A-0") and R.snap(29.72, -95.3995) is None


def test_depth_parsing():
    assert finalize(parse("sorry, I can't tell"))["status"] == "unknown"
    assert finalize(parse('{"depth_cm": -5}'))["high_cm"] is None, "invalid output must be unknown, not 0"
    e = finalize(parse('<think>tire...</think>{"water_visible": true, "reference_objects": [{"name": "car tire", '
                       '"typical_height_cm": 65, "water_line_fraction": 0.6}], "depth_cm": 39, "low_cm": 50, "high_cm": 30, '
                       '"confidence": 0.7, "rationale": "x"}'))
    assert (e["low_cm"], e["depth_cm"], e["high_cm"], e["reference"]) == (30, 39, 50, "car tire"), e


def test_wording():
    assert violates("Main St is safe to drive") and violates("You can safely take I-45")
    assert not violates("That road is unsafe.") and not violates("It is not safe.")
    for r in [None, {"found": False, "reason": "No route avoids reported deep water for a sedan.", "avoided": []},
              {"found": True, "distance_m": 3000, "avoided": [{"name": "Main St", "reason": "reported up to 40 cm"}], "unknown_m": 500, "warnings": []}]:
        assert not violates(template(r)), template(r)


def test_eval_metrics():
    from eval.run_eval import metrics
    ok = lambda true, high: {"true_cm": true, "status": "ok", "depth_cm": high - 5, "low_cm": high - 10, "high_cm": high, "reference": "curb"}
    m = metrics([ok(40, 14), ok(40, 50), {"true_cm": 30, "status": "unknown"}, ok(5, 10)])
    assert m["misses"] == 1 and abs(m["miss_rate"] - 1 / 3) < 1e-9, "only a passable call on deep water is a miss; unknown is blocked"
    assert m["abstain_rate"] == 0.25 and m["false_block_rate"] == 0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
