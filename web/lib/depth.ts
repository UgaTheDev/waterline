import type { SegmentState } from "./api";
import type { Theme } from "./theme";

// Bands and wording per backend/API.md. Never say "safe": shallow reads "No deep water reported".
export type Band = "shallow" | "stall" | "float" | "sweep" | "unknownDepth" | "stale";

export const PALETTE: Record<Theme, Record<Band | "route" | "routeCasing" | "alert", string>> = {
  dark: {
    shallow: "#facc15",
    stall: "#fb923c",
    float: "#ff4d5e",
    sweep: "#a3002a",
    unknownDepth: "#a78bfa",
    stale: "#64748b",
    route: "#67e8f9",
    routeCasing: "#04151b",
    alert: "#fb7185",
  },
  light: {
    shallow: "#ca8a04",
    stall: "#ea580c",
    float: "#dc2626",
    sweep: "#7f1d1d",
    unknownDepth: "#7c3aed",
    stale: "#94a3b8",
    route: "#0e7490",
    routeCasing: "#ffffff",
    alert: "#be123c",
  },
};

export const LEGEND: { band: Band; label: string; note: string }[] = [
  { band: "shallow", label: "≤ 15 cm", note: "No deep water reported" },
  { band: "stall", label: "15–30", note: "Can stall most cars" },
  { band: "float", label: "30–60", note: "Many vehicles float" },
  { band: "sweep", label: "> 60", note: "Sweeps most vehicles away" },
  { band: "unknownDepth", label: "Water", note: "Depth unknown" },
  { band: "stale", label: "Old", note: "Report aged out" },
];

export const THRESHOLDS = [15, 30, 60];

export function bandFor(state: SegmentState, high: number | null): Band {
  if (state === "stale") return "stale";
  if (state === "reported_unknown" || high === null) return "unknownDepth";
  if (high <= 15) return "shallow";
  if (high <= 30) return "stall";
  if (high <= 60) return "float";
  return "sweep";
}

export function describe(state: SegmentState, high: number | null) {
  if (state === "unknown") return "No reports. That does not mean dry.";
  if (state === "reported_unknown" || high === null) return "Water reported, depth unknown";
  const prefix = state === "stale" ? "Last known: " : "";
  if (high <= 15) return prefix + "No deep water reported";
  if (high <= 30) return prefix + "Deep enough to stall most cars";
  if (high <= 60) return prefix + "Deep enough to float many vehicles";
  return prefix + "Deep enough to sweep vehicles away";
}

export function range(low: number | null, high: number | null) {
  if (high === null) return "Depth unknown";
  if (low === null || low === high) return `up to ${Math.round(high)} cm`;
  return `${Math.round(low)}–${Math.round(high)} cm`;
}

export const inches = (cm: number) => Math.round(cm / 2.54);

// The replay is Houston; show local time so the timeline matches news reports.
const TZ = "America/Chicago";
const fmt = (iso: string | number, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, ...o });
export const fmtTime = (iso: string, withDay = true) =>
  fmt(iso, { ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}), hour: "numeric", minute: "2-digit", timeZoneName: "short" });
export const fmtClock = (t: number) => fmt(t, { hour: "numeric", minute: "2-digit" });
export const fmtDay = (t: number) => fmt(t, { weekday: "short", month: "short", day: "numeric" });

export function fmtDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
