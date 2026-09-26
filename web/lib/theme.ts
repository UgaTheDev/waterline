"use client";
import { useSyncExternalStore } from "react";

// Dark is the default; the choice is a per-viewer convenience, so storage failures are ignored.
export type Theme = "dark" | "light";
const KEY = "waterline-theme";
const listeners = new Set<() => void>();

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  listeners.forEach((l) => l());
}

const read = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useTheme = () => useSyncExternalStore(subscribe, read, () => "dark" as Theme);

// Runs in <head> before paint so the page never flashes the wrong theme.
export const themeBootScript = `try{var t=localStorage.getItem("${KEY}");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

const motionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");
export const useReducedMotion = () =>
  useSyncExternalStore(
    (l) => {
      const q = motionQuery();
      q.addEventListener("change", l);
      return () => q.removeEventListener("change", l);
    },
    () => motionQuery().matches,
    () => false,
  );
