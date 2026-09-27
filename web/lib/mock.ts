// Offline fixtures shaped exactly like backend/API.md. Used when NEXT_PUBLIC_USE_MOCK=1.
// Geometry is hand-placed around Buffalo Bayou / downtown Houston; depths are illustrative, not real reports.
import type {
  Alerts,
  Avoided,
  ChatRequest,
  ChatResponse,
  Config,
  DashcamResponse,
  EvalResult,
  Evidence,
  LngLat,
  Point,
  RouteRequest,
  RouteResponse,
  Segments,
  SegmentProps,
  UploadStatus,
} from "./api";

const config: Config = {
  city: "Houston, TX",
  event: "Hurricane Harvey (2017)",
  bbox: [-95.5, 29.66, -95.33, 29.81],
  center: [-95.384, 29.762],
  zoom: 13.6,
  replay: { start: "2017-08-26T12:00:00Z", end: "2017-08-31T00:00:00Z", default_t: "2017-08-28T06:00:00Z" },
  vehicles: [
    { id: "sedan", label: "Sedan", limit_cm: 15 },
    { id: "suv", label: "SUV", limit_cm: 30 },
    { id: "truck", label: "Pickup truck", limit_cm: 45 },
  ],
  thresholds: [
    { cm: 15, text: "6 in (15 cm) reaches the bottom of most cars and can cause loss of control or stalling." },
    { cm: 30, text: "12 in (30 cm) of moving water can float many vehicles." },
    { cm: 60, text: "24 in (60 cm) of rushing water can sweep away most vehicles, including SUVs and pickups." },
  ],
  live: false,
};

type Seed = {
  id: string;
  name: string;
  coords: LngLat[];
  peak: number | null; // peak depth in cm; null = water seen, depth unreadable
  appears: string;
  every: number; // hours between reports
  until?: string; // reports stop here (the street then ages out)
  reference: string | null;
  credit: string;
  image?: { url: string; source_url: string }; // a real, licensed Harvey photo standing in for the report
  precision?: string;
};

