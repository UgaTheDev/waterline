# Demo video script (< 3:00, target 2:45)

Supersedes PLAN.md §7 for v2. Only public-domain/CC BY footage, credited in SOURCES.md. No copyrighted music.
Say "Waterline", never "Waze".

**Known data constraint (plan around it):** the Harvey replay has photo reports on Aug 28-30 (5 human-checked road photos,
and more only if the eval pool adds geotagged ones), while the USGS survey and inferred layer peak on **Sep 1-2**
(Buffalo Bayou peaked late with the reservoir releases). So the video has two acts, not one continuous "map fills in"
moment. Run `scripts/batch_replay.py` first (needs a Token Factory key), or Aug 28 is empty.

| Time | Shot | Narration beat |
|---|---|---|
| 0:00-0:12 | Intro screen, water rising to the 15/30/60 cm marks | "More than half of flood deaths happen in vehicles. Nobody knows how deep the street is." |
| 0:12-0:40 | Act 1, Aug 28: a replay photo lands; the evidence card shows the photo, "waterline at the tire", the depth range and the vehicle drawing at depth | Depth from a photo with an NVIDIA VLM on Nebius, conservative upper bound, reference object named |
| 0:40-1:05 | Scrub to Sep 1: USGS survey streets (solid), then inferred streets (hatched) spread across Meyerland | "Surveyed high-water marks plus lidar terrain. Inferred streets are labeled and never route you." |
| 1:05-1:35 | Plan a sedan route through Meyerland: it bends around Stella Link; switch to pickup and the route changes | Vehicle-aware routing on the upper bound; unknown is not dry |
| 1:35-1:55 | Ask the agent out loud: "Can I get to the Medical Center in my sedan?"; spoken answer with cited streets | Nemotron on Token Factory, tool calling |
| 1:55-2:15 | Drive mode on the public-domain 610/Braeswood clip (say "public-domain footage replayed through Drive mode", NOT "dashcam"); spoken warning, reroute | Every phone is a sensor |
| 2:15-2:30 | Eval slide: miss rate (Nano 2 VL vs Cosmos Reason 2), survey +11 cm, inference display-only, the nowcast that didn't work; one line "survey layer earns routing in 1 of 3 events (Harvey yes; Ida NYC, Kerrville TX no)" | Honest numbers, including the negative result |
| 2:30-2:45 | Responder view flash (rescue truck route), then the tagline | "Know how deep the street is before you drive into it." |

**Kerrville 2025 stays out of the video (Kush, 2026-10-20).** About 135 people died in the July 4, 2025 Guadalupe River
flood, including children at Camp Mystic. It appears only as text on the eval slide (the survey gate result). No Kerrville map
footage and no "Waterline would have saved them" framing: it was a fast river flood, deaths were at camps and riverside homes,
not on routes the app could have steered drivers around. In the app it's a replay event; its bbox excludes the camps and
nothing on the site mentions the deaths.

Optional, only if the Cosmos Transfer spike works: 5 s of "your street at 40 cm" with the SIMULATION label visible the whole time.
