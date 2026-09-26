# Waze for Floods (Nebius x NVIDIA Global AI Hackathon)

Read **CONTEXT.md** (rules, judging, required tech, idea, prior art, data rights) and
**PLAN.md** (architecture, evaluation, schedule, video script, risks) before doing anything
here.

Hard constraints:
- Deadline **Oct 30, 2026 10:00 AM PT**; internal submit target Oct 29. ../Amazon has
  priority until Oct 22, so before then work here is spikes, data and eval.
- Must run on **Nebius** (Token Factory and/or AI Cloud) and use an **NVIDIA open model**:
  Cosmos Reason 2 for depth (self-deployed on Nebius AI Cloud), Nemotron on Token Factory
  for the agent.
- The **hosted demo must keep working through judging (Dec 1-15)**: cache inference results,
  and don't leave a GPU VM running idle.
- Safety posture: never label a road "safe", only "no deep water reported". Unknown is not
  dry. Route on the conservative upper bound (high_cm). The dangerous-road miss rate is the
  headline metric: never trade it for a better MAE.
- Only public-domain (USGS/NOAA/NWS/FEMA) or CC-BY media, credited. Check the license of any
  research dataset before using it.
- Repo is public with an Apache-2.0 LICENSE (required). Never commit secrets.
