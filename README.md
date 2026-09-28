# Waterline

Know how deep the street is before you drive into it. A street-level flood depth map with routing that
respects your vehicle. Built for the Nebius x NVIDIA Global AI Hackathon.

More than half of US flood deaths happen in vehicles. People drive into water because nothing tells
them how deep it is on that street right now. River gauges don't cover streets. Photos do: every
phone, traffic camera and doorbell is already a flood sensor.

**This tool never tells you a road is safe.** It reports "no deep water reported", treats unreported
streets as unknown (not dry), and routes on the conservative upper bound of every depth estimate.
If water covers the road: Turn Around, Don't Drown.

## How it works
```
photo / video ─▶ NVIDIA VLM (Token Factory / Cosmos) ─▶ depth + interval + reference object
                                                    │
     snap to road (OSM, 30 m) ◀─────────────────────┘
          │
   fusion: decaying evidence per street ─▶ live depth layer (unknown ≠ dry)
          │
   router: blocks streets deeper than your vehicle's limit (sedan 15 cm, SUV 30, truck 45)
          │
   Nemotron agent (Nebius Token Factory) ─▶ "Can I get to the Medical Center in my Civic?"
          + NWS flood warnings (live, or archived via IEM) + Tavily local reports
```

| Piece | What it does |
|---|---|
| **Nemotron Nano 2 VL** on **Nebius Token Factory** (default) and **Cosmos Reason 2 8B** self-hosted with vLLM on **Nebius AI Cloud** (benchmarked on the same eval; we ship the one with the lower dangerous-road miss rate) | Reads the waterline against objects with known heights (curb 15 cm, tire 65 cm, door sill 30 cm, ...) and returns strict JSON: depth, low/high bound, confidence, reference object, rationale. Unreadable output becomes "reported, depth unknown", never 0 cm. |
| **Nemotron** on **Nebius Token Factory** | Tool-using agent: `route`, `segment_status`, `active_alerts`, `local_reports`. Road status always comes from the router, not the language model; a wording guard falls back to a deterministic answer. |
| **Tavily** | Local news and road-closure reports, cited as unverified context. |
| NWS / Iowa Environmental Mesonet | Live flood warning polygons, and the 187 archived Harvey polygons used in the replay. Unreported streets inside a warning cost 10x in routing. |
| OpenStreetMap (OSMnx) + networkx + shapely | Road graph, snapping, routing. |
| USGS survey layer | Estimated peak depth on roads near surveyed high-water marks: water-surface elevation minus USGS 3DEP 1 m ground elevation, bridges excluded, roads above the water skipped (never marked dry). Checked against 26 marks with a measured height: median error +11 cm (it errs deep). Shown as a separate source from photo reports. |

The hosted demo replays Hurricane Harvey in Houston (Aug 26 - Sep 3, 2017; Buffalo Bayou peaked late because of the reservoir releases). All replay inference is run once and
cached, so the demo works with the GPU switched off. Live uploads queue until the model is online.

## Features
| | |
|---|---|
| **Depth map + vehicle routing** | Per-street fusion with decay (stale, never dry); sedan 15 / SUV 30 / pickup 45 cm limits on the upper bound |
| **Voice agent** | Push-to-talk questions and spoken answers (browser speech engine) backed by the Nemotron agent; spoken eyewitness reports ("knee-deep at Main and 5th") become low-confidence reports |
| **Drive mode** (`/drive`) | A mounted phone checks a frame every 4 s, files a report when water is ahead, speaks the depth against your limit, and reroutes. Frames are never stored |
| **Terrain inference** | USGS high-water marks spread over connected low ground (5 m 3DEP). Hatched, labeled "inferred", **display-only**: never used for routing |
| **Responder mode** (`/responder`, token) | Model flags for people in the water or occupied vehicles, human review queue, high-water rescue-truck routing |
| **Replay sandbox** | Reports filed while viewing the Harvey replay are visible only to your browser session, so nobody can alter the shared demo |
| **Flood-risk nowcast** | Built and evaluated, **switched off**: no better than terrain alone on held-out streets (`eval/results/nowcast.json`) |

