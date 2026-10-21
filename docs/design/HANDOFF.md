# Handoff: Waterline — street-level flood depth map

## Overview
Waterline shows how deep flood water is on each street, read by a vision model from crowd photos against objects of known height (curb 15 cm, car door sill 30 cm, tire top 65 cm, hydrant top 75 cm). It routes drivers around water deeper than their vehicle's wading limit (sedan 15, SUV 30, truck 45, rescue truck 90 cm). Primary user: a stressed driver at night on a phone. Also includes a desktop map, a landscape drive HUD, a voice agent, and a token-gated responder queue.

## About the Design Files
`Waterline.dc.html` is a **design reference built in HTML** (open it directly in a browser; `support.js` must sit beside it). It is not production code. Recreate these designs in the target codebase's environment (React Native / SwiftUI / React + MapLibre, etc.) using its own patterns. If no codebase exists, a good fit is React Native (mobile) + React (desktop) with MapLibre GL for the basemap and depth-coloured street layers.

All imagery (street scene, tire photo, dashcam) is drawn with CSS as stand-ins and labelled SIMULATION. Replace with real photos/video; keep the label on anything generated or simulated.

## Fidelity
**High-fidelity.** Colours, type, spacing, copy and states are final. Map geometry (Houston Heights / Montrose streets, Buffalo Bayou) is illustrative; drive it from real data.

## Safety rules (non-negotiable — enforce in code review)
1. Never use the word "safe", a green check, or a "clear" state for a road. Best state = **"No deep water reported"**, neutral grey `#8c99a8` dot, never green.
2. Unknown ≠ dry. Streets with no reports get **no colour** (base road `#1f2a36`) plus the legend line **"No reports doesn't mean dry."** Routes show **"X km without reports: unknown, not dry"**.
3. **Unknown depth** (water reported, depth unreadable) renders exactly like deepest water (`#f43f5e`) with a "?" pin, and **blocks every vehicle**, including rescue.
4. Any generated/simulated image carries a visible **"SIMULATION, not a real photo"** label.
5. No identifiable people or rescue scenes. Responder thumbnails for "possible person" reports are withheld until opened ("IMAGE WITHHELD").

## Screens / Views
Mobile frames are 390×844; drive mode is 844×390 (landscape); desktop is 1440×900. Status-bar zone is 50 px tall.

### 01 Hero (dark + light)
- **Dark:** full-bleed night street photo, top 520 px, fading into bg at the bottom (120 px gradient). Header at top 58: wordmark "Waterline" (Newsreader 24/500) left; "Report water" pill right (13/500, 1px `rgba(230,237,243,.35)` border, radius 999, padding 8×14). SIMULATION chip at top 108, left 22.
- **Depth gauge** on the water: glass panel, left/right 16, top 296, radius 16, bg `rgba(7,11,16,.42)`, 1px `rgba(103,232,249,.28)` border, backdrop blur 3px. Header row: "DEPTH GAUGE" (Mono 10.5, tracking .1em, `#a5f3fc`) and "{depth} cm · {note}" (Mono 15/600). The note comes from the depth: 0 dry, <15 below curb, ≤20 just above curb, <30 below door sill, <45 over door sill, else over truck limit. Body: front-end silhouettes of sedan/SUV/truck at true scale (0.75 px per cm, 130 cm crop, 100 cm tall, 8 px gap). Dashed ticks at 15/30/60 cm with Mono 10 labels. Water band: cyan gradient `rgba(103,232,249,.32→.10)` with a 2 px `#67e8f9` top line. Under each vehicle: name (Sans 11.5/500) and "limit N cm" or "BLOCKED · N" in coral.
- **Copy block** at top 530, inset 24, gap 14: eyebrow "HOUSTON · LIVE REPORTS + REPLAY" (Mono 11, .14em, cyan). Headline "Know how deep the street is before you drive into it." (Newsreader 35/1.07, text-wrap balance). Body "Photos read against curbs, door sills and tires. Routes around water too deep for your vehicle." (15/1.5 muted). CTAs, 52 px tall, radius 14: primary "Open the map" (cyan bg, `#070b10` text, 16/600, flex 1) and secondary "How it reads depth" (panel bg, line border).
- **Light:** paper `#f3f0e8` background, ink `#12161b`. The photo stays night-dark inside an inset card (12 px inset, radius 28, top 52, height 452), with the gauge inside its bottom. Primary CTA uses `#0c6680` bg with paper text; secondary has a `#cfc8b8` border; muted text is `#4f5964`.

