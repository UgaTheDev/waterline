# STATUS

<!-- Worker-owned. Update at every checkpoint, blocker, or decision. The orchestrator reads this file; keep the headings exactly. -->

**Updated:** 2026-10-20 18:30  ·  **Stage:** building  ·  **Health:** 🟡 at risk

## Needs Kush
- **Token Factory card rejected (2026-10-20; Nebius Billing ticket opened by Kush, waiting)** (blocks the live depth model, the agent, eval numbers, and the Nebius requirement itself): check the bank app for a blocked foreign (Nebius B.V., NL) authorization; open a Billing ticket at https://console.nebius.com/support; message organizers via Devpost "Email the hackathon manager" (draft in session). Stopgap for development only: a build.nvidia.com key as `TF_URL=https://integrate.api.nvidia.com/v1` + `TF_KEY=nvapi-...` in .env (eval results record the endpoint; the submission must cite Nebius runs).
- **Token Factory key: $50 free credit** (once the card works): (1) redeem the hackathon promo form https://nebius.com/promo-code?utm_promo_event_code=2026-devpost-global-ai-hack&utm_promo_code_type=Token_Factory&utm_promo_activation_code=NEBIUS-DEVPOST-GLOBAL26 with code `NEBIUS-DEVPOST-GLOBAL26` ($25); (2) join https://dev.nebius.com/builders and claim another $25; (3) create an API key and add `TF_KEY=...` to `.env` in this repo (never paste it in chat).
- **Eval agreement pass (~15 min, optional but raises credibility)**: Claude labelled the pool (106 labelled, 76 no-road skips; disclosed as annotator "claude"). Run `python3 eval/label.py`, handle `kush`, open http://localhost:8766/?mode=agreement and label ~30 photos: gives a human-vs-AI kappa; consensus takes the deeper band.
- **Nebius AI Cloud + $25 deposit** (no free AI Cloud credits for remote participants; only in-person Builders & Brews events get them) (blocks backend hosting on a CPU VM, the Cosmos Reason 2 benchmark and the Cosmos Transfer spike): create the account and deposit, then tell this session so it can set up the VMs with you watching.
- **Hugging Face read token** (done: it's in .env) (needed for the Cosmos weights on the GPU VM): create it at https://huggingface.co/settings/tokens and add `HF_TOKEN=...` to `.env`.
- **Film a 5-15 s dry street clip** (daylight, steady, cars and curb in frame, no readable plates or close faces, not your own building) (blocks the Cosmos Transfer "see your street flooded" spike; no clean PD/CC-BY clip exists): phone held steady at eye level on an ordinary street, no faces or plates up close, then drop it in `data/raw/recon/street.mp4`.
- **Native Spanish check (5 min):** read the 7 Spanish safety lines ("No se reporta agua profunda", "Sin reportes no significa seco", "¡Dé la vuelta, no se ahogue!"...) on the site with EN/ES set to ES, or ask a Spanish-speaking friend. Tell this session if any line reads wrong.
- **Houston 311**: written-permission deadline was ~Oct 20; without it, 311 stays dropped (parser kept, unused).
- **Oct 28: make the repo public** (Nebius requires public + license): `gh repo edit UgaTheDev/waterline --visibility public --accept-visibility-change-consequences`

## Done since last update
- 2026-10-20: build.nvidia.com key works (dev stand-in): agent on nemotron-3.5-lightning-30b-a3b, depth on nemotron-3.5-super-vl-120b-a12b (needed DEPTH_MAX_TOKENS: reasoning ate 1,200). Tavily key OK. Cosmos Reason2 + Transfer2.5 licenses granted (HF user KushZ). First 3 real Harvey replay readings (40/38/12 cm), tagged model+endpoint. Test-split eval running (free tier 500s at 8 workers; retrying at 2).
- 2026-10-20: Kerrville 2025 (TX Hill Country) event: graph from Geofabrik PBF, 904 survey obs on 409 streets, 2,535 inferred on 886; survey gate FAILS (1/36 sedan miss; conformal 95% allowance 232 cm vs 37.5 shipped) -> display-only. Bbox excludes Camp Mystic; Decision (Kush, 2026-10-20): out of the video; mentioned only as text on the eval slide (docs/VIDEO.md).
- 2026-10-20: USGS moved the STN API (stn.wim.usgs.gov -> api.waterdata.usgs.gov/stnservices, new fields); ported, verified by reproducing Harvey calibration byte-for-byte and Ida validation exactly. Validation JSON is now produced by `python -m scripts.survey_layer <id> --validate` (was a one-off).
- 2026-10-20: DEM cache bug fixed: int16 cm overflowed above 327 m (Kerrville wrapped negative -> 0 inferred); now int32. Harvey/Ida unaffected (< 327 m).
- 2026-10-20: eval labels by Claude subagents (disclosed); responder Seen/Dismiss 401 returns to token form; eval results record the inference endpoint; offline snapshots for all 3 events (13 MB each).
- 2026-10-19: accessibility 41 -> 0 axe WCAG 2.2 AA violations (20 combos); /segments cache p95 25.5 s -> 4.6 s at 50 clients; PWA + offline snapshot fallback; Ida 2021 NYC built (survey display-only, 5/63 misses).
- v1 live on Vercel (sample data until the backend is hosted); USGS survey layer (366 road obs, validated); Openverse eval pool (216 photos).
- Voice reports, dashcam endpoint, session-sandboxed replay reports (backend, tested).
- Depth default switched to Nemotron Nano 2 VL on Token Factory; Cosmos Reason 2 kept as a benchmark.
- v2 plan approved; v2 contracts frozen (backend/API.md) with stub routers for risk, responder and simulations.
- Stream C merged: voice chat (push-to-talk, spoken replies) + /drive dashcam HUD, live on Vercel (sample mode).
- Spanish UI + voice (es-US) + agent answers + Spanish 'safe'-claim guard; checked at 390 px.
- Survey method validated in a second city: Ida NYC fails (5/63 street-level sedan misses), so each event's survey layer must earn routing (Harvey 0/25 passes). Conformal 95% band: Harvey needs 69 cm vs 28 cm shipped, so the upper bound now uses the conformal allowance (only more cautious).
- Scale-up: multi-event architecture merged (event registry, per-event data, /events, web switcher, add_event.py); Harvey unchanged as default. Eval pool 182 photos across Harvey/Ida/Helene/Vermont (19 of 103 harvested kept after visual review), second-annotator mode, Wilson CIs, kappa. Both agents stalled; lead finished and verified their work.
- Security review: 12 findings fixed (event-loop blocking, decompression bomb, unknown-depth wiped by a dry photo, chat/tool cost caps, upload retry storm, 'safe' guard bypasses, naive-time 500s, proxy IP trust, memory bounds, responder 500s); test_security_regressions covers them.
- Hardening batch: site-wide hourly spend caps (dashcam/chat/upload); gzip (map payload 4.4 MB -> 166 KB); scripts/check_keys.py; eval pool deduped 212 -> 163 (group-aware split); Docker + Nebius VM deploy package (built and run locally, healthy); real-backend integration test (opening view fixed to the data, legend collapsed); docs/SUBMISSION.md + docs/VIDEO.md drafts; README refreshed.
- Stream B merged but switched OFF (NOWCAST_ENABLED=0): on held-out streets AUC 0.43-0.68, no better than terrain-only; rain data is ~12 km and labels are Sep 1-2 reservoir-release peaks. About page says so plainly.
- Stream G merged + live on Vercel: hatched inferred streets, 'Flood risk next hour' layer, /responder (token-guarded, rescue routing), Cosmos simulation gallery, About sections.
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
| B nowcast | stream-b-nowcast (opus) | ⏸ merged, disabled (no skill) | revisit only with finer rain (MRMS 1 km grib) + a flood-timed label |
| D Cosmos Transfer spike | after R + Nebius deposit | queued | — |
| F eval | Kush labels + keys | blocked | see Needs Kush |
| G web integration | stream-g-web (opus) | ✅ merged 0dcc181 | — |
| Security review | security-review (opus, read-only) | ✅ 12 findings fixed + regression-tested | — |
| Scale #3: multi-event + Ida 2021 NYC | stream-events (opus; finished by lead) | ✅ merged bbab386 (Ida data pending) | `python -m scripts.add_event ida2021` once Overpass accepts queries |
| Scale #2: bigger eval | stream-eval-scale (sonnet; finished by lead) | ✅ merged 105d322 | pool 182 photos, 4 events; needs labels |

## Blockers (not Kush)
- Overpass (OSM) refused every road-graph query for Ida on 2026-09-28 (one of its two servers refuses all connections, the other is overloaded). Retry later; knobs OVERPASS_IP / OVERPASS_PAUSE_S in scripts/build_graph.py. Fallback: a Geofabrik extract + pyosmium (a package install, needs Kush's OK).
- Ida/Helene/VT have almost no USGS peak-time summaries (Ida 5, VT 0, Helene 0): Ida peak times will be estimated from the nearest stream gauge or the rainfall peak, and labeled as estimated.

## Next checkpoint
- 2026-09-29: streams A, E and R merged to main; the voice/dashcam UI is live on Vercel (sample mode).
