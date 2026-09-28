"""Plain-assert checks for eval/run_eval.py's pure functions. No GPU, no fixtures.

  python -m eval.test_eval
"""
from eval.run_eval import metrics, wilson_ci, cohens_kappa, boundary_agreement, consensus_row, inter_annotator_agreement


def test_metrics_basic():
    ok = lambda true, high, event="e1": {"true_cm": true, "status": "ok", "depth_cm": high - 5, "low_cm": high - 10,
                                          "high_cm": high, "reference": "curb", "event": event}
    m = metrics([ok(40, 14), ok(40, 50), {"true_cm": 30, "status": "unknown", "event": "e2"}, ok(5, 10)])
    assert m["misses"] == 1 and abs(m["miss_rate"] - 1 / 3) < 1e-9, "only a passable call on deep water is a miss; unknown is blocked"
    assert m["abstain_rate"] == 0.25 and m["false_block_rate"] == 0
    assert m["by_event"]["e1"]["n"] == 3 and m["by_event"]["e2"]["n"] == 1


def test_wilson_ci_known_values():
    # 0/20 misses: known Wilson upper bound ~0.161 (textbook value for n=20, k=0, 95%)
    lo, hi = wilson_ci(0, 20)
    assert lo == 0 or abs(lo) < 1e-9
    assert abs(hi - 0.1610) < 5e-4, hi
    # 5/20: center should be near p=0.25, and the interval must contain the point estimate
    lo, hi = wilson_ci(5, 20)
    assert lo < 0.25 < hi
    # more data -> tighter interval at the same proportion
    lo2, hi2 = wilson_ci(50, 200)
    assert (hi2 - lo2) < (hi - lo)
    assert wilson_ci(0, 0) is None


def test_miss_rate_upper_message_only_when_zero_misses():
    m0 = metrics([{"true_cm": 40, "status": "ok", "depth_cm": 40, "low_cm": 35, "high_cm": 45, "reference": "curb"}] * 5)
    assert m0["misses"] == 0 and m0["miss_rate_upper_message"].startswith("miss rate")
    m1 = metrics([{"true_cm": 40, "status": "ok", "depth_cm": 5, "low_cm": 0, "high_cm": 10, "reference": "curb"}])
    assert m1["misses"] == 1 and m1["miss_rate_upper_message"] is None


def test_cohens_kappa_tiny_example():
    # perfect agreement
    assert cohens_kappa([("a", "a"), ("b", "b"), ("a", "a")]) == 1.0
    # classic partial-agreement case: some chance-corrected value strictly between 0 and 1
    pairs = [("a", "a"), ("a", "b"), ("b", "b"), ("b", "b"), ("a", "a")]
    k = cohens_kappa(pairs)
    assert 0 < k < 1, k
    assert cohens_kappa([]) is None


def test_boundary_agreement():
    # 15cm boundary: (true1>15) vs (true2>15)
    pairs = [(10, 12), (20, 25), (10, 20), (5, 5)]  # last two: first agrees(both<=15 false/false), third disagrees
    assert abs(boundary_agreement(pairs) - 3 / 4) < 1e-9


def test_consensus_is_the_deeper_band():
    rows = [{"band_high_cm": "15", "annotator": "kush"}, {"band_high_cm": "60", "annotator": "sam"}]
    assert consensus_row(rows)["annotator"] == "sam", "conservative: deeper band wins on disagreement"
    assert consensus_row([rows[0]])["annotator"] == "kush"


def test_inter_annotator_agreement_needs_two_raters():
    rows = [
        {"path": "a.jpg", "annotator": "kush", "band_high_cm": "15", "true_cm": "8"},
        {"path": "a.jpg", "annotator": "sam", "band_high_cm": "60", "true_cm": "45"},
        {"path": "b.jpg", "annotator": "kush", "band_high_cm": "0", "true_cm": "0"},  # only one rater
    ]
    agr = inter_annotator_agreement(rows)
    assert agr["n_photos"] == 1
    assert agr["boundary_agreement"] == 0.0  # 8cm side vs 45cm side: disagree


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all eval tests passed")
