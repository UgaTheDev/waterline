# Waze for Floods: Hackathon Context

Everything we know about the hackathon and the idea, verified 2026-09-26. Re-check the
Devpost page before submitting, because rules can change.

## The hackathon

**Nebius x NVIDIA Global AI Hackathon**
https://nebiusglobalaihackathon.devpost.com/ (rules: /rules)

| | |
|---|---|
| Submission window | Aug 26, 2026 9:00 AM PT to **Oct 30, 2026 10:00 AM PT** |
| Judging | Dec 1 to 15, 2026 |
| Winners | Jan 11, 2027 |
| Prizes | Grand $20K, 2nd $10K, 3rd $6K; 4 track winners get an NVIDIA Jetson Orin Nano; **Best Tavily Use $3K**; 20 city winners $500; 10 feedback prizes $100 |
| Prize limit | One overall award **or** one track award **plus** one bonus award |
| Team size | Unlimited; one representative submits |

### Required technology (both are mandatory)
1. **Run on Nebius Token Factory or Nebius AI Cloud** (API calls, Serverless Jobs,
   Serverless Endpoints or DevPods).
2. **Integrate at least one NVIDIA open model:** Nemotron, GR00T, **Cosmos**, or Sonic.

### Tracks
1. Coding and Agentic Engineering (code-writing agents in Token Factory Sandboxes)
2. **Best Apps and Agents:** production-ready tools and copilots using **Nemotron**. This is our track.
3. Personal AI (NemoClaw, OpenShell, Hermes Agent)
4. Physical AI (needs a 1-minute clip of physical hardware operating), so not us

Plan: aim for the **overall prizes**, and qualify for Best Apps and Agents by using Nemotron
for the agent layer. Add **Tavily** for the $3K bonus (live NWS alerts and flood news
retrieval), since it's a genuine fit and not bolted on.

### Submission checklist
- [ ] Public GitHub repo with an **open-source LICENSE file** (Apache-2.0 recommended)
- [ ] README with setup instructions and how to run it
- [ ] Video **under 3 minutes**, on YouTube
- [ ] **Hosted demo URL** that works when judges click it (Dec 1 to 15, so it must stay up
      for weeks after we submit; budget for that)
- [ ] Text description: features, plus exactly how Nebius and NVIDIA models are used
- [ ] New work, or significantly updated after Aug 26, 2026
- [ ] **No copyrighted footage, music or trademarks in the video without permission** (see
      "Data and footage rights")

### Judging (four criteria, equal weight)
1. **Technological Implementation:** effective use of Nebius and NVIDIA models
2. **Design:** a complete product experience, not a proof of concept
3. **Potential Impact:** a real problem solved
4. **Quality of Idea:** creative use of the required technologies

## Platform facts
- **Nebius Token Factory:** OpenAI-compatible API, 60+ models including Nemotron and VLMs
  (Qwen2.5-VL-72B). https://docs.tokenfactory.nebius.com/api-reference/introduction
- **Cosmos Reason 2 is not a Token Factory model.** It deploys on **Nebius AI Cloud** using
  "Containers over VM" (on-demand GPU with an API endpoint). NVIDIA's cookbook has the exact
  walkthrough:
  https://nvidia-cosmos.github.io/cosmos-cookbook/getting_started/nebius/reason2/reason2_on_nebius.html
  - Takes images **and video** plus natural-language prompts (NIM API:
    https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/cosmos-reason2/api.html)
  - A Cosmos 3 Reasoner also exists; check whether it's deployable on Nebius and better.
  - **Cost:** a GPU VM bills while it's running. Stop it when idle, and plan how to keep the
    hosted demo alive through judging (cache results and only wake the GPU for new uploads).
- Nebius markets Cosmos Reason fine-tuning for **smart-city and safety** video, which is
  exactly this use case. That's a good line for the description.

## The idea
**Problem:** flooding is the costliest natural disaster in the US, and **more than half of
flood deaths happen in vehicles** (NWS "Turn Around, Don't Drown"). People drive into water
because nothing tells them how deep it is on that street right now. Gauges are sparse and sit
on rivers, not streets.

**Product:** a live, street-level flood depth map with routing that respects your vehicle.
- Video and photos come in from phones, public traffic cams, and opted-in doorbell cams.
- **Cosmos Reason 2** estimates water depth from reference objects in the frame (curb,
  tire, car door sill, stop-sign post), returning depth, confidence and the reference used.
- Observations fuse onto road segments with time decay, forming a live depth layer.
- **Routing** avoids any segment deeper than your vehicle can handle (sedan vs. SUV vs. truck).
- **Nemotron agent:** "Can I get to Mass General from here in my Civic?" gives a route plus
  a plain-language reason. Push alerts cover saved routes.
- **Tavily:** pulls live NWS flood warnings and local reports as extra signals.

### Safety thresholds (NWS / FEMA guidance, cite these in the app)
- 6 in (15 cm): reaches the bottom of most cars, can cause loss of control or stalling
- 12 in (30 cm): many vehicles float
- 24 in (60 cm): sweeps away most vehicles, including SUVs and pickups

The app is **asymmetric by design**: calling a dangerous road safe is far worse than calling a
safe road dangerous, so thresholds and confidence handling are conservative. That's the
headline evaluation metric (see PLAN.md).

### Existence check (2026-09-26)
Only academic research, no consumer product found:
- FloodVision (VLM + knowledge base, 8.75 cm MAE on 654 crowdsourced images):
  https://arxiv.org/pdf/2509.04772
- Surveillance cameras + LiDAR depth:
  https://www.sciencedirect.com/science/article/abs/pii/S1364815225002567
- Crowdsourced street photos + gauges for routing:
  https://www.sciencedirect.com/science/article/abs/pii/S1474034622001884
- Traffic-sign based (FloodMask): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8402382/

These papers are both our **prior art** (cite them in the README: "research shows it works,
nobody has shipped it") and potential **evaluation data** (check each dataset's license
before using it).

## Data and footage rights
The video can't contain copyrighted footage. Safe sources:
- **US federal government imagery is public domain:** USGS, NOAA, NWS, FEMA and the Army
  Corps publish flood photos and video. USGS high-water-mark photos come with measured depths,
  which makes them ideal evaluation ground truth.
- **CC-licensed** Wikimedia Commons flood media, with attribution.
- **State DOT traffic cameras:** check each state's terms. Some allow reuse, some don't.
- **Our own footage:** staged shots (a curb and a bucket of water won't convince anyone,
  so use this only for UI walkthroughs).
- **Doorbell cams:** opt-in only. Blur faces and plates before storing (stretch goal).
