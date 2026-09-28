# Backend API (FastAPI, JSON)

Base URL comes from `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). Times are ISO-8601 UTC.
Depths are centimetres. `high_cm` is the conservative upper bound and the value everything routes on.

## Segment states
| state | meaning | map colour |
|---|---|---|
| `unknown` | no reports | not drawn (base map); legend says "gray = no reports, not dry" |
| `stale` | reports aged out | gray, shows last-known depth |
| `reported_unknown` | photo received, depth unreadable (blocks every vehicle) | purple, "water reported, depth unknown" |
| `reported` | depth estimate | yellow `high_cm` ≤ 15, orange 15-30, red 30-60, dark red > 60 |

Never display the word "safe". Shallow reports read "no deep water reported".

## Endpoints
`GET /config` →
```json
{"city":"Houston, TX","event":"Hurricane Harvey (2017)","bbox":[w,s,e,n],"center":[lon,lat],"zoom":12,
 "replay":{"start":"2017-08-27T00:00:00Z","end":"2017-08-30T00:00:00Z","default_t":"..."},
 "vehicles":[{"id":"sedan","label":"Sedan","limit_cm":15},{"id":"suv","label":"SUV","limit_cm":30},{"id":"truck","label":"Pickup truck","limit_cm":45}],
 "thresholds":[{"cm":15,"text":"..."},...], "live": false}
```

`GET /segments?t=ISO` → GeoJSON FeatureCollection of LineStrings (only edges with any observation):
```json
{"type":"Feature","geometry":{"type":"LineString","coordinates":[[lon,lat],...]},
 "properties":{"edge_id":"123-456-0","name":"Main St","state":"reported","depth_cm":40,"low_cm":30,
   "high_cm":55,"confidence":0.7,"obs_time":"...","evidence":[Evidence]}}
```
`Evidence` = `{"obs_id":"...","image_url":"/media/<obs_id>.jpg"|null,"reference":"car tire","depth_cm":40,
"low_cm":30,"high_cm":55,"confidence":0.7,"time":"...","rationale":"...","credit":"FEMA / public domain","source_url":"...",
"location_precision":"exact"|"street"|"neighbourhood","kind":"photo"|"survey"}`
(`kind: "survey"` = USGS high-water mark minus 3DEP ground elevation: no image; show it as "USGS survey (estimated peak)") (show "location approximated from caption" unless exact)

`GET /alerts?t=ISO` → GeoJSON FeatureCollection of Polygons, properties `{"event":"Flash Flood Warning","issued":"...","expires":"...","source":"NWS via IEM"}`

`POST /route` body `{"from":{"lat":..,"lon":..}|"place name","to":...,"vehicle":"sedan","t":"ISO"}` →
```json
{"found":true,"geometry":{"type":"LineString","coordinates":[...]},"distance_m":5230,
 "avoided":[{"edge_id":"...","name":"...","state":"reported","high_cm":55,"reason":"reported up to 55 cm; sedan limit 15 cm","evidence":[Evidence]}],
 "unknown_m":800,"warnings":["Route passes 800 m of streets with no reports inside an active Flash Flood Warning"],
 "from":{"lat":..,"lon":..,"label":".."},"to":{...}}
```
`found:false` → `{"found":false,"reason":"No route avoids reported deep water for a sedan.","avoided":[...]}`

`POST /chat` body `{"messages":[{"role":"user","content":"..."}],"vehicle":"sedan","t":"ISO","location":{"lat":..,"lon":..}|null}`
→ `{"reply":"...","route":RouteResponse|null,"sources":[{"title":"...","url":"..."}]}`

`POST /upload` multipart `file` (jpeg/png/mp4, ≤15 MB), `lat`, `lon` (optional if EXIF GPS present), `time` (optional)
→ `202 {"obs_id":"...","status":"queued"|"done"|"rejected","result":Evidence|null,"message":"..."}`
`GET /upload/{obs_id}` → same shape.

`GET /eval` → `{"n":..,"n_dangerous":..,"split":"test","miss_rate":0.0,"misses":0,"false_block_rate":..,"abstain_rate":..,"mae_cm":..,"coverage":..,"by_reference":{"car tire":{"n":12,"mae_cm":9.1},...},"prompt_version":"..","model":"..","note":"..."}` or `{"n":0}` when not yet run.

`GET /health` → `{"ok":true,"gpu":"up"|"down"|"unconfigured"}`

## Sessions, dashcam, voice (added 2026-09-27)
**Session sandbox.** The browser makes a random `session` id (uuid4, kept in sessionStorage) and sends it as the
`session` query param on `GET /segments` and `GET /upload/{id}`, and as a `session` field on `POST /route`, `/chat`, `/upload`, `/dashcam`.
A report filed while viewing the replay (`t` inside `/config.replay`) is stamped with that replay time and is visible
**only to that session**, so visitors can't change the shared Harvey replay. Reports with no `t`, or with `t` outside the window, are
live, stamped now, and visible to everyone. `session` must match `^[0-9a-f-]{8,40}$`, otherwise it is ignored.

`POST /dashcam` multipart `frame` (JPEG ≤ 3 MB), `lat`, `lon`, `vehicle`, `t` (optional), `session` (optional) → 
```json
{"water": true, "filed": true, "edge_id": "...", "street": "Westheimer Rd", "over_limit": true,
 "evidence": Evidence, "speak": "Water reported ahead on Westheimer Road, about 30 centimetres, possibly up to 45. Your sedan's limit is 15. Rerouting."}
