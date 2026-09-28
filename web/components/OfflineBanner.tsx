"use client";
import { OFFLINE_BANNER, useOffline } from "@/lib/fallback";

// Persistent, impossible-to-miss banner shown whenever the live backend is unreachable and the
// app has fallen back to the committed replay snapshot (web/lib/fallback.ts). Never shown in mock
// mode (useOffline() is always false there).
export default function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div role="alert" className="bg-danger-soft text-danger text-center text-xs py-1.5 px-4 font-medium">
      {OFFLINE_BANNER}
    </div>
  );
}
