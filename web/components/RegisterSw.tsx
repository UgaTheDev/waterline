"use client";
import { useEffect } from "react";

// Registers the app-shell + snapshot cache (public/sw.js) so a reload works offline. No-op if the
// browser doesn't support service workers (e.g. some in-app browsers).
export default function RegisterSw() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
