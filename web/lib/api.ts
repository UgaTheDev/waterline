// Client for the backend contract in backend/API.md. NEXT_PUBLIC_USE_MOCK=1 swaps in lib/mock.ts.
import * as mock from "./mock";
import { session } from "./session";
import { currentEvent } from "./event";
import { currentLang } from "./i18n";
import { isOffline, liveFetch, paused, snapshotGet, type SnapshotKind } from "./fallback";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "1";

export type LngLat = [number, number];
export type Vehicle = { id: string; label: string; limit_cm: number; responder_only?: boolean }; // responder_only (rescue) shows only in /responder
export type Config = {
  city: string;
  event: string;
  bbox: [number, number, number, number];
  center: LngLat;
  zoom: number;
  replay: { start: string; end: string; default_t: string };
  vehicles: Vehicle[];
  thresholds: { cm: number; text: string }[];
  live: boolean;
  features?: { risk?: boolean };
};
export type EventInfo = { id: string; name: string; city: string; replay: { start: string; end: string; default_t: string }; center: LngLat; zoom: number };
export type Evidence = {
  obs_id: string;
  image_url: string | null;
  reference: string | null;
  depth_cm: number | null;
  low_cm: number | null;
  high_cm: number | null;
  confidence: number | null;
  time: string;
  rationale: string | null;
  credit: string | null;
  source_url?: string | null;
  location_precision?: string;
  kind?: "photo" | "survey" | "dashcam" | "voice" | "inferred" | "report311"; // survey = USGS high-water mark minus 3DEP ground; dashcam and voice have no image
  provenance?: { method: string; derived_from: string[] } | null; // inferred: the obs_ids it was interpolated from
  half_life_min?: number | null;
  session_id?: string | null;
  street?: string | null; // set on /responder/queue items
};
export type SegmentState = "unknown" | "stale" | "reported_unknown" | "reported";
export type SegmentProps = {
  edge_id: string;
  name: string | null;
  state: SegmentState;
  depth_cm: number | null;
  low_cm: number | null;
  high_cm: number | null;
  confidence: number | null;
  obs_time: string;
  evidence: Evidence[];
  basis?: "observed" | "inferred"; // kind of the evidence that set high_cm; inferred is drawn hatched and always labeled
};
export type Feature<G, P> = { type: "Feature"; geometry: G; properties: P };
export type LineString = { type: "LineString"; coordinates: LngLat[] };
export type Polygon = { type: "Polygon"; coordinates: LngLat[][] };
export type FC<G, P> = { type: "FeatureCollection"; features: Feature<G, P>[] };
export type Segments = FC<LineString, SegmentProps>;
export type AlertProps = { event: string; issued: string; expires: string; source: string };
export type Alerts = FC<Polygon, AlertProps>;
export type Point = { lat: number; lon: number; label?: string };
// "none" = no reports, "stale" = old report (both unknown, never dry), "reported" = water under the vehicle limit.
export type RouteSegment = { name: string; start_m: number; length_m: number; state: "none" | "stale" | "reported"; high_cm: number | null; edge_id: string | null };

export type Avoided = {
  edge_id: string;
  name: string | null;
  state: SegmentState;
  high_cm: number | null;
  reason: string;
  evidence: Evidence[];
};
export type RouteResponse =
  | {
      found: true;
      geometry: LineString;
      distance_m: number;
      duration_s?: number; // normal-traffic estimate from OSM speeds; flood traffic is slower
      segments?: RouteSegment[]; // one row per run of a street in one state, in driving order
      avoided: Avoided[];
      unknown_m: number;
      warnings: string[];
      from: Point;
      to: Point;
    }
  | { found: false; reason: string; avoided: Avoided[] };
export type RouteRequest = { from: Point | string; to: Point | string; vehicle: string; t: string };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatResponse = {
  reply: string;
  route: RouteResponse | null;
  sources: { title: string; url: string }[];
  speak?: string; // plain text for TTS: speak this, not reply
  filed?: Evidence[]; // voice reports the agent filed this turn
};
export type ChatRequest = { messages: ChatMessage[]; vehicle: string; t: string; location: Point | null };
export type DashcamResponse =
  | { water: true; filed: boolean; edge_id: string | null; street: string | null; over_limit: boolean; evidence: Evidence | null; speak: string | null }
  | { water: false; filed: false; speak: null };
export type RiskProps = {
  edge_id: string;
  name: string | null;
  risk: number; // 0..1, an estimate for the next hour, never a depth
  band: "elevated" | "high";
  drivers: { rain_3h_mm: number | null; depression_cm: number | null; hand_m: number | null };
};
export type Risk = FC<LineString, RiskProps>;
export type ResponderFlag = "person_in_water" | "occupied_vehicle";
export type QueueItem = { obs_id: string; flags: ResponderFlag[]; evidence: Evidence; reviewed: boolean; label?: string };
export type Simulation = { id: string; street: string; depth_cm: number; video_url: string; label: string };
export type UploadStatus = { obs_id: string; status: "queued" | "done" | "rejected"; result: Evidence | null; message: string };
export type EvalResult =
  | { n: 0 }
  | {
      n: number;
      split: string;
      miss_rate: number;
      abstain_rate: number;
      mae_cm: number;
      coverage: number;
      false_block_rate?: number;
      n_dangerous?: number;
      misses?: number;
      prompt_version?: string;
      model?: string;
      by_reference: Record<string, { n: number; mae_cm: number }>;
      note: string;
    };

// Errors carry the HTTP status so callers can tell "depth model offline" (503) from other failures.
export type ApiError = Error & { status?: number };