const seeds: Seed[] = [
  { id: "1001-1002-0", name: "Memorial Dr", coords: [[-95.392, 29.7627], [-95.385, 29.7631], [-95.3775, 29.7626], [-95.3705, 29.7629]], peak: 55, appears: "2017-08-26T20:00:00Z", every: 3, reference: "car tire", credit: "Sample data, not a real report" },
  { id: "1003-1004-0", name: "Allen Pkwy", coords: [[-95.3935, 29.7602], [-95.386, 29.7596], [-95.378, 29.7593], [-95.3725, 29.7591]], peak: 70, appears: "2017-08-26T23:00:00Z", every: 2, reference: "car door sill", credit: "Chabad Lubavitch, CC BY 2.0, via Wikimedia Commons", image: { url: "/mock/harvey-62096633.jpg", source_url: "https://commons.wikimedia.org/wiki/File:Harvey_flooding_(36527844190).jpg" } },
  { id: "1005-1006-0", name: "Waugh Dr", coords: [[-95.3928, 29.7605], [-95.3926, 29.7655], [-95.3922, 29.7705]], peak: 35, appears: "2017-08-27T04:00:00Z", every: 4, reference: "curb", credit: "Sample data, not a real report" },
  { id: "1007-1008-0", name: "Sabine St", coords: [[-95.3738, 29.7622], [-95.3741, 29.7662], [-95.3743, 29.7702]], peak: 24, appears: "2017-08-27T08:00:00Z", every: 3, reference: "fire hydrant", credit: "Sample data, not a real report" },
  { id: "1009-1010-0", name: "W Gray St", coords: [[-95.3985, 29.7532], [-95.3905, 29.7531], [-95.3835, 29.7533]], peak: 10, appears: "2017-08-27T11:00:00Z", every: 5, reference: "curb", credit: "Sample data, not a real report" },
  { id: "1011-1012-0", name: "Montrose Blvd", coords: [[-95.3905, 29.7488], [-95.3902, 29.7545], [-95.3898, 29.7589]], peak: null, appears: "2017-08-27T14:00:00Z", every: 6, reference: null, credit: "Wikimedia Commons / CC BY 4.0", precision: "street" },
  { id: "1013-1014-0", name: "Studemont St", coords: [[-95.3962, 29.7645], [-95.3958, 29.7705], [-95.3955, 29.7765]], peak: 18, appears: "2017-08-26T18:00:00Z", every: 3, until: "2017-08-27T03:00:00Z", reference: "stop-sign post", credit: "Sample data, not a real report" },
  { id: "1015-1016-0", name: "Shepherd Dr", coords: [[-95.4098, 29.7525], [-95.4096, 29.7605], [-95.4094, 29.7690]], peak: 48, appears: "2017-08-27T02:00:00Z", every: 3, reference: "car door sill", credit: "Sample data, not a real report" },
  { id: "1017-1018-0", name: "Washington Ave", coords: [[-95.4045, 29.7704], [-95.395, 29.7699], [-95.386, 29.7690], [-95.3775, 29.7672]], peak: 22, appears: "2017-08-27T06:00:00Z", every: 4, reference: "curb", credit: "Sample data, not a real report" },
  { id: "1019-1020-0", name: "White Oak Dr", coords: [[-95.3905, 29.7772], [-95.3835, 29.7768], [-95.3765, 29.7755]], peak: 85, appears: "2017-08-27T09:00:00Z", every: 2, reference: "stop-sign post", credit: "Sample data, not a real report" },
  { id: "1021-1022-0", name: "Heights Blvd", coords: [[-95.3988, 29.7712], [-95.3986, 29.7780], [-95.3984, 29.7850]], peak: 8, appears: "2017-08-27T16:00:00Z", every: 6, reference: "curb", credit: "Sample data, not a real report" },
];

const H = 3600_000;
const ms = (s: string) => new Date(s).getTime();

// Rises through Aug 27, peaks Aug 28, recedes by half through Aug 30.
function level(t: number) {
  const rise = Math.min(1, Math.max(0.35, (t - ms("2017-08-26T18:00:00Z")) / (30 * H)));
  const fall = t > ms("2017-08-29T06:00:00Z") ? Math.max(0.45, 1 - (t - ms("2017-08-29T06:00:00Z")) / (40 * H)) : 1;
  return rise * fall;
}

function observation(s: Seed, at: number, i: number): Evidence {
  const depth = s.peak === null ? null : Math.max(2, Math.round(s.peak * level(at) + ((i * 7) % 5) - 2));
  const low = depth === null ? null : Math.max(0, depth - 8);
  const high = depth === null ? null : depth + 10;
  return {
    obs_id: `obs-${s.id}-${i}`,
    image_url: s.image?.url ?? null,
    source_url: s.image?.source_url ?? null,
    reference: s.reference,
    depth_cm: depth,
    low_cm: low,
    high_cm: high,
    confidence: s.peak === null ? 0.3 : 0.62 + ((i * 13) % 20) / 100,
    time: new Date(at).toISOString(),
    rationale:
      s.peak === null
        ? "Standing water covers the lanes, but no object of known height is in frame to measure against."
        : `The waterline sits against the ${s.reference} in frame (known typical height), giving ${low}–${high} cm.`,
    credit: s.credit,
    location_precision: s.precision ?? "exact",
  };
}