### 02 Map (replay)
- Full-bleed dark basemap. Top gradient `#070b10` to transparent over 200 px.
- Search field: top 54, inset 16, h 48, radius 14, panel bg, line border; placeholder "Search a street or place"; avatar 30 px.
- Chip row (gap 8): vehicle chip, h 36, 1 px cyan border, with SUV icon, "SUV" and "30 cm" (Mono, cyan). Replay chip: amber `rgba(251,191,36,.08)` bg, `.6` amber border, Mono 11, text "REPLAY · Hurricane Harvey · Aug 28 2017" with a 6 px dot.
- Right floating buttons: 44×44, radius 12 (locate, 3D).
- Bottom sheet: radius 26 at the top, bg `rgba(12,18,24,.97)`, padding 10/18/30, gap 14. Contents in order:
  - grabber, 36×4;
  - scrubber row: 44 px play button with cyan ring; "Aug 28 · 06:40 CDT" and "412 reports"; 48-bar histogram (26 px tall, played bars cyan at .8, unplayed `#2a3644`, gap 2) with a 2 px `#e6edf3` playhead; axis 00:00/06:00/12:00/18:00 (Mono 10);
  - divider;
  - depth ramp: 4 equal segments, 8 px tall, labelled <15 / 15–30 / 30–45 / 45+ cm;
  - legend grid in 2 columns: Observed (solid), Inferred (45° hatch at .75), Unknown depth · blocks all ("?" ring), Ring = freshness;
  - dashed-border callout: "No reports doesn't mean dry."

### 03 Evidence card (opens when a street or pin is tapped)
- Map dimmed to 45 % behind. Sheet from top 64, panel bg, radius 26, padding 10/20/28, gap 13.
- Title "Allen Pkwy at Studemont" (18/600) with sub "Observed report · 1 of 3 within 200 m" and a 36 px close button.
- Photo, 196 px tall, radius 14, with AI reasoning drawn on it:
  - cyan 1.5 px box around the tire, tagged "TIRE · top 65 cm" (cyan bg, dark Mono 10/600);
  - 2 px dashed `#e6edf3` waterline tagged "WATERLINE · 38 cm";
  - bracket showing "27 cm dry" (65 − 38);
  - SIMULATION chip.
- Depth "38 cm" (Mono 38/600, coral) and "· range 30–50" (Mono 15, `#c4ccd6`).
- 2-column meta: REFERENCE "Tire top · 65 cm"; TAKEN "06:12 CDT · 28 min".
- CONFIDENCE bar, 6 px tall, at 72 % fill in cyan, labelled "0.72 · medium-high".
- "VEHICLES AT 38 CM" box: 4 front-end silhouettes at 0.5 px/cm, each with a dashed wading-limit line. Vehicles over their limit are stroked coral with a tinted fill; others grey. Header shows "2 blocked".
- Credit line: "Photo by reporter #A41F · CC BY 4.0 · depth read by NVIDIA vision model, checked against 2 nearby reports" (11.5 muted).
- Buttons: "Route around this" (primary) and "Flag photo".

### 04 Route sheet
- Map in the top 420 px, zoomed out so the whole route fits. The route is a cyan 4.5 px line with a 10 px glow and 11 px bg casing. It bends around blocked Memorial Dr, which gets a coral ⊗ marker and the chip "Memorial Dr · 52 cm · avoided". Map strokes are scaled ×1.9 to keep their px widths.
- From/To card at top 54.
- Sheet from top 384:
  - "24 min" (Mono 26/600, nowrap) with "11.2 km · via Waugh · +4 min" (Mono 13, muted, nowrap);
  - status block (bg `#111a23`, radius 12): grey dot + **"No deep water reported on this route"** (14/500 `#c4ccd6`), and dashed ring + **"4.3 km without reports: unknown, not dry"** (Mono 12.5 muted);
  - segment rows;
  - "Start drive mode" CTA.
- **Segment row:** grid `4px 1fr auto`, gap 12, padding 8 0, 1 px line divider; 32 px status bar; name 14; status Mono 11.5; distance Mono 12. States:
  - grey solid: no deep water reported;
  - dashed outline: no reports, unknown;
  - amber: under limit;
  - `#f43f5e`: unknown depth;
  - `#f43f5e` with struck-through name: avoided.

### 05 Drive mode (landscape 844×390)
- Dashcam frame fills the screen. Rain-on-glass overlay sits **below** all HUD plates; the plates are ≥ .86 opaque so contrast is measured against the plate.
- Plates: maneuver top-left ("↱ Waugh Dr / in 400 m", 22/600 + Mono 16) and ETA top-right (Mono 22).
- **Water ahead** plate (bottom-left, 400 w, radius 20, 1.5 px amber border):
  - "WATER AHEAD · 180 m" (Mono 14, .12em, amber);
  - "14 cm" (Mono 64/600 amber) next to "/ limit 30";
  - 12 px bar with depth fill and a 3 px white limit marker;
  - "Under your limit. Slow to walking pace."
