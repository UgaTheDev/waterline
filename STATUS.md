# STATUS

<!-- Worker-owned. Update at every checkpoint, blocker, or decision. The orchestrator reads this file; keep the headings exactly. -->

**Updated:** 2026-09-27 16:50  ·  **Stage:** building  ·  **Health:** 🟡 at risk

## Needs Kush
- **Token Factory key** (blocks the live depth model, the agent and latency/cost numbers): join https://dev.nebius.com/builders, create a key, add `TF_KEY=...` to `.env` in this repo (never paste it in chat).
- **Tavily key** (blocks local_reports and the $3K bonus): claim it via the Builder Program, then add `TAVILY_KEY=...` to `.env`.
- **Label the eval set (~45 min)** (blocks the headline miss-rate number): run `python3 eval/label.py`, open http://localhost:8766, and press 1-5 per photo.
- **Nebius AI Cloud + $25 deposit** (blocks backend hosting on a CPU VM, the Cosmos Reason 2 benchmark and the Cosmos Transfer spike): create the account and deposit, then tell this session so it can set up the VMs with you watching.
- **Hugging Face read token** (needed for the Cosmos weights on the GPU VM): create it at https://huggingface.co/settings/tokens and add `HF_TOKEN=...` to `.env`.
- **Film a 5-15 s dry street clip** (daylight, steady, cars and curb in frame, no readable plates or close faces, not your own building) (blocks the Cosmos Transfer "see your street flooded" spike; no clean PD/CC-BY clip exists): phone held steady at eye level on an ordinary street, no faces or plates up close, then drop it in `data/raw/recon/street.mp4`.
- **Oct 28: make the repo public** (Nebius requires public + license): `gh repo edit UgaTheDev/waterline --visibility public --accept-visibility-change-consequences`

## Done since last update
- v1 live on Vercel (sample data until the backend is hosted); USGS survey layer (366 road obs, validated); Openverse eval pool (216 photos).
- Voice reports, dashcam endpoint, session-sandboxed replay reports (backend, tested).
- Depth default switched to Nemotron Nano 2 VL on Token Factory; Cosmos Reason 2 kept as a benchmark.
- v2 plan approved; v2 contracts frozen (backend/API.md) with stub routers for risk, responder and simulations.
- Stream C merged: voice chat (push-to-talk, spoken replies) + /drive dashcam HUD, live on Vercel (sample mode).
- Stream A merged: 5 m DEM + terrain inference (4,248 inferred obs on 2,153 streets). Leave-one-out: errors lean high (median +15 cm), 0 reached marks under-called for a sedan, but coverage 30-60%, so inferred depths are display-only (hatched), never used for routing.
- Stream R done: Harvey hourly rain via IEM point API (works); PD Texas National Guard clip (610 at Braeswood) added as the Drive-mode demo footage; Houston 311 on hold: no license is stated for the hfdapp-hosted 311 extracts (the "All rights reserved" is only the site footer, and the data.houstontx.gov open terms cover portal-hosted data). Kush is emailing the City to confirm; a dedicated Harvey 311 file exists. The data contains PII (addresses, TaxID, names in descriptions): if used, keep only street segment + derived depth + time. Decision (Kush): ship without it; add it only if written permission from the City arrives by about Oct 20. The parser is ready (backend/ingest311.py).
- Stream E merged: depth-model danger flags, token-guarded responder queue/review/media, 311 text parser (12 tests pass).

## In progress (streams)
| Stream | Owner/worktree | State | Next |
|---|---|---|---|
| C voice + dashcam UI | web-voice | ✅ merged 66c79af | real mic/camera test on a phone |
| R recon | stream-r-recon (sonnet) | ✅ done | — |
| A terrain inference | worktree (opus) | ✅ merged 1e0cced (display-only) | seed from photo reports once the replay batch runs |
| E responder + 311 ingest | worktree (sonnet) | ✅ merged 458dbae | wire real 311 data once R confirms |
| B nowcast | worktree stream-b-nowcast (opus) | running | rain fetch, terrain features, honest spatial eval |
| D Cosmos Transfer spike | after R + Nebius deposit | queued | — |
| F eval | Kush labels + keys | blocked | see Needs Kush |
| G web integration | worktree stream-g-web (opus) | running | inferred hatching, risk layer, /responder, simulations |

## Blockers (not Kush)
- none

## Next checkpoint
- 2026-09-29: streams A, E and R merged to main; the voice/dashcam UI is live on Vercel (sample mode).