```
`{"water": false, "filed": false, "speak": null}` when no flood water is visible. Nothing is filed for a dry frame. Dashcam frames are never stored.
`filed:false` with `water:true` means the frame was a duplicate (same street already reported by this session in the last 2 minutes) or no road was within 30 m.
503 `{"detail": "..."}` means the depth model is offline. Show it and keep driving without warnings. Never imply the road is clear.
Rate limit: 40 frames/min per client. Recommended cadence: 1 frame every 4 s, skipped while a request is in flight.
Evidence `kind` gains `"dashcam"` (no image) and `"voice"` (no image, low confidence).

`POST /chat` also returns `"speak": "..."` (the reply, plain text for TTS: no markdown, units spelled out) and `"filed": [Evidence]`
when the agent filed a voice report ("water's up to my knees at Main and 5th"). Speak `speak`, not `reply`.

## v2 contracts (frozen 2026-09-27; stream owners implement behind these, no signature changes)
- **Observation v2**: + `kind` ∈ photo | dashcam | voice | survey | inferred | report311, `provenance` {method, derived_from:[obs_id]},
  `half_life_min`, `session_id`. An `inferred` observation only ever ADDS water: never depth 0, never "dry", never lowers a report.
- **Segments**: each feature gains `basis`: "observed" | "inferred" (the kind of the evidence that set `high_cm`; a tie goes to observed).
  UI: inferred streets are hatched and labeled "Inferred from nearby reports + terrain".
- **Risk** `GET /risk?t=&session=` → FeatureCollection, properties `{edge_id, name, risk: 0..1, band: "elevated"|"high",
  drivers: {rain_3h_mm, depression_cm, hand_m}}`. Only data ≤ t. Never blocks a route, never says dry. It may add a route warning.
- **Feature flags**: `/config.features.risk` (false by default). The web shows the risk toggle only when true. `/risk` returns an empty collection with a `note` while it's off.
- **Vehicles**: `/config.vehicles[]` gains `responder_only` (true for `rescue`, 90 cm). Show it only in responder mode.
- **Responder** (header `X-Responder-Token`): `GET /responder/queue` → `[{obs_id, flags:["person_in_water"|"occupied_vehicle"], evidence, reviewed}]`,
  `POST /responder/review {obs_id, action:"seen"|"dismissed"}` → `{ok}`. 401 without a token. Label: "Needs human review". Flags never reach the public map.
- **Simulations** `GET /simulations` → `[{id, street, depth_cm, video_url, label}]`. The label (also burned into frames):
  "SIMULATION: generated by NVIDIA Cosmos Transfer, not a real photo". Never evidence, never in /segments or routing.

## Hardening (2026-09-27 security review)
- `/upload` statuses: `queued` (also while processing), `done`, or `rejected` with a `message`. Rejected covers "no flood water visible,
  so no report was filed" (a dry photo is never evidence that a street is clear) and "couldn't be processed" (after 3 attempts).
  MP4 is refused (415) unless the self-hosted depth model is configured. Images over 40 MP are refused (413).
- `/dashcam`, `/chat` and `/upload` have site-wide hourly budgets. Over budget returns 503 with a "turn around" message; show it as-is.
- `/chat` refuses conversations over 20 messages or 30 KB (413). Each message's content is flattened to text and capped at 2,000 characters.
- Timestamps without a timezone are read as UTC.
- A live "depth unknown" report keeps a street `reported_unknown` (blocking every vehicle) unless a readable report is deep enough to block every vehicle anyway.

## Language (added 2026-09-28)
Optional `lang` ∈ `"en"` | `"es"` (default `"en"`; anything else is 422). English output is unchanged.
- `POST /chat` body field `lang`: with `"es"` the agent answers in Spanish, the fallback template is Spanish, and `speak` spells units in Spanish.
- `POST /dashcam` form field `lang`: `speak` is Spanish ("Agua reportada adelante en …").
- `POST /upload` form field `lang` and `GET /upload/{obs_id}?lang=es`: `message` is Spanish.
- Error `detail` strings and `/route` `reason`/`warnings` stay English; the web translates the known router strings.
- The wording guard covers Spanish too: never "seguro/segura", "está seco", "despejado", "transitable"; say
  "No se reporta agua profunda" and "Sin reportes no significa seco". NWS slogan: "¡Dé la vuelta, no se ahogue!".
