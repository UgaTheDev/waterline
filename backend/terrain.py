"""Stream A (terrain inference). CONTRACT, frozen 2026-09-27: do not change the signature.

infer(obs) -> list of inferred observations derived from one observed report:
  water surface = road ground elevation (3DEP) + obs depth; flood connected lower terrain; for each road edge reached,
  depth = surface - edge ground. Each returned dict is a normal observation with kind="inferred",
  provenance={"method": "terrain-v1", "derived_from": [obs["obs_id"]]}, the source's time/half_life_min/session_id,
  lower confidence than the source, and bounds that widen with distance. Rules: additive only (never depth 0, never
  "dry"), never for kind in {"inferred", "survey"} sources unless the stream owner decides otherwise, bridges excluded.
Replay inferences are precomputed into data/cache/inferred_observations.json (loaded by store.Store).
"""


def infer(obs):
    return []  # stub until stream A lands