- **Turn around** state:
  - 6 px coral inset frame plus an 80 px coral inner glow;
  - centred 520 w plate: "Turn around" (Sans 60/700 coral), "52 cm ahead · limit 30" (Mono 26), a bar past the limit, and "Rerouting via Waugh Dr · +4 min".
- DASHCAM · SIMULATION label at bottom centre.

### 06 Agent chat (voice-first)
- Header "Ask Waterline" (Newsreader 22) with vehicle chip.
- User bubble (raised bg, radius 16/16/4/16) with the transcript and "VOICE · 0:04".
- Agent answer (16/1.5): "There's a route with no deep water reported. Memorial Dr has 52 cm at Studemont, over your 30 cm limit, so I'd go down Waugh Dr instead: 14 cm, reported 28 min ago."
- Citation chips, h 32, radius 8:
  - street chips: depth swatch + name + Mono depth;
  - photo chips: 24 px thumbnail + "Photo · 06:12".
- Follow-up: "Montrose Blvd has no reports. That's unknown, not dry."
- Actions: "Open route" and "Read it again".
- Push-to-talk orb: 128 px, radial `#cffafe → #67e8f9 → #0e7490 → #083344`, 50 px cyan glow, two pulse rings. Labels "Hold to talk" | "Type instead".

### 07 Responder (token-gated)
- Badge "TOKEN · HFD-06 · VERIFIED 23:02" (Mono 10.5, cyan border).
- Map card, 230 px tall, showing the rescue-truck route, coral incident rings, the chip "Rescue truck · 90 cm", and the footer "→ Shepherd Dr · 9 min | max 52 cm on route".
- Queue "Needs human review 6". Dense cards: grid `52px 1fr`, padding 10, radius 12; the priority card has a coral border. Types:
  - possible person in water (image withheld, model 0.41);
  - occupied vehicle, 110 cm: "over 90 · boat unit" (above even the rescue limit);
  - occupied vehicle, 52 cm;
  - depth unreadable: treated as deep, blocks all.

### 08 Desktop map (1440×900)
- Grid columns `360px 1fr 384px`.
- **Left rail** (panel bg): wordmark; From/To; vehicle picker (4 tiles, 72 px tall, selected has a 1.5 px cyan border with `rgba(103,232,249,.07)` fill); route summary card with a proportional segment strip; depth ruler of real objects (Curb 15, Car door sill 30, Tire top 65, Hydrant top 75, on a 0–90 scale, water filled to the selected depth); legend lines.
- **Centre:** map with the replay chip and Live / 2D·3D toggles at the top, and a scrubber at the bottom (90 bars; axis from Aug 27 18:00 to Aug 28 18:00; "half-life 6 h").
- **Right:** evidence card, same content as mobile 03.

### 09 Component sheet
Tokens; depth chips; freshness-ring pins; vehicle picker; "Can my car make it?" card; route segment row states; HUD states (No deep water reported in grey, Water ahead in amber, Turn around in coral); offline banner ("Offline snapshot from 22:58 · Showing 16 min old reports. Water can rise since then…", neutral, not alarming); chips; simulation strip (dry / 15 cm curb / 40 cm over sill); compact evidence card.

## Map rendering rules
- Base roads `#1f2a36`; minor grid `#0e151d`; bayou `#0a1c26` (22 px) with a `#0d2533` core.
- **Observed** depth: solid 6 px stroke in the ramp colour plus a 13 px glow (blur 4) at .3 opacity.
- **Inferred** depth: 7 px stroke filled with a 45° hatch pattern (5 px period, 2.4 px bar) at .6 opacity, with no glow.
- Ramp: <15 `#fbbf24` · 15–30 `#fb923c` · 30–45 `#fb7185` · 45+ `#f43f5e` · unknown depth `#f43f5e`.
- **Pins:** 9 px r ring on a bg fill with a `#2a3644` track. The arc in the depth colour shows freshness: arc fraction = 0.5^(age / 6 h), dropping off after 3 half-lives (still shown in replay). Core is a 4 px dot, or "?" for unknown. The selected pin gets a 16 px cyan halo.
- Street labels: Mono 8.5, tracking 1, `#8c99a8`, with a 3 px bg halo (paint-order stroke).
- Vehicle blocked logic: `blocked = depth > vehicle.limit || depth === UNKNOWN`.

## Interactions & Behavior
- Tap street/pin → evidence card sheet (spring up, ~280 ms ease-out).
- "Route around this" / agent "Open route" → route sheet. "Start drive mode" → landscape HUD.
- HUD state from the nearest water ahead on the route:
  - none: "No deep water reported" in grey;
  - depth ≤ limit: Water ahead in amber;
  - depth > limit or unknown: Turn around in coral, then auto-reroute.
