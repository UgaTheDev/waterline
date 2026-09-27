"""Held-out-geography test of the nowcast, and the production fit. Writes eval/results/nowcast.json.
    python -m scripts.eval_nowcast

Labels: an edge (and its reverse twin) is positive if any survey or inferred observation later puts > 15 cm on it
(all label times are Sep 1-2 17Z USGS peak estimates). Everything else is "no deep water evidence", NOT dry.
Scores are computed at storm times every 6 h, Aug 26 00Z - Aug 31 00Z, all before the earliest label time.
Split: by longitude at the median edge; edges within GAP_DEG of the line are dropped from both sides (inferred labels
spread up to 800 m, so neighbours across the line would share a label source). Fit west -> test east, and the reverse.
Baselines: rain-only (6 h rain), terrain-only (the fitted terrain percentile, no rain), unfitted -hand_m and depression_cm.
Also fits the logistic WITH rain terms, to show whether these labels can fit rain at all.
"""
import json
from datetime import datetime, timedelta, timezone
import numpy as np
from scipy.optimize import minimize
from scipy.stats import rankdata
from backend import nowcast
from backend.profiles import CACHE, ROOT
from backend.terrain import roads

DEEP_CM = 15
GAP_DEG = 0.005  # ~480 m each side of the split line
TIMES = [datetime(2017, 8, 26, tzinfo=timezone.utc) + timedelta(hours=6 * i) for i in range(21)]
KEYS = ["bias", "rain_1h", "rain_3h", "rain_6h", "depression", "hand"]
BOUNDS = [(None, None), (0, None), (0, None), (0, None), (0, None), (None, 0)]  # physical signs
TERRAIN = ["bias", "depression", "hand"]
WET_MM_6H = 10  # a time is "wet" when the bbox-mean 6 h rain reaches this
NOTE = (
    "RESULT: no useful skill. On held-out geography the nowcast ranks deep-water streets about as well as chance "
    "(AUC 0.43 fit-west/test-east, 0.55 fit-east/test-west, survey+inferred labels; 0.52 / 0.68 survey-only) and does NOT beat "
    "the terrain-only baseline (it is the terrain percentile times a rain factor, so within one time step it ranks like terrain-only; "
    "differences are within +-0.01 AUC). Unfitted -HAND alone does better in one direction (0.66 / 0.68 fit-east/test-west) and worse "
    "in the other (0.40), so the terrain signal is not stable across the bbox. Precision of flagged edges is at or below the base rate. "
    "Rain cannot be fitted from these labels: fitting rain terms gives weights ~0, so rain enters as an unfitted intensity rule. "
    "LIMITATIONS: (1) timing: every label carries a USGS-estimated peak time of Sep 1-2 17Z, days after the Aug 26-29 rain, and much "
    "of that flooding was Addicks/Barker reservoir release along Buffalo Bayou, not local rain; so this measures spatial ranking only, "
    "never lead time. (2) labels: 218 of 2074 positive edges are survey-derived (USGS high-water marks minus 3DEP ground); the rest are "
    "terrain-v1 inferences spread from those marks, so they encode terrain and clustering near surveyed sites. (3) negatives are "
    "'no deep-water evidence', not dry: most of the city was never surveyed, so AUC largely measures 'near where USGS surveyed'. "
    "(4) rain is the IEMRE reanalysis on a ~0.125 deg (~12 km) grid: the 5x5 fetch grid holds ~4 distinct series, so rain barely "
    "varies across the bbox and cannot rank streets. (5) HAND references OSM river|canal lines; that choice (over all waterways "
    "incl. drains) was made looking at all labels, so it is not held out. (6) bare-earth DEM depressions include road "
    "embankments over culverts. Treat /risk as an experimental susceptibility layer during heavy rain, never as evidence."
)


def labels(M, R, kinds):
    pos = set()
    for f in ("survey_observations.json", "inferred_observations.json"):
        for o in json.loads((CACHE / f).read_text()):
            if o.get("kind") in kinds and (o.get("depth_cm") or 0) > DEEP_CM and o["edge_id"] in R.edges:
                pos.update(R.twin_ids(o["edge_id"]))
    return np.array([i in pos for i in M.ids])


def design(M, rains, idx):
    """Rows = (time, edge) for edges idx; columns in KEYS order (bias column = 1)."""
    return np.vstack([np.column_stack([np.ones(len(idx)), np.log1p(r[idx]), M.x_dep[idx], M.x_hand[idx]]) for r in rains])


def fit(X, y, keys):
    on = np.array([k in keys for k in KEYS])
    Xo = X[:, on]

    def nll(w):
        z = Xo @ w
        reg = np.r_[0, w[1:]]
        return (np.logaddexp(0, z) - y * z).mean() + 1e-4 * (reg ** 2).sum(), Xo.T @ (1 / (1 + np.exp(-z)) - y) / len(y) + 2e-4 * reg

    res = minimize(nll, np.zeros(on.sum()), jac=True, method="L-BFGS-B", bounds=[b for b, o in zip(BOUNDS, on) if o])
    w = dict.fromkeys(KEYS, 0.0)
    w.update({k: round(float(v), 4) for k, v in zip(np.array(KEYS)[on], res.x)})
    return w


