// Client for the backend contract in backend/API.md. NEXT_PUBLIC_USE_MOCK=1 swaps in lib/mock.ts.
import * as mock from "./mock";
import { session } from "./session";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "1";

export type LngLat = [number, number];
export type Vehicle = { id: string; label: string; limit_cm: number };
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
};
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
  kind?: "photo" | "survey" | "dashcam" | "voice"; // survey = USGS high-water mark minus 3DEP ground; dashcam and voice have no image
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
};
export type Feature<G, P> = { type: "Feature"; geometry: G; properties: P };
export type LineString = { type: "LineString"; coordinates: LngLat[] };
export type Polygon = { type: "Polygon"; coordinates: LngLat[][] };
export type FC<G, P> = { type: "FeatureCollection"; features: Feature<G, P>[] };
export type Segments = FC<LineString, SegmentProps>;
export type AlertProps = { event: string; issued: string; expires: string; source: string };
export type Alerts = FC<Polygon, AlertProps>;
export type Point = { lat: number; lon: number; label?: string };
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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, init);
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

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
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
  return form;
};

export const api = USE_MOCK
  ? mock.api
  : {
      config: () => req<Config>("/config"),
      segments: (t: string, signal?: AbortSignal) =>
        req<Segments>(`/segments?t=${encodeURIComponent(t)}&session=${session()}`, { signal }),
      alerts: (t: string, signal?: AbortSignal) => req<Alerts>(`/alerts?t=${encodeURIComponent(t)}`, { signal }),
      route: (body: RouteRequest, signal?: AbortSignal) => req<RouteResponse>("/route", json({ ...body, session: session() }, signal)),
      chat: (body: ChatRequest) => req<ChatResponse>("/chat", json({ ...body, session: session() })),
      upload: (form: FormData) => req<UploadStatus>("/upload", { method: "POST", body: withSession(form) }),
      uploadStatus: (id: string) => req<UploadStatus>(`/upload/${encodeURIComponent(id)}?session=${session()}`),
      dashcam: (form: FormData) => req<DashcamResponse>("/dashcam", { method: "POST", body: withSession(form) }),
      eval: () => req<EvalResult>("/eval"),
    };