- Vehicle picker changes the limit everywhere: map blocked styling, route, HUD, evidence "blocked" count.
- **Waterline rising** (evidence card, gauges):
  - water fill rises from 0 to the reading over 120–900 ms, cubic-bezier(.2,.7,.2,1), with no overshoot;
  - the Mono number counts up;
  - each vehicle flips to coral (120 ms fade) as the line crosses its limit;
  - the range band fades in at 40 % between 900 and 1400 ms.
- **Time scrubber:**
  - while dragging, street colours cross-fade 180 ms per step;
  - 1× play = 1 replay hour per 2 s;
  - on release, snap to 10 min (200 ms ease-out);
  - pins enter with a full ring that drains on the half-life clock;
  - leaving replay fades the amber chip out over 300 ms.
- Rain overlays animate background-position (streaks 0.55 s loop; glass drops 9 s loop).
- `prefers-reduced-motion`: show final states only, with no rain animation.
- **Offline:** show the neutral snapshot banner with its timestamp. Keep the data but never upgrade its status.

## State Management
- `vehicle` (sedan | suv | truck | rescue) → `limitCm`
- `mode` (live | replay), `replayEvent`, `scrubTime`, `isPlaying`
- `reports[]` { id, geom, depthCm | null (unknown), rangeCm[2], refObject, refHeightCm, takenAt, confidence, observed: bool, photoUrl, credit, isSimulated }
- `streetDepth` derived per segment: max(observed), else inferred, else none
- `selectedReport`, `route` { segments[] { name, km, status, depthCm }, kmWithoutReports, avoided[] }
- `hudState` (noDeepWater | waterAhead | turnAround), `distanceToWaterM`
- `online` / `snapshotAt`
- Responder: `authToken`, `reviewQueue[]` { type, location, confidence, depthCm, ageMin, imageWithheld }

## Design Tokens
**Dark:**
- bg `#070b10`, panel `#0c1218`, raised `#111a23`, line `#1c2733`, line-strong `#2a3644`
- text `#e6edf3`, soft text `#c4ccd6`, muted `#8c99a8`
- accent `#67e8f9` (with `#a5f3fc` for light accent text on imagery)
- danger coral `#fb7185`, warn amber `#fbbf24`
- depth ramp `#fbbf24 / #fb923c / #fb7185 / #f43f5e`
- canvas `#04070a`

Light: paper `#f3f0e8`, ink `#12161b`, accent `#0c6680`, muted `#4f5964`, line `#d9d3c4` / `#cfc8b8`.

Imagery-only colours: sodium glow `rgba(255,150–196,60–120,…)` and water `rgba(26–70,46–110,58–130,…)`.

**Type:**
- IBM Plex Sans (UI: 400/500/600/700).
- IBM Plex Mono (all numbers, depths, times, labels; 500/600; uppercase labels at .1–.14em tracking).
- Newsreader (display: hero 35/1.07, desktop wordmark 28, agent title 22).
- Mobile minimum is 10 px for Mono labels and 12–13 px for body.

**Radii:** 3–5 (tags), 7–8 (chips), 10–12 (rows, cards, buttons-sm), 14 (buttons, photos), 16–20 (HUD plates, glass), 26 (sheets), 44–48 (device), 999 (pills).

**Spacing:** 4-based (6, 8, 10, 12, 14, 16, 20, 24, 28). Mobile hit targets ≥ 44 px; primary buttons 50–52 px.

**Shadows:**
- cyan glow `0 0 50px rgba(103,232,249,.4)` (orb);
- coral HUD `inset 0 0 80px rgba(251,113,133,.35)`;
- cards are flat, using borders only.

**Contrast (WCAG 2.2 AA):** muted on bg 6.9:1; `#f43f5e` on bg 5.1:1; ink on paper 16.8:1; `#4f5964` on paper 6.4:1; `#0c6680` on paper 6.2:1. Dark text `#070b10` is used on cyan, amber and coral fills.

## Assets
None external. Vehicle silhouettes are polygon side profiles defined in centimetres (see the `V` object in the file's logic: body points, wheel positions and radii, wading limit). Map geometry is defined in the `ROADS` / `FLOOD` / `PINS` arrays. Photos are CSS stand-ins; replace them with real report photos. Fonts come from Google Fonts.

## Files
- `Waterline.dc.html`: the full board. Sections in order: Hero, Mobile 02–07 + Drive, Desktop, Components, Motion. Tweaks: `heroDepth` (0–60 cm) and `rain` (on/off).
- `support.js`: runtime needed to open the HTML reference.
