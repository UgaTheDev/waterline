// Client for the backend contract in backend/API.md. NEXT_PUBLIC_USE_MOCK=1 swaps in lib/mock.ts.
import * as mock from "./mock";

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
export type ChatResponse = { reply: string; route: RouteResponse | null; sources: { title: string; url: string }[] };
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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, init);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : body.message || "";
    } catch {}
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

// Mock media ships in public/, so it is not prefixed with the API base.
export const mediaUrl = (u: string) => (USE_MOCK || /^https?:|^data:/.test(u) ? u : API_BASE + u);

export const api = USE_MOCK
  ? mock.api
  : {
      config: () => req<Config>("/config"),
      segments: (t: string, signal?: AbortSignal) => req<Segments>(`/segments?t=${encodeURIComponent(t)}`, { signal }),
      alerts: (t: string, signal?: AbortSignal) => req<Alerts>(`/alerts?t=${encodeURIComponent(t)}`, { signal }),
      route: (body: RouteRequest, signal?: AbortSignal) => req<RouteResponse>("/route", json(body, signal)),
      chat: (body: { messages: ChatMessage[]; vehicle: string; t: string; location: Point | null }) =>
        req<ChatResponse>("/chat", json(body)),
      upload: (form: FormData) => req<UploadStatus>("/upload", { method: "POST", body: form }),
      uploadStatus: (id: string) => req<UploadStatus>(`/upload/${encodeURIComponent(id)}`),
      eval: () => req<EvalResult>("/eval"),
    };
