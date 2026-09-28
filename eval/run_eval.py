"""Depth eval. Headline: dangerous-road miss rate (true > 15 cm but marked passable for a sedan).

  python -m eval.run_eval --split dev     # iterate prompts here
  python -m eval.run_eval --split test    # report this; exits 1 if any dangerous road was missed

labels.csv columns: path,true_cm,split,source,license,credit,lat,lon,annotator  (split = dev | test, frozen)
Predictions are cached per prompt version in eval/results/preds_<hash>.jsonl, so re-runs are free.

Consensus: when a photo has labels from more than one annotator, the label used for
scoring is the DEEPER band (conservative -- matches the "unknown is not dry" posture).
See consensus_row().
"""
import argparse, csv, hashlib, json, math, pathlib, statistics, sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
RESULTS = ROOT / "eval/results"
SEDAN_CM = 15


def wilson_ci(k, n, z=1.96):
    """Wilson 95% CI for a proportion k/n (95% -> z=1.96). Better than the normal
    approximation at small n / n near 0, which is exactly our case (misses should be 0)."""
    if n == 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    center = p + z * z / (2 * n)
    spread = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((center - spread) / denom, (center + spread) / denom)


def consensus_row(rows_for_path):
    """rows_for_path: label rows (dicts with band_high_cm) for the same photo from one
    or more annotators. Returns the deepest one -- the conservative pick when annotators
    disagree, so a miss another annotator would have caught can't be averaged away."""
    return max(rows_for_path, key=lambda r: float(r["band_high_cm"]))


def cohens_kappa(pairs):
    """pairs: list of (rater1_label, rater2_label) for the same photos. Standard
    Cohen's kappa: (observed agreement - chance agreement) / (1 - chance agreement)."""
    if not pairs:
        return None
    n = len(pairs)
    po = sum(a == b for a, b in pairs) / n
    labels = sorted(set(a for a, _ in pairs) | set(b for _, b in pairs))
    r1 = defaultdict(int); r2 = defaultdict(int)
    for a, b in pairs:
        r1[a] += 1; r2[b] += 1
    pe = sum((r1[l] / n) * (r2[l] / n) for l in labels)
    if pe == 1:
        return 1.0  # no room for chance disagreement; perfect agreement isn't undefined
    return (po - pe) / (1 - pe)


def boundary_agreement(pairs_cm):
    """pairs_cm: list of (true_cm_1, true_cm_2) for the same photos from two raters.
    Raw agreement on which side of the 15 cm sedan boundary each rater put the photo."""
    if not pairs_cm:
        return None
    return sum((a > SEDAN_CM) == (b > SEDAN_CM) for a, b in pairs_cm) / len(pairs_cm)


def inter_annotator_agreement(label_rows):
    """label_rows: raw labels.csv rows (one per annotator per photo, any split). For
    each photo with >=2 distinct annotators, takes the first two (sorted by name, so
    it's deterministic) as the rater pair. Pure function of the rows given."""
    by_path = defaultdict(dict)
    for r in label_rows:
        by_path[r["path"]][r.get("annotator") or "kush"] = r
    band_pairs, cm_pairs = [], []
    for path, by_annotator in by_path.items():
        if len(by_annotator) < 2:
            continue
        a, b = sorted(by_annotator)[:2]
        r1, r2 = by_annotator[a], by_annotator[b]
        band_pairs.append((r1["band_high_cm"], r2["band_high_cm"]))
        cm_pairs.append((float(r1["true_cm"]), float(r2["true_cm"])))
    return {"n_photos": len(band_pairs), "kappa": cohens_kappa(band_pairs), "boundary_agreement": boundary_agreement(cm_pairs)}


