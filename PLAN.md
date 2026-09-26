# Waze for Floods: Build Plan

**Deadline: Oct 30, 2026, 10:00 AM PT (1:00 PM ET). Internal target: submit Oct 29.**
This is built in parallel with ../Amazon (Your Own Commentator, due Oct 23). Amazon gets
priority until Oct 22. Here the first 3 weeks are background spikes and data work, and
Oct 23-29 is the full-time build.

## 1. What the demo must prove (work backwards from the video)
A real (historical, public-domain) flood event replays on a map. Photos and videos land and
each one turns into a depth estimate, with the reference object it measured against shown
right in the frame. Streets turn orange, then red. A driver asks "can I get to Mass General in
my Civic?" and the route bends around every street deeper than 6 inches, explaining why.
One slide of numbers says it never called a dangerous street safe on the evaluation set.

## 2. Decisions to make first (by Sep 30)
| Decision | Recommendation | Why |
|---|---|---|
| Replay event and city | **Decided: Houston / Harvey 2017** (bbox in backend/profiles.py). STN has ~1,000 HWM photos with depth per candidate event, and 187 archived NWS flood-warning polygons (IEM) for Harvey | Urban street flooding is the story; Houston has the data |
| Frontend | Next.js + **MapLibre GL** on Vercel | You know Next.js; MapLibre is free, no token needed |
| Backend | Python FastAPI + shapely STRtree snapping + SQLite (uploads only) | Changed 2026-09-26: Supabase free tier pauses after 7 idle days, which would kill the demo before judging; city-scale snapping doesn't need PostGIS |
| Road graph | **OSMnx** (OpenStreetMap) for the demo city, cached | Free; networkx routing is plenty at city scale |
| Vision model | **Cosmos Reason 2** (8B) on **Nebius AI Cloud**, Containers over VM (vLLM or NIM) | Required NVIDIA model; built for physical-world reasoning |
| Agent model | **Nemotron** via **Token Factory** (OpenAI-compatible) | Qualifies for the Best Apps and Agents track; Token Factory is the "runs on Nebius" proof |
| Bonus | **Tavily** for live NWS flood warnings and local reports | $3K bonus, and a real signal, not decoration |

## 3. Architecture
```
 sources: phone upload (PWA, geotag from EXIF or browser) | public traffic cams (where terms allow)
          | opted-in doorbell clips | historical replay feed (public-domain imagery, timestamped)
          v
  [1] Ingest API (FastAPI)  -- store the media, sample video frames (1 fps, max 8), keep geo and time
          v
  [2] Depth estimator       -- Cosmos Reason 2 on Nebius AI Cloud. Prompt returns STRICT JSON:
          |                    {reference_objects:[{name, typical_height_cm, water_line_fraction}],
          |                     depth_cm, low_cm, high_cm, confidence, rationale}
          |                    Video: median across frames; disagreement lowers confidence
          |                    Known heights table: curb 15, tire 65 (dia), car door sill 30,
          |                    hubcap center 33, fire hydrant 75, stop-sign post, adult knee 50
          v
  [3] Fusion               -- snap to the nearest road segment within 30 m (both directions); state =
          |                    max high_cm over observations whose weight conf*0.5^(age/45min) >= 0.1;
          |                    when all decay: "stale" (last-known shown, routed as unknown), never "dry";
          |                    photo with unreadable depth: "reported_unknown" (blocks every vehicle)
          v
  [4] Router (networkx)     -- vehicle profiles: sedan 15 cm, SUV 30 cm, truck 45 cm (conservative,
          |                    cite NWS/FEMA); block an edge if high_cm > limit; penalize unknown
          |                    edges inside an active NWS warning polygon (from Tavily/NWS)
          v
  [5] Agent (Nemotron)      -- tools: route(from,to,vehicle), segment_status(area),
          |                    active_alerts(area); answers in plain language and cites the evidence
          |                    (photo, depth, time) for every blocked street
          v
  [6] Web app               -- live depth layer (gray/yellow/orange/red), evidence popovers
                               (frame + reference object + depth range + time), route panel
                               with a vehicle picker, chat box, upload page, "replay event" timeline
                               scrubber, saved routes with alerts (stretch)
```

## 4. Evaluation (your signature: make it the headline)
Build `eval/` from week 1:
- **Ground truth (revised 2026-09-26):** STN HWM photos are post-event shots of surveyors holding
  tape measures in dry brush: no standing water, and the answer is visible in the frame, so they are
  NOT a valid headline eval (eval/stn_candidates.csv keeps them as a secondary sanity set only).
  FloodVision's MyCoast data has no stated license; the Twitter flood set has only binary labels and
  can't be redistributed; V-FloodNet is all-rights-reserved. Headline set = public-domain/CC-BY
  during-event photos, human-labeled with depth bands from reference objects, frozen 60/40 dev/test.
  Target 100+ labeled images.