## Evaluation
The headline metric is the **dangerous-road miss rate**: the share of images with true depth over 15 cm
that the system marks passable for a sedan. The target is 0, and a prompt change that improves MAE but
raises the miss rate is rejected. We also report the miss rate's Wilson 95% confidence interval (so "0
misses on 12 photos" doesn't read as more certain than it is), the abstain rate (so "refuse everything"
can't look good), the false-block rate, MAE, interval coverage and accuracy by reference object, plus a
per-event breakdown. Labels are split 60/40 into dev and test and frozen; prompts are tuned on dev only.

The eval pool spans multiple US flood events (Hurricane Harvey 2017, Hurricane Ida 2021, Hurricane Helene
2024, the July 2023 Vermont/northeastern floods), all public-domain or CC BY, deduplicated across events.
Photos are labeled independently by up to two annotators; where they disagree, the deeper (more
conservative) band is used for scoring, and we report Cohen's kappa plus raw agreement on the 15 cm
sedan-passable boundary between them.

Results: TODO(eval) -- pending labels from the second annotator (see `eval/results/test.json`, and the
About page in the app).

MAE is not directly comparable to prior work such as FloodVision (8.75 cm), because the images and labels differ.

## Run it
```bash
# backend
uv venv .venv && uv pip install --python .venv/bin/python -r backend/requirements.txt
cp .env.example .env   # fill in keys; the app runs without them (agent offline, uploads queue)
set -a; . ./.env; set +a
.venv/bin/python -m backend.test_core           # safety invariants
.venv/bin/uvicorn backend.app:app --port 8000

# frontend
cd web && npm install && npm run dev            # http://localhost:3000
```
The road graph (`data/cache/graph.graphml`) and Harvey warning polygons are committed. To rebuild them:
`python -m scripts.build_graph`, `python -m scripts.fetch_alerts` and `python -m scripts.survey_layer` (add `--validate` to rerun the accuracy check).

### When keys arrive
```bash
.venv/bin/python -m scripts.check_keys   # lists Token Factory models, one depth call, one agent call, Tavily, HF access
```

### Hosting the backend (Nebius CPU VM)
See [deploy/README.md](deploy/README.md): Docker image, VM setup script, HTTPS via Caddy, and a warm-up so the first judge
doesn't wait for the road graph to load.

### Deploying Cosmos Reason 2 on Nebius
Follow NVIDIA's cookbook: [Cosmos Reason 2 on Nebius](https://nvidia-cosmos.github.io/cosmos-cookbook/getting_started/nebius/reason2/reason2_on_nebius.html)
(Containers over VM, vLLM preset, `nvidia/Cosmos-Reason2-8B`, L40S or H100, port 8000). Set `COSMOS_URL` and `COSMOS_KEY`, then:
```bash
python -m scripts.batch_replay          # replay photos -> data/cache/replay_observations.json
python3 scripts/dedupe_pool.py          # once: collapse near-duplicate photos before labeling
python -m eval.run_eval --split dev     # iterate
python -m eval.run_eval --split test    # report; exits 1 on any missed dangerous road
```
Stop the VM afterwards; it bills while running.

## API
See [backend/API.md](backend/API.md).

## Privacy
Uploads are opt-in. EXIF (location, device) is stripped when an image is re-encoded, raw uploads are
never served, and uploaded images are not shown publicly. Only derived depth and the road segment are published.

## Prior art
Research shows this can work, but nobody has shipped it:
FloodVision ([arXiv 2509.04772](https://arxiv.org/pdf/2509.04772)),
surveillance cameras + LiDAR ([EMS 2025](https://www.sciencedirect.com/science/article/abs/pii/S1364815225002567)),
crowdsourced photos + gauges for routing ([AEI 2022](https://www.sciencedirect.com/science/article/abs/pii/S1474034622001884)),
FloodMask ([PMC8402382](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8402382/)).

## Data and credits
- USGS Short-Term Network high-water marks and photos: public domain (U.S. Government).
- NWS warnings via the Iowa Environmental Mesonet: public domain.
- Road network © OpenStreetMap contributors (ODbL). Geocoding by Nominatim.
- Replay photos: Wikimedia Commons, public domain or CC BY only, credited per image in
  `data/cache/replay_manifest.csv` and in each evidence popover.
- Safety thresholds: NWS "Turn Around, Don't Drown".

## License
Apache-2.0, see [LICENSE](LICENSE).