def auc(s, y):
    r = rankdata(s)
    n1, n0 = y.sum(), (~y).sum()
    return float((r[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def prec_at(s, y, k):
    return float(y[np.argsort(-s, kind="stable")[:k]].mean())


def metrics(scores, y):
    """scores: one per-edge score array per time, for the test edges."""
    a = [auc(s, y) for s in scores]
    return {"auc_mean": round(float(np.mean(a)), 3), "auc_min": round(min(a), 3), "auc_max": round(max(a), 3),
            "p_at_100": round(float(np.mean([prec_at(s, y, 100) for s in scores])), 3),
            "p_at_500": round(float(np.mean([prec_at(s, y, 500) for s in scores])), 3)}


def split_test(M, rains, y, lon, valid, wet):
    mid = float(np.median(lon[valid]))
    west, east = np.flatnonzero(valid & (lon < mid - GAP_DEG)), np.flatnonzero(valid & (lon > mid + GAP_DEG))
    out = {"split_lon": round(mid, 4)}
    wet_rains = [r for r, w in zip(rains, wet) if w]
    for name, tr, te in (("fit_west_test_east", west, east), ("fit_east_test_west", east, west)):
        Xtr, ytr = design(M, rains, tr), np.tile(y[tr], len(rains)).astype(float)
        yte = y[te]
        res = {"n_train": len(tr), "n_test": len(te), "test_base_rate": round(float(yte.mean()), 4)}
        res["logistic_with_rain_terms_weights"] = fit(Xtr, ytr, KEYS)  # diagnostic: can rain be fitted from these labels?
        wt = {k: v for k, v in fit(Xtr, ytr, TERRAIN).items() if k in TERRAIN}
        M.set_weights(wt)  # percentile over all valid edges: unsupervised, uses no test labels
        res["model"] = {"terrain_weights": wt, "all_times": metrics([M.score(r)[te] for r in rains], yte),
                        "wet_times": metrics([M.score(r)[te] for r in wet_rains], yte)}
        res["terrain_only"] = metrics([M.terrain[te]], yte)
        res["rain_only_6h"] = {"all_times": metrics([r[te, 2] for r in rains], yte), "wet_times": metrics([r[te, 2] for r in wet_rains], yte)}
        res["hand_unfitted"] = metrics([-M.x_hand[te]], yte)
        res["depression_unfitted"] = metrics([M.x_dep[te]], yte)
        flagged, per_t = np.zeros(len(te), bool), []
        for r in rains:
            f = M.score(r)[te] >= nowcast.ELEVATED
            flagged |= f
            if f.any():
                per_t.append(float(yte[f].mean()))
        res["shipped_bands"] = {"precision_when_flagged_mean": round(float(np.mean(per_t)), 4) if per_t else None,
                                "times_with_flags": len(per_t), "labelled_edges_ever_flagged": round(float(flagged[yte].mean()), 3),
                                "unlabelled_edges_ever_flagged": round(float(flagged[~yte].mean()), 3)}
        out[name] = res
    return out


def main():
    M, R = nowcast.inputs(), roads()
    rains = [M.rain(M.hours_before(t)) for t in TIMES]
    wet = [float(r[M.valid, 2].mean()) >= WET_MM_6H for r in rains]
    lon = np.load(CACHE / "nowcast_static.npz")["lon"].astype(float)
    valid = M.valid
    y_all, y_obs = labels(M, R, {"survey", "inferred"}), labels(M, R, {"survey"})
    res = {"method": "risk = percentile(fitted terrain logistic: log1p(depression_cm), hand_m) * clip(max(rain_1h/25, rain_3h/50, rain_6h/75 mm), 0, 1)",
           "deep_cm": DEEP_CM, "times": [TIMES[0].isoformat(), TIMES[-1].isoformat(), "every 6 h"],
           "wet_times": [t.isoformat() for t, w in zip(TIMES, wet) if w], "edges_valid": int(valid.sum()),
           "positives_survey_or_inferred": int(y_all[valid].sum()), "positives_survey_only": int(y_obs[valid].sum()),
           "metrics": "AUC and precision@k over held-out edges, averaged over the listed times; base rate = precision of a random pick",
           "labels_survey_or_inferred": split_test(M, rains, y_all, lon, valid, wet),
           "labels_survey_only": split_test(M, rains, y_obs, lon, valid, wet)}
    v = np.flatnonzero(valid)
    prod = {k: x for k, x in fit(design(M, rains, v), np.tile(y_all[v], len(rains)).astype(float), TERRAIN).items() if k in TERRAIN}
    M.set_weights(prod)
    counts = {}
    for t in TIMES:
        out = nowcast.risk_at(t)
        counts[t.strftime("%m-%dT%HZ")] = [int((out[2] == "elevated").sum()), int((out[2] == "high").sum())]
    res["production"] = {"terrain_weights": prod, "in_backend": nowcast.W, "fit_on": "all valid edges, survey+inferred labels",
                         "elevated": nowcast.ELEVATED, "high": nowcast.HIGH, "rain_ref_mm": nowcast.RAIN_REF_MM,
                         "flagged_edges_by_time_[elevated, high]": counts}
    res["note"] = NOTE
    (ROOT / "eval/results/nowcast.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({k: res[k] for k in ("positives_survey_or_inferred", "positives_survey_only", "wet_times", "production")}))
    for lab in ("labels_survey_or_inferred", "labels_survey_only"):
        for sp in ("fit_west_test_east", "fit_east_test_west"):
            r = res[lab][sp]
            print(lab, sp, "base", r["test_base_rate"], "model wet", r["model"]["wet_times"], "terrain", r["terrain_only"],
                  "rain wet", r["rain_only_6h"]["wet_times"], "hand", r["hand_unfitted"], "dep", r["depression_unfitted"],
                  r["shipped_bands"], r["logistic_with_rain_terms_weights"])


if __name__ == "__main__":
    main()