function segmentAt(s: Seed, t: number): SegmentProps | null {
  const first = ms(s.appears);
  if (t < first) return null;
  const last = Math.min(t, s.until ? ms(s.until) : t);
  const obs: Evidence[] = [];
  for (let at = first, i = 0; at <= last; at += s.every * H, i++) obs.push(observation(s, at, i));
  obs.push(...(filed.get(s.id) ?? []).filter((e) => ms(e.time) <= t));
  obs.sort((a, b) => b.time.localeCompare(a.time)); // newest first
  const latest = obs[0];
  const stale = t - ms(latest.time) > 8 * H;
  return {
    edge_id: s.id,
    name: s.name,
    state: stale ? "stale" : latest.high_cm === null ? "reported_unknown" : "reported",
    depth_cm: latest.depth_cm,
    low_cm: latest.low_cm,
    high_cm: latest.high_cm,
    confidence: latest.confidence,
    obs_time: latest.time,
    evidence: obs,
  };
}

function segments(t: string): Segments {
  const tm = ms(t);
  const features = seeds.flatMap((s) => {
    const p = segmentAt(s, tm);
    return p ? [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: s.coords }, properties: p }] : [];
  });
  return { type: "FeatureCollection", features };
}

function alerts(t: string): Alerts {
  const tm = ms(t);
  const issued = "2017-08-26T22:10:00Z";
  const expires = "2017-08-29T18:00:00Z";
  if (tm < ms(issued) || tm > ms(expires)) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[-95.412, 29.747], [-95.36, 29.744], [-95.352, 29.768], [-95.378, 29.783], [-95.41, 29.776], [-95.412, 29.747]]],
        },
        properties: { event: "Flash Flood Warning", issued, expires, source: "NWS via IEM" },
      },
    ],
  };
}

const places: Record<string, Point> = {
  default_from: { lat: 29.7705, lon: -95.3985, label: "Washington Ave & Studemont St" },
  default_to: { lat: 29.7589, lon: -95.3677, label: "Downtown (Main St & Texas Ave)" },
};

