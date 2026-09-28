# Devpost submission draft (Waterline)

Status: DRAFT. Every `TODO(eval)` must be replaced with a measured number, or the sentence deleted, before submitting.
Nothing here may claim more than the code and `eval/results/*.json` show.

## Tagline
Know how deep the street is before you drive into it.

## Inspiration
More than half of US flood deaths happen in vehicles (NWS, "Turn Around, Don't Drown"). People drive into water because
nothing tells them how deep it is on that street right now. River gauges sit on rivers, not streets. Photos, dashcams
and voices are already everywhere during a flood; nobody turns them into a map.

## What it does
- **Street-level flood depth from a photo.** An NVIDIA vision-language model reads the waterline against objects of known
  height (curb 15 cm, door sill 30 cm, tire 65 cm) and returns a depth with a conservative upper bound and the reference it used.
- **A live depth map** that fuses reports per street, with decay. Old reports turn gray ("stale"), never "dry", and
  streets with no reports are unknown, never dry.
- **Routing that respects your vehicle.** A sedan is blocked above 15 cm, an SUV above 30 cm and a pickup above 45 cm, all on the upper
  bound. Water photographed at a depth the model can't read blocks every vehicle. It never loosens a limit to find a route.
- **A Nemotron agent** you can talk to: "Can I get to the Medical Center in my sedan?" It returns a spoken, cited answer and the
  route. Or report what you see ("water's up to my knees at Main and 5th"), and it files a low-confidence report.
- **Drive mode.** A mounted phone checks a frame every 4 seconds. When it sees water ahead, it files a report, speaks
  the depth against your vehicle's limit, and reroutes. Frames are never stored.
- **Terrain inference.** USGS surveyed high-water marks are propagated over connected low ground using 5 m USGS 3DEP
  elevation, covering about 2,150 streets. They're drawn hatched and labeled "inferred", and they are **never** used for routing
  (see Evaluation).
- **Responder mode** (token-protected). The model flags people in the water and occupied vehicles for human review, and
  routing supports a high-water rescue truck.
- **Replay of Hurricane Harvey** (Houston, Aug 26 - Sep 3 2017) with 187 archived NWS flood warnings, so it works without
  a live flood.

## How we built it
| Layer | Technology |
|---|---|
| Depth from photos/video | **NVIDIA Nemotron Nano 2 VL on Nebius Token Factory** (default); **NVIDIA Cosmos Reason 2** self-hosted with vLLM on **Nebius AI Cloud**, benchmarked on the same frozen eval. We ship whichever misses fewer dangerous roads. TODO(eval): name the winner |
| Agent | **NVIDIA Nemotron** on **Nebius Token Factory**, with tool calling (route, street status, alerts, local reports, eyewitness filing) |
| Local reports | **Tavily** search, cited as unverified context |
| Simulations | **NVIDIA Cosmos Transfer** on Nebius AI Cloud: "your street at 40 cm", labeled SIMULATION and never used as evidence. TODO: keep only if the spike worked |
| Data | USGS STN high-water marks, USGS 3DEP 1 m elevation, NWS warnings via Iowa Environmental Mesonet, OpenStreetMap roads, public-domain and CC BY photos |
| Stack | FastAPI + networkx/shapely/scipy on a Nebius CPU VM; Next.js + MapLibre on Vercel |

## Evaluation (the part we're proudest of)
The headline metric is the **dangerous-road miss rate**: the share of photos with true depth over 15 cm that the system would
let a sedan drive through. The target is 0. A prompt change that improves MAE but raises the miss rate is rejected.
- Depth model, held-out test split: miss rate TODO(eval) (TODO(eval) with 95% confidence), abstain rate TODO(eval), MAE
  TODO(eval) cm, interval coverage TODO(eval); per-event breakdown TODO(eval). The labels are human depth bands on
  public-domain/CC BY photos from four US flood events (Harvey 2017, Ida 2021, Helene 2024, July 2023 Vermont floods),
  deduplicated across events and group-split so near-identical photos can't sit on both sides. Photos are labeled
  independently by up to two annotators (TODO(eval): how many had a second label); disagreements score on the deeper (conservative) band. Inter-annotator agreement:
  kappa TODO(eval), 15 cm boundary agreement TODO(eval).
- USGS survey layer (water surface minus lidar ground), checked against 26 surveyed marks: median error +11 cm (it errs
  deep, the safe side).
- Terrain inference, leave-one-out on the high-water marks: errors lean high (median +15 cm), and no reached dangerous mark was
  under-called for a sedan. But it reaches only 30-60% of held-out marks, so **inferred depths are display-only**.
- **What didn't work, and we say so:** a "flood risk next hour" nowcast (rain + terrain). On held-out streets it scored AUC
  0.43-0.68, no better than terrain alone. The rain data is about 12 km coarse, and Harvey's worst street flooding came days
  later from reservoir releases. It's switched off in the product.

## Challenges
- Ground truth: USGS high-water-mark photos show surveyors with tape measures at dry marks, which makes them useless (and leaky) for an
  image eval. We built our own labeled set instead.
- Most geotagged Harvey photos are river views from bridges. Mapping them would mark a dry bridge as flooded, so every
  replay photo is human-checked before it can mark a street.
- Safety wording: the product never says "safe". The agent's road status comes from the router, not the language model, and
  any reply containing a "safe" claim is replaced with a fixed answer built from the router's output.

## What's next
Finer rainfall (1 km MRMS radar) with flood-timed labels to revisit the nowcast; faces and plates blurred on device;
public traffic cameras where the terms allow (Houston TranStar's currently don't).

## Credits
See SOURCES.md. Road network © OpenStreetMap contributors (ODbL).

## Links
- Hosted demo: TODO (Vercel URL + Nebius-hosted API)
- Video (< 3 min): TODO
- Repo (public, Apache-2.0): https://github.com/UgaTheDev/waterline (make public Oct 28)
