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