function resolve(p: Point | string, fallback: Point): Point {
  return typeof p === "string" ? { ...fallback, label: p || fallback.label } : { ...p, label: p.label ?? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` };
}

function route(body: RouteRequest): RouteResponse {
  const seg = segments(body.t).features.filter((f) => f.properties.state !== "stale");
  const v = config.vehicles.find((x) => x.id === body.vehicle) ?? config.vehicles[0];
  const avoided: Avoided[] = seg
    .filter((f) => f.properties.state === "reported_unknown" || (f.properties.high_cm ?? 0) > v.limit_cm)
    .map((f) => ({
      edge_id: f.properties.edge_id,
      name: f.properties.name,
      state: f.properties.state,
      high_cm: f.properties.high_cm,
      reason:
        f.properties.high_cm === null
          ? "water reported, depth unreadable"
          : `reported up to ${f.properties.high_cm} cm; ${v.label.toLowerCase()} limit ${v.limit_cm} cm`,
      evidence: f.properties.evidence.slice(0, 3),
    }));
  const dest = typeof body.to === "string" ? body.to.toLowerCase() : "";
  if (dest.includes("bayou")) {
    return { found: false, reason: `No route avoids reported deep water for a ${v.label.toLowerCase()}.`, avoided };
  }
  const from = resolve(body.from, places.default_from);
  const to = resolve(body.to, places.default_to);
  // Two hand-drawn corridors: the sedan detours north around Washington Ave; bigger vehicles take it.
  const north = avoided.some((a) => a.name === "Washington Ave");
  const mid: LngLat[] = north
    ? [[-95.3985, 29.7745], [-95.393, 29.7792], [-95.3872, 29.7805], [-95.3745, 29.7808], [-95.3665, 29.7738], [-95.3655, 29.7648]]
    : [[-95.3972, 29.7702], [-95.388, 29.7694], [-95.3795, 29.7680], [-95.3712, 29.7668], [-95.3688, 29.7625]];
  const coords: LngLat[] = [[from.lon, from.lat], ...mid, [to.lon, to.lat]];
  const warned = alerts(body.t).features.length > 0;
  return {
    found: true,
    geometry: { type: "LineString", coordinates: coords },
    distance_m: north ? 5230 : 4180,
    avoided,
    unknown_m: 800,
    warnings: warned ? ["Route passes 800 m of streets with no recent reports inside an active flood warning."] : [],
    from,
    to,
  };
}

// Reports filed this session (dashcam, voice), merged into segments() like the backend's session sandbox.
const filed = new Map<string, Evidence[]>();
function file(edge: string, ev: Evidence) {
  filed.set(edge, [...(filed.get(edge) ?? []), ev]);
  return ev;
}

// "Water's up to my knees at Main and 5th": the mock files a voice report on Sabine St at the replay time.
function voiceReport(q: string, t: string): Evidence | null {
  if (!/(knee|ankle|waist|water('s| is)? (up|over|at|on))/.test(q)) return null;
  const [low, high] = /waist/.test(q) ? [80, 110] : /ankle/.test(q) ? [10, 20] : [40, 60];
  return file("1007-1008-0", {
    obs_id: `obs-voice-${Date.now()}`,
    image_url: null,
    reference: null,
    depth_cm: Math.round((low + high) / 2),
    low_cm: low,
    high_cm: high,
    confidence: 0.3,
    time: t,
    rationale: `Spoken report: "${q}".`,
    credit: "Voice report from this session",
    location_precision: "street",
    kind: "voice",
  });
}

function chat(body: ChatRequest): ChatResponse {
  const q = body.messages[body.messages.length - 1]?.content.toLowerCase() ?? "";
  const ev = voiceReport(q, body.t);
  if (ev)
    return {
      reply: `Thanks. I filed a voice report on Sabine St at ${ev.low_cm}–${ev.high_cm} cm, marked low confidence. Routes will avoid it. Please don't drive into it.`,
      speak: `Thanks. I filed a voice report on Sabine Street, about ${ev.low_cm} to ${ev.high_cm} centimetres, marked low confidence. Routes will avoid it. Please don't drive into it.`,
      route: null,
      sources: [],
      filed: [ev],
    };
  const wantsRoute = /route|get to|drive|way to|how do i/.test(q);
  const r = wantsRoute ? route({ from: body.location ?? "", to: "", vehicle: body.vehicle, t: body.t }) : null;
  const blocked = r?.avoided.slice(0, 4).map((a) => a.name).filter(Boolean).join(", ");
  return {
    reply: r?.found
      ? `Yes, with a detour. I found a ${(r.distance_m / 1000).toFixed(1)} km route that stays off ${r.avoided.length} streets with water reported above your vehicle's limit, including ${blocked}. About ${r.unknown_m} m of it runs through streets nobody has reported on inside the active Flash Flood Warning. That is unknown, not dry. If you see water across the road, turn around.`
      : "Water is reported on Memorial Dr (up to 65 cm) and Allen Pkwy (up to 80 cm) along Buffalo Bayou, and White Oak Dr is deeper still. A Flash Flood Warning covers the area. Tell me where you're going and in what vehicle, and I'll plan around it.",
    speak: r?.found
      ? `Yes, with a detour. The route is ${(r.distance_m / 1000).toFixed(1)} kilometres and stays off ${r.avoided.length} streets with water reported above your vehicle's limit. Some of it runs through streets nobody has reported on. That is unknown, not dry. If you see water across the road, turn around.`
      : "Water is reported on Memorial Drive and Allen Parkway along Buffalo Bayou, and White Oak Drive is deeper still. A flash flood warning covers the area. Tell me where you're going and in what vehicle, and I'll plan around it.",
    route: r,
    sources: [
      { title: "NWS Houston/Galveston: Flash Flood Warning", url: "https://www.weather.gov/hgx/" },
      { title: "Harris County Flood Warning System", url: "https://www.harriscountyfws.org/" },
    ],
  };
}

