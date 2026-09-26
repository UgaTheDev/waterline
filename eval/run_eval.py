"""Depth eval. Headline: dangerous-road miss rate (true > 15 cm but marked passable for a sedan).

  python -m eval.run_eval --split dev     # iterate prompts here
  python -m eval.run_eval --split test    # report this; exits 1 if any dangerous road was missed

labels.csv columns: path,true_cm,split,source,license,credit,lat,lon  (split = dev | test, frozen)
Predictions are cached per prompt version in eval/results/preds_<hash>.jsonl, so re-runs are free.
"""
import argparse, csv, hashlib, json, pathlib, statistics, sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
RESULTS = ROOT / "eval/results"
SEDAN_CM = 15


def metrics(rows):
    """rows: dicts with true_cm and the depth.finalize() fields. Pure, so it's testable without a GPU."""
    ok = [r for r in rows if r["status"] == "ok"]
    danger = [r for r in rows if r["true_cm"] > SEDAN_CM]
    shallow = [r for r in rows if r["true_cm"] <= SEDAN_CM]
    passable = lambda r: r["status"] == "ok" and r["high_cm"] <= SEDAN_CM  # unknown counts as blocked, like the router
    by_ref = defaultdict(list)
    for r in ok:
        by_ref[r.get("reference") or "none"].append(abs(r["depth_cm"] - r["true_cm"]))
    return {
        "n": len(rows), "n_dangerous": len(danger),
        "miss_rate": sum(map(passable, danger)) / len(danger) if danger else None,
        "misses": sum(map(passable, danger)),
        "false_block_rate": sum(not passable(r) for r in shallow) / len(shallow) if shallow else None,
        "abstain_rate": (len(rows) - len(ok)) / len(rows) if rows else None,
        "mae_cm": round(statistics.mean(abs(r["depth_cm"] - r["true_cm"]) for r in ok), 1) if ok else None,
        "coverage": round(sum(r["low_cm"] <= r["true_cm"] <= r["high_cm"] for r in ok) / len(ok), 3) if ok else None,
        "by_reference": {k: {"n": len(v), "mae_cm": round(statistics.mean(v), 1)} for k, v in sorted(by_ref.items(), key=lambda kv: -len(kv[1]))},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["dev", "test"], required=True)
    ap.add_argument("--labels", default=str(ROOT / "eval/labels.csv"))
    a = ap.parse_args()
    from backend import depth, profiles as P  # imported here so metrics() needs no deps

    labels = [r for r in csv.DictReader(open(a.labels)) if r["split"] == a.split]
    if not labels:
        sys.exit(f"no {a.split} rows in {a.labels}")
    RESULTS.mkdir(parents=True, exist_ok=True)
    version = hashlib.sha1(f"{depth.PROMPT}|{P.COSMOS_MODEL}|{P.HIGH_SCALE}|{P.HIGH_MARGIN_CM}".encode()).hexdigest()[:10]
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
        rows.append({**pred, "true_cm": float(lab["true_cm"])})
        print(f"\r{i + 1}/{len(labels)}", end="", file=sys.stderr)
    m = {**metrics(rows), "split": a.split, "prompt_version": version, "model": P.COSMOS_MODEL,
         "note": "MAE is not directly comparable to FloodVision's 8.75 cm: different images and labels."}
    (RESULTS / f"{a.split}.json").write_text(json.dumps(m, indent=1))
    print("\n" + json.dumps({k: v for k, v in m.items() if k != "by_reference"}, indent=1))
    if m["misses"]:
        sys.exit(f"FAIL: {m['misses']} dangerous road(s) marked passable for a sedan")


if __name__ == "__main__":
    main()
