"""Conformal calibration of the USGS survey layer's upper-bound allowance, per event.

  python -m scripts.calibrate_survey harvey2017 [--alpha 0.05]

For every street-level mark with a surveyed height above ground, the residual r = true depth - estimated depth
(positive = the method read too shallow, the dangerous direction). Split-conformal: the allowance
q = the ceil((n+1)(1-alpha))-th smallest residual gives P(true <= est + q) >= 1 - alpha for a new mark from the same
distribution, with no distributional assumption. Compare q with the fixed allowance the layer ships
(QUALITY_FT + DEM_FT + SLOPE_FT). Writes eval/results/survey_calibration_<id>.json. One-sided on purpose: only
under-reading can send a car into water.
"""
import json, math, re, sys, time
from backend import events
from scripts import survey_layer as S

BELOW_GRADE = re.compile(r"basement|ramp|stair|below grade|inside|cellar|sub-?level|areaway", re.I)


def conformal_q(residuals, alpha):
    """Split-conformal upper quantile; inf when n is too small for the requested coverage."""
    r = sorted(residuals)
    k = math.ceil((len(r) + 1) * (1 - alpha))
    return r[k - 1] if k <= len(r) else math.inf


def main(eid, alpha):
    E = events.registry(include_incomplete=True)[eid]
    hs = [h for h in S.hwms(E) if (h.get("height_above_gnd") or 0) > 0 and h.get("elev_ft") and h.get("vdatum_id") == S.NAVD88
          and (h.get("hwm_quality_id") or 9) <= S.MAX_QUALITY and not BELOW_GRADE.search(h.get("hwm_locationdescription") or "")]
    res, shipped = [], []
    for h in hs:
        try:
            g = float(S.chip(h["latitude_dd"], h["longitude_dd"])(h["longitude_dd"], h["latitude_dd"]))
        except Exception:
            continue
        res.append((h["height_above_gnd"] - (h["elev_ft"] - g)) * S.FT)
        shipped.append((S.QUALITY_FT[h["hwm_quality_id"]] + S.DEM_FT + S.SLOPE_FT) * S.FT)
        time.sleep(0.3)
    q = conformal_q(res, alpha)
    out = {"event": eid, "alpha": alpha, "n": len(res), "conformal_allowance_cm": None if math.isinf(q) else round(q, 1),
           "shipped_allowance_cm_median": round(sorted(shipped)[len(shipped) // 2], 1) if shipped else None,
           "shipped_covers": sum(r <= a for r, a in zip(res, shipped)), "note":
           "Residual = true - estimated depth at street-level marks (basement/ramp seed lines excluded). If the conformal "
           "allowance exceeds the shipped one, the shipped band under-covers at this confidence."}
    p = S.events.CACHE.parent.parent / "eval/results" / f"survey_calibration_{eid}.json"
    p.write_text(json.dumps(out, indent=1))
    print(json.dumps(out))


def _selftest():
    assert conformal_q([1, 2, 3, 4], 0.2) == 4 and math.isinf(conformal_q([1, 2], 0.05)) and conformal_q(list(range(1, 20)), 0.1) == 18


if __name__ == "__main__":
    _selftest()
    argv = sys.argv[1:]
    alpha = float(argv.pop(argv.index("--alpha") + 1)) if "--alpha" in argv else 0.05
    a = [x for x in argv if not x.startswith("--")]
    for eid in a or ["harvey2017"]:
        main(eid, alpha)
