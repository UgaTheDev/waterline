"use client";
import { useSyncExternalStore } from "react";

// Falls back to the static replay snapshot (web/public/snapshot/, built by scripts/export_snapshot.py)
// when the live backend is unreachable: a network error, a 5xx, or no response within 8 s. Never
// engages in mock mode. api.ts imports this module, so these two constants are read from
// process.env directly here rather than imported from api.ts, to avoid a circular import.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "1";
const TIMEOUT_MS = 8000;
const RETRY_MS = 60000;
// Fallback when no event was picked; must match backend/events.py DEFAULT (every event has a snapshot).
const SNAPSHOT_EVENT = "harvey2017";

let offline = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const useOffline = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => offline,
    () => false,
  );

export const isOffline = () => !USE_MOCK && offline;

export const OFFLINE_BANNER =
  "Live service unavailable: showing the archived replay. Routing, chat, uploads and Drive mode are paused.";
export const paused = (feature: string) => `${feature} is paused: the live service is unavailable (showing the archived replay).`;

let retryTimer: ReturnType<typeof setInterval> | null = null;

function goOffline() {
  if (offline || USE_MOCK || retryTimer) return;
  offline = true;
  notify();
  retryTimer = setInterval(async () => {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const r = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
      clearTimeout(id);
      if (!r.ok) return;
      offline = false;
      if (retryTimer) clearInterval(retryTimer);
      retryTimer = null;
      notify();
    } catch {
      /* still down; try again in RETRY_MS */
    }
  }, RETRY_MS);
}

// A GET/POST with an 8 s timeout. Throws (and flips `offline` on) on a network error, a 5xx, or a
// timeout; an AbortError from the caller's own signal (e.g. React effect cleanup) passes through
// unchanged, since that's a cancel, not the backend being down.
// timeoutMs: model-backed calls (chat, uploads, dashcam) take 5-60 s; a slow answer must not flip the site offline.
export async function liveFetch(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  init?.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(API_BASE + path, { ...init, signal: ctrl.signal });
    if (r.status >= 500) throw new Error(`server error (${r.status})`);
    return r;
  } catch (e) {
    if ((e as Error).name === "AbortError" && init?.signal?.aborted) throw e;
    goOffline();
    throw e;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", onAbort);
  }
}

function currentSnapshotEvent(): string {
  try {
    return sessionStorage.getItem("wl-event") || SNAPSHOT_EVENT;
  } catch {
    return SNAPSHOT_EVENT;
  }
}

type Index = { event: string; times: string[] };
let indexCache: Promise<Index | null> | null = null;
function loadIndex(): Promise<Index | null> {
  if (!indexCache)
    indexCache = fetch(`/snapshot/${currentSnapshotEvent()}/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  return indexCache;
}

function nearest(times: string[], t?: string | null) {
  if (!t) return times[times.length - 1];
  const target = new Date(t).getTime();
  return times.reduce((best, cur) => (Math.abs(new Date(cur).getTime() - target) < Math.abs(new Date(best).getTime() - target) ? cur : best));
}

export type SnapshotKind = "config" | "events" | "eval" | "segments" | "alerts";

// The static snapshot for a GET the live backend would have served, or null when this replay
// event has no snapshot (nothing to fall back to).
export async function snapshotGet<T>(kind: SnapshotKind, t?: string | null): Promise<T | null> {
  const idx = await loadIndex();
  if (!idx) return null;
  const path =
    kind === "segments" || kind === "alerts"
      ? `/snapshot/${idx.event}/${kind}/${nearest(idx.times, t).replace(/:/g, "-")}.json`
      : `/snapshot/${idx.event}/${kind}.json`;
  const r = await fetch(path);
  return r.ok ? ((await r.json()) as T) : null;
}