// Every call is scoped to the selected replay event (query param for GETs; also a body/form field for POSTs).
const withEvent = (path: string) => (currentEvent() ? `${path}${path.includes("?") ? "&" : "?"}event=${encodeURIComponent(currentEvent())}` : path);

async function toJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : body.message || "";
    } catch {}
    throw Object.assign(new Error(detail || `Request failed (${res.status})`), { status: res.status });
  }
  return res.json();
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  return toJson<T>(await fetch(API_BASE + withEvent(path), init));
}

// A GET with a snapshot equivalent (web/lib/fallback.ts): serves the archived replay instead of
// throwing once the live backend is down, so the map/timeline never just breaks. Never mixes
// snapshot and live data for the SAME request; a caller fetching several things for one view (e.g.
// segments + alerts at a time) should expect both to fall back together once the outage is real.
async function liveOrSnapshot<T>(path: string, kind: SnapshotKind, t: string | null, signal?: AbortSignal): Promise<T> {
  if (!isOffline()) {
    try {
      return await toJson<T>(await liveFetch(withEvent(path), { signal }));
    } catch (e) {
      if ((e as Error).name === "AbortError" && signal?.aborted) throw e; // the caller cancelled; not an outage
    }
  }
  const snap = await snapshotGet<T>(kind, t);
  if (snap) return snap;
  throw new Error("Live service unavailable and no offline snapshot is available for this view.");
}

const MODEL_TIMEOUT_MS = 60000; // the depth model and the Nemotron agent reason for 5-60 s

// Anything that needs a live server and has no snapshot (routing, chat, uploads, dashcam, ...):
// fails fast with a clear "paused" message once the backend is known down, instead of waiting out
// another 8 s timeout, and never fabricates a result.
async function liveOnly<T>(path: string, init: RequestInit, feature: string, timeoutMs?: number): Promise<T> {
  if (isOffline()) throw new Error(paused(feature));
  try {
    return await toJson<T>(await liveFetch(path, init, timeoutMs));
  } catch (e) {
    if ((e as Error).name === "AbortError" && init.signal?.aborted) throw e;
    throw new Error(paused(feature));
  }
}

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(currentEvent() && body && typeof body === "object" ? { ...body, event: currentEvent() } : body),
  signal,
});

// "29.76, -95.38" becomes a point; anything else is a place name for the backend to geocode.
export function parsePoint(s: string): Point | string {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : s.trim();
}

// Mock media ships in public/, so it is not prefixed with the API base.
export const mediaUrl = (u: string) => (USE_MOCK || /^https?:|^data:/.test(u) ? u : API_BASE + u);

const withSession = (form: FormData) => {
  if (!form.has("session")) form.append("session", session());
  if (!form.has("lang")) form.append("lang", currentLang()); // reply language for dashcam speech and upload messages
  if (currentEvent() && !form.has("event")) form.append("event", currentEvent());
  return form;
};

export const api = USE_MOCK
  ? mock.api
  : {
      config: () => liveOrSnapshot<Config>("/config", "config", null),
      events: () => liveOrSnapshot<EventInfo[]>("/events", "events", null),
      segments: (t: string, signal?: AbortSignal) =>
        liveOrSnapshot<Segments>(`/segments?t=${encodeURIComponent(t)}&session=${session()}`, "segments", t, signal),
      alerts: (t: string, signal?: AbortSignal) => liveOrSnapshot<Alerts>(`/alerts?t=${encodeURIComponent(t)}`, "alerts", t, signal),
      route: (body: RouteRequest, signal?: AbortSignal) =>
        liveOnly<RouteResponse>("/route", json({ ...body, session: session() }, signal), "Routing"),
      chat: (body: ChatRequest) => liveOnly<ChatResponse>("/chat", json({ ...body, session: session(), lang: currentLang() }), "The chat assistant", MODEL_TIMEOUT_MS),
      upload: (form: FormData) => liveOnly<UploadStatus>("/upload", { method: "POST", body: withSession(form) }, "Uploads", MODEL_TIMEOUT_MS),
      uploadStatus: (id: string) => liveOnly<UploadStatus>(`/upload/${encodeURIComponent(id)}?session=${session()}&lang=${currentLang()}`, {}, "Upload status"),
      dashcam: (form: FormData) => liveOnly<DashcamResponse>("/dashcam", { method: "POST", body: withSession(form) }, "Drive mode", MODEL_TIMEOUT_MS),
      eval: () => liveOrSnapshot<EvalResult>("/eval", "eval", null),
      risk: (t: string, signal?: AbortSignal) => liveOnly<Risk>(`/risk?t=${encodeURIComponent(t)}&session=${session()}`, { signal }, "Flood risk"),
      simulations: () => liveOnly<Simulation[]>("/simulations", {}, "Simulations"),
      // The token travels only in the X-Responder-Token header, never in a URL.
      responderQueue: (token: string) => liveOnly<QueueItem[]>("/responder/queue", { headers: { "X-Responder-Token": token } }, "Responder queue"),
      responderReview: (token: string, obs_id: string, action: "seen" | "dismissed") =>
        liveOnly<{ ok: boolean }>(
          "/responder/review",
          { ...json({ obs_id, action }), headers: { "Content-Type": "application/json", "X-Responder-Token": token } },
          "Responder review",
        ),
      responderMedia: async (token: string, obs_id: string) => {
        const res = await fetch(`${API_BASE}/responder/media/${encodeURIComponent(obs_id)}`, { headers: { "X-Responder-Token": token } });
        if (!res.ok) throw Object.assign(new Error(`Media unavailable (${res.status})`), { status: res.status });
        return res.blob();
      },
    };
