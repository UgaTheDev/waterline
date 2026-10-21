import type { SegmentState } from "./api";
import type { Theme } from "./theme";
import { translate, type Key, type Lang, type T } from "./i18n";

const EN: T = (k, v) => translate("en", k, v);

// Bands and wording per backend/API.md. Never say "safe": shallow reads "No deep water reported".
export type Band = "shallow" | "stall" | "float" | "sweep" | "unknownDepth" | "stale";

export const PALETTE: Record<Theme, Record<Band | "route" | "routeCasing" | "alert" | "risk", string>> = {
  // Bands double as text colour on cards/readouts (not just map/legend swatches), so every entry
  // is AA (>=4.5:1) against both --bg and --panel in its theme. Hue is unchanged; only lightness moved.
  dark: {
    shallow: "#facc15",
    stall: "#fb923c",
    float: "#ff4d5e",
    sweep: "#fa0040", // was #a3002a (2.4:1 on --bg, unreadable as text)
    unknownDepth: "#fa0040", // = sweep (design handoff 2026-10-20): unknown depth blocks every vehicle, so it looks like the deepest water; a "?" marks it
    stale: "#6d7e96", // was #64748b (4.15:1, just under 4.5)
    route: "#67e8f9",
    routeCasing: "#04151b",
    alert: "#fb7185",
    risk: "#e2e8f0", // a neutral haze: never a depth colour, never green
  },
  light: {
    shallow: "#936403", // was #ca8a04 (2.6:1 on --bg)
    stall: "#b9460a", // was #ea580c (3.1:1 on --bg)
    float: "#d12222", // was #dc2626 (4.24:1, just under 4.5)
    sweep: "#7f1d1d",
    unknownDepth: "#7f1d1d", // = sweep, see dark
    stale: "#5a6d87", // was #94a3b8 (2.25:1 on --bg)
    route: "#0e7490",
    routeCasing: "#ffffff",
    alert: "#be123c",
    risk: "#334155",
  },
};

// label and note are i18n keys where they are words; numeric labels stay as they are.
export const LEGEND: { band: Band; label: string | Key; note: Key }[] = [
  { band: "shallow", label: "≤ 15 cm", note: "lg.shallow" },
  { band: "stall", label: "15–30", note: "lg.stall" },
  { band: "float", label: "30–60", note: "lg.float" },
  { band: "sweep", label: "> 60", note: "lg.sweep" },
  { band: "unknownDepth", label: "lg.waterLabel", note: "lg.unknownDepth" },
  { band: "stale", label: "lg.oldLabel", note: "lg.stale" },
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

export function describe(state: SegmentState, high: number | null, t: T = EN) {
  if (state === "unknown") return t("d.none");
  if (state === "reported_unknown" || high === null) return t("d.unknown");
  const prefix = state === "stale" ? t("d.lastKnown") : "";
  if (high <= 15) return prefix + t("d.shallow");
  if (high <= 30) return prefix + t("d.stall");
  if (high <= 60) return prefix + t("d.float");
  return prefix + t("d.sweep");
}

export function range(low: number | null, high: number | null, t: T = EN) {
  if (high === null) return t("d.rangeUnknown");
  if (low === null || low === high) return t("d.upTo", { n: Math.round(high) });
  return `${Math.round(low)}–${Math.round(high)} cm`;
}

export const inches = (cm: number) => Math.round(cm / 2.54);

// The replay is Houston; show local time so the timeline matches news reports.
const TZ = "America/Chicago";
const fmt = (iso: string | number, o: Intl.DateTimeFormatOptions, lang: Lang = "en") =>
  new Date(iso).toLocaleString(lang === "es" ? "es-US" : "en-US", { timeZone: TZ, ...o });
export const fmtTime = (iso: string, withDay = true, lang: Lang = "en") =>
  fmt(iso, { ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}), hour: "numeric", minute: "2-digit", timeZoneName: "short" }, lang);
export const fmtClock = (t: number) => fmt(t, { hour: "numeric", minute: "2-digit" });
export const fmtDay = (t: number, lang: Lang = "en") => fmt(t, { weekday: "short", month: "short", day: "numeric" }, lang);
// Timeline labels. es-US reads "lun, 28 de ago", so it gets its own shapes; clocks stay en-US to fit the timeline box.
export const fmtDate = (t: number, lang: Lang = "en") => (lang === "es" ? fmt(t, { month: "short", day: "numeric" }, "es") : fmtDay(t).replace(/^\w+, /, ""));
export const fmtTick = (t: number, lang: Lang = "en") => (lang === "es" ? fmt(t, { weekday: "short", day: "numeric" }, "es") : fmtDay(t).replace(/,.* /, " "));

export function fmtDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
