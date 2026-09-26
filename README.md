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
photo / video ─▶ Cosmos Reason 2 (Nebius AI Cloud) ─▶ depth + interval + reference object
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
| **Cosmos Reason 2 8B** (NVIDIA open model), self-hosted with vLLM on **Nebius AI Cloud** | Reads the waterline against objects with known heights (curb 15 cm, tire 65 cm, door sill 30 cm, ...) and returns strict JSON: depth, low/high bound, confidence, reference object, rationale. Unreadable output becomes "reported, depth unknown", never 0 cm. |
| **Nemotron** on **Nebius Token Factory** | Tool-using agent: `route`, `segment_status`, `active_alerts`, `local_reports`. Road status always comes from the router, not the language model; a wording guard falls back to a deterministic answer. |
| **Tavily** | Local news and road-closure reports, cited as unverified context. |
| NWS / Iowa Environmental Mesonet | Live flood warning polygons, and the 187 archived Harvey polygons used in the replay. Unreported streets inside a warning cost 10x in routing. |
| OpenStreetMap (OSMnx) + networkx + shapely | Road graph, snapping, routing. |
| USGS survey layer | Estimated peak depth on roads near surveyed high-water marks: water-surface elevation minus USGS 3DEP 1 m ground elevation, bridges excluded, roads above the water skipped (never marked dry). Checked against 26 marks with a measured height: median error +11 cm (it errs deep). Shown as a separate source from photo reports. |

The hosted demo replays Hurricane Harvey in Houston (Aug 26 - Sep 3, 2017; Buffalo Bayou peaked late because of the reservoir releases). All replay inference is run once and
cached, so the demo works with the GPU switched off. Live uploads queue until the model is online.

## Evaluation
The headline metric is the **dangerous-road miss rate**: the share of images with true depth over 15 cm
that the system marks passable for a sedan. The target is 0, and a prompt change that improves MAE but
raises the miss rate is rejected. We also report the abstain rate (so "refuse everything" can't
look good), the false-block rate, MAE, interval coverage and accuracy by reference object. Labels are split 60/40
into dev and test and frozen; prompts are tuned on dev only.

Results: _pending_ (see `eval/results/test.json`, and the About page in the app).

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

### Deploying Cosmos Reason 2 on Nebius
Follow NVIDIA's cookbook: [Cosmos Reason 2 on Nebius](https://nvidia-cosmos.github.io/cosmos-cookbook/getting_started/nebius/reason2/reason2_on_nebius.html)
(Containers over VM, vLLM preset, `nvidia/Cosmos-Reason2-8B`, L40S or H100, port 8000). Set `COSMOS_URL` and `COSMOS_KEY`, then:
```bash
python -m scripts.batch_replay          # replay photos -> data/cache/replay_observations.json
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
