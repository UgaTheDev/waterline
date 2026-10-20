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
- Depth model (**provisional: Nemotron 3.5 Super VL via build.nvidia.com, a dev stand-in; replace with the Nebius run
  before submitting**). First run, test split: 4 of 38 dangerous photos missed, all four "0 cm" readings with no reference
  object (a patio, a boat, a house, wet pavement): "can't measure" had become "dry". New rule: a 0 cm reading must name what
  it saw dry, otherwise it is unknown and blocks every vehicle. Because that rule came from reading test misses, the clean
  check is the dev split, scored with the rule fixed beforehand: **0 of 49 dangerous photos missed (95% CI 0-7.3%)**,
  across Harvey, Ida, Helene and Vermont. The price is caution: 15% of photos read unknown, 12 of 13 shallow-water roads are
  blocked anyway, MAE 23 cm, and the depth range contains the labelled band only 34% of the time (ranges are tight; the
  routing safety comes from the bound sitting above the sedan limit, not from calibrated intervals). Test split with the
  rule: 0 of 38 (contaminated, reported for completeness). The labels are depth bands on
  public-domain/CC BY photos from four US flood events (Harvey 2017, Ida 2021, Helene 2024, July 2023 Vermont floods),
  deduplicated across events and group-split so near-identical photos can't sit on both sides. **Disclosure: the first
  annotator is Claude (an AI model, not a depth model under test)**, labelling from pixels only and taking the deeper band
  when unsure: 106 of 182 photos labelled, 76 skipped because no road is visible (44 in the test split). A second, independent
  AI annotator (Claude Opus, blind to the first) labelled 99 of the same photos: kappa 0.56 (moderate), every disagreement
  within one band, 91% agreement on the 15 cm sedan boundary; the second annotator read deeper 24 times, shallower 8.
  Disagreements score on the deeper (conservative) band. Both annotators are AI, so this measures label consistency, not
  ground truth.
- USGS survey layer (water surface minus lidar ground), checked against 26 surveyed marks: median error +11 cm (it errs
  deep, the safe side).
- **The survey method doesn't transfer safely, and we gate it.** Validated in a second city (Hurricane Ida, NYC, 77 surveyed
  marks): it reads unbiased there (median -1 cm on 66 street-level marks), not deep as in Houston, so its upper bound missed
  5 of 63 dangerous marks for a sedan. Many all-marks misses were basement and ramp seed lines, water pooled below street
  grade. So each event's survey layer must earn routing: it decides routes only with 0 street-level sedan misses in its own
  validation (Harvey 0/25). Otherwise it's shown but display-only (`eval/results/survey_validation_*.json`, regenerated by
  `python -m scripts.survey_layer <event> --validate`). A third event fails too: the July 2025 Texas Hill Country flash
  flood (Kerrville, 36 surveyed street-level marks) has 1 sedan miss, and its split-conformal 95% allowance is 232 cm against
  the 37.5 cm we ship (a canyon flash flood's water surface is far from flat). One of three events earns routing; the gate
  is the point.
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