- **Metrics:**
  - **Dangerous-road miss rate:** the share of images with true depth > 15 cm that the system
    marks passable for a sedan. **Target: 0.** It's the metric that matters, because the cost
    of a miss is asymmetric.
  - MAE in cm (compare with FloodVision's 8.75 cm, and be honest if yours is worse)
  - Calibration: does the low/high interval contain the true depth? (coverage %)
  - Accuracy broken down by reference object type
- Report it in the README, in the app's "About" page, and in one slide of the video.
- If a prompt change improves MAE but raises the miss rate, **reject it.**

## 5. Cost and uptime plan (judging runs Dec 1-15)
- The GPU VM bills while running. Run batch inference for the replay event and eval once,
  **cache everything**, then stop the VM.
- The hosted demo runs on cached results for the replay (it always works, with instant load).
- The live upload path wakes the endpoint; show "processing, about 1-2 min on cold start."
  Decide by Oct 25 whether to keep a small GPU up during judging (check Nebius pricing and
  credits) or to accept cold starts.
- Nemotron on Token Factory is pay-per-token and cheap at demo scale.

## 6. Schedule
| Dates | NVIDIA | (Amazon priority) |
|---|---|---|
| **Sep 27-Oct 3** | **Spike:** follow the Cosmos cookbook to deploy Reason 2 on Nebius; run the depth prompt on 20 public-domain images. Pick the replay event. Get a Tavily API key. | Vega + Alexa+ spikes |
| **Oct 4-10** | Collect and label the eval set (100+); eval harness v1; iterate the prompt against the miss rate | Amazon core |
| **Oct 11-17** | PostGIS schema, fusion, OSMnx graph, GeoJSON endpoint; basic MapLibre depth layer | Amazon polish |
| **Oct 18-22** | Light touch only (batch-run the replay imagery while the Amazon video renders) | Amazon freeze, video, submit |
| **Oct 23-25** | Router + vehicle profiles; Nemotron agent with tools; Tavily alerts; evidence popovers | none |
| **Oct 26-27** | Replay timeline scrubber, upload page, About/eval page, deploy (Vercel + backend host), LICENSE + README | none |
| **Oct 28** | Record the video (under 3 min); write the description; fresh-browser test of the hosted URL | none |
| **Oct 29** | **Submit** (a day of buffer before the Oct 30 10am PT deadline) | none |

## 7. Demo video script (under 3:00, target 2:45)
- 0:00-0:15. Hook: "More than half of flood deaths happen in cars. Nobody knows how deep the
  street is." Public-domain footage of a flooded road.
- 0:15-0:50. The replay event starts; photos land; each becomes a depth estimate with the
  reference object highlighted ("waterline at 60% of the tire, about 40 cm").
- 0:50-1:30. The map fills in live. Pick "sedan," ask the agent for a route; it bends around the red
  streets and explains each block with evidence.
- 1:30-1:50. Switch to "pickup truck" and the route changes. The same map works for different vehicles.
- 1:50-2:15. Under the hood: Cosmos Reason 2 on Nebius AI Cloud, Nemotron on Token Factory,
  Tavily NWS alerts.
- 2:15-2:35. The eval slide: dangerous-road miss rate, MAE, interval coverage.
- 2:35-2:45. Impact: every phone, traffic cam and doorbell becomes a flood sensor. There's no new
  hardware.
Only public-domain or CC-BY footage, with credits in the description. No copyrighted music.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Cosmos Reason 2 depth is poor | The eval set tells us by Oct 10; improve the prompt (explicit reference-height table, waterline fraction); ensemble across frames; worst case, lean on conservative intervals (a wide interval blocks the road, which is the safe side) |
| Not enough geotagged ground truth | USGS high-water marks are geotagged by design; pick the replay event by data availability |
| GPU cost or uptime | Cache the replay; cold-start banner for live uploads |
| Scope (two hackathons) | MVP = replay + depth estimates + map + sedan routing + agent. Doorbell ingest, push alerts, faces/plates blur and live cams are stretch |
| Privacy of crowdsourced media | Opt-in only; store only frames plus derived depth; blur as a stretch; state it in the README |
| Liability optics ("an app told me the road was safe") | Never output "safe", only "no deep water reported"; unknown is gray; cite NWS "Turn Around, Don't Drown" in the UI |