def metrics(rows):
    """rows: dicts with true_cm and the depth.finalize() fields, optionally an
    "event" tag. Pure, so it's testable without a GPU."""
    ok = [r for r in rows if r["status"] == "ok"]
    danger = [r for r in rows if r["true_cm"] > SEDAN_CM]
    shallow = [r for r in rows if r["true_cm"] <= SEDAN_CM]
    passable = lambda r: r["status"] == "ok" and r["high_cm"] <= SEDAN_CM  # unknown counts as blocked, like the router
    by_ref = defaultdict(list)
    for r in ok:
        by_ref[r.get("reference") or "none"].append(abs(r["depth_cm"] - r["true_cm"]))
    misses = sum(map(passable, danger))
    ci = wilson_ci(misses, len(danger)) if danger else None
    by_event = defaultdict(list)
    for r in rows:
        by_event[r.get("event") or "unknown"].append(r)
    return {
        "n": len(rows), "n_dangerous": len(danger),
        "miss_rate": misses / len(danger) if danger else None,
        "misses": misses,
        "miss_rate_ci95": ci,
        "miss_rate_upper_message": (f"miss rate ≤ {ci[1] * 100:.1f}% with 95% confidence" if ci and misses == 0 else None),
        "false_block_rate": sum(not passable(r) for r in shallow) / len(shallow) if shallow else None,
        "abstain_rate": (len(rows) - len(ok)) / len(rows) if rows else None,
        "mae_cm": round(statistics.mean(abs(r["depth_cm"] - r["true_cm"]) for r in ok), 1) if ok else None,
        "coverage": round(sum(r["low_cm"] <= r["true_cm"] <= r["high_cm"] for r in ok) / len(ok), 3) if ok else None,
        "by_reference": {k: {"n": len(v), "mae_cm": round(statistics.mean(v), 1)} for k, v in sorted(by_ref.items(), key=lambda kv: -len(kv[1]))},
        "by_event": {
            ev: {"n": len(evrows), "n_dangerous": sum(1 for r in evrows if r["true_cm"] > SEDAN_CM),
                 "misses": sum(passable(r) for r in evrows if r["true_cm"] > SEDAN_CM)}
            for ev, evrows in sorted(by_event.items())
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["dev", "test"], required=True)
    ap.add_argument("--labels", default=str(ROOT / "eval/labels.csv"))
    a = ap.parse_args()
    from backend import depth, profiles as P  # imported here so metrics() needs no deps

    all_labels = list(csv.DictReader(open(a.labels)))
    split_labels = [r for r in all_labels if r["split"] == a.split]
    if not split_labels:
        sys.exit(f"no {a.split} rows in {a.labels}")
    agreement = inter_annotator_agreement(all_labels)
    # consensus: when >=2 annotators labeled a photo, score the deeper (conservative) band
    by_path = defaultdict(list)
    for r in split_labels:
        by_path[r["path"]].append(r)
    labels = [consensus_row(rs) for rs in by_path.values()]
    event_by_path = {r["path"]: r.get("event", "") for r in csv.DictReader(open(ROOT / "eval/pool.csv"))} \
        if (ROOT / "eval/pool.csv").exists() else {}
    RESULTS.mkdir(parents=True, exist_ok=True)
    version = hashlib.sha1(f"{depth.PROMPT}|{depth.model()}|{P.HIGH_SCALE}|{P.HIGH_MARGIN_CM}".encode()).hexdigest()[:10]
    cache_p = RESULTS / f"preds_{version}.jsonl"
    cache = {json.loads(l)["path"]: json.loads(l) for l in cache_p.open()} if cache_p.exists() else {}
    c = depth.client()
    rows = []
    for i, lab in enumerate(labels):
        pred = cache.get(lab["path"])
        if pred is None:
            pred = {"path": lab["path"], **depth.estimate(depth.prepare_image((ROOT / lab["path"]).read_bytes()), c=c)}
            with cache_p.open("a") as fh:
                fh.write(json.dumps(pred) + "\n")
        rows.append({**pred, "true_cm": float(lab["true_cm"]), "event": event_by_path.get(lab["path"], "")})
        print(f"\r{i + 1}/{len(labels)}", end="", file=sys.stderr)
    m = {**metrics(rows), "split": a.split, "prompt_version": version, "model": depth.model(),
         "inter_annotator_agreement": agreement,
         "note": "MAE is not directly comparable to FloodVision's 8.75 cm: different images and labels."}
    (RESULTS / f"{a.split}.json").write_text(json.dumps(m, indent=1))
    print("\n" + json.dumps({k: v for k, v in m.items() if k != "by_reference"}, indent=1))
    if m["misses"]:
        sys.exit(f"FAIL: {m['misses']} dangerous road(s) marked passable for a sedan")


if __name__ == "__main__":
    main()