// A scripted drive: dry frames, then deep water on Washington Ave (filed, then a duplicate), then shallow water on Heights Blvd.
const DRIVE: ({ edge: string; street: string; spoken: string; low: number; high: number } | null)[] = [
  null,
  null,
  { edge: "1017-1018-0", street: "Washington Ave", spoken: "Washington Avenue", low: 28, high: 45 },
  { edge: "1017-1018-0", street: "Washington Ave", spoken: "Washington Avenue", low: 28, high: 45 },
  null,
  { edge: "1021-1022-0", street: "Heights Blvd", spoken: "Heights Boulevard", low: 4, high: 12 },
];
let frames = 0;
const lastFiled = new Map<string, number>();

function dashcam(form: FormData): DashcamResponse {
  const step = DRIVE[frames++ % DRIVE.length];
  if (!step) return { water: false, filed: false, speak: null };
  const v = config.vehicles.find((x) => x.id === form.get("vehicle")) ?? config.vehicles[0];
  const t = (form.get("t") as string | null) || new Date().toISOString();
  const over = step.high > v.limit_cm;
  const dup = Date.now() - (lastFiled.get(step.edge) ?? 0) < 2 * 60_000;
  const evidence: Evidence = {
    obs_id: `obs-dashcam-${Date.now()}`,
    image_url: null,
    reference: "car tire",
    depth_cm: Math.round((step.low + step.high) / 2),
    low_cm: step.low,
    high_cm: step.high,
    confidence: 0.58,
    time: t,
    rationale: `Water reaches the lower sidewall of the car ahead (typical tire height 65 cm), giving ${step.low}–${step.high} cm.`,
    credit: "Dashcam frame from this session (not stored)",
    location_precision: "street",
    kind: "dashcam",
  };
  if (!dup) {
    lastFiled.set(step.edge, Date.now());
    file(step.edge, evidence);
  }
  return {
    water: true,
    filed: !dup,
    edge_id: step.edge,
    street: step.street,
    over_limit: over,
    evidence,
    speak: over
      ? `Water reported ahead on ${step.spoken}, about ${Math.round((step.low + step.high) / 2)} centimetres, possibly up to ${step.high}. Your ${v.label.toLowerCase()}'s limit is ${v.limit_cm}. Rerouting.`
      : `Shallow water on ${step.spoken}, up to ${step.high} centimetres. No deep water reported. Water can rise fast.`,
  };
}

const uploads = new Map<string, number>();
const wait = (n: number) => new Promise((r) => setTimeout(r, n));

export const api = {
  config: async () => config,
  segments: async (t: string) => segments(t),
  alerts: async (t: string) => alerts(t),
  route: async (body: RouteRequest) => {
    await wait(450);
    return route(body);
  },
  chat: async (body: ChatRequest) => {
    await wait(1400);
    return chat(body);
  },
  upload: async (): Promise<UploadStatus> => {
    const obs_id = `obs-upload-${Date.now()}`;
    uploads.set(obs_id, 0);
    return { obs_id, status: "queued", result: null, message: "Queued for depth estimation." };
  },
  uploadStatus: async (id: string): Promise<UploadStatus> => {
    const n = (uploads.get(id) ?? 0) + 1;
    uploads.set(id, n);
    if (n < 2) return { obs_id: id, status: "queued", result: null, message: "Waiting for the depth model to warm up." };
    return {
      obs_id: id,
      status: "done",
      message: "Processed.",
      result: {
        obs_id: id,
        image_url: null,
        reference: "car tire",
        depth_cm: 28,
        low_cm: 20,
        high_cm: 38,
        confidence: 0.64,
        time: new Date().toISOString(),
        rationale: "The waterline reaches about 45% of the front tire of the parked car (typical tire height 65 cm).",
        credit: "Your upload",
      },
    };
  },
  dashcam: async (form: FormData) => {
    await wait(900);
    return dashcam(form);
  },
  eval: async (): Promise<EvalResult> => ({ n: 0 }),
};
