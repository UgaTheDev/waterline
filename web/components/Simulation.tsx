"use client";
import { useEffect, useState } from "react";
import { api, mediaUrl, type Simulation } from "@/lib/api";
import { inches } from "@/lib/depth";

// Simulations are illustrations, never evidence: they live outside the evidence photo slot and always carry their label.
let cache: Promise<Simulation[]> | null = null;
export function useSimulations() {
  const [sims, setSims] = useState<Simulation[]>([]);
  useEffect(() => {
    cache ??= api.simulations().catch(() => {
      cache = null; // retry on the next mount
      return [];
    });
    let live = true;
    cache.then((s) => live && setSims(s));
    return () => {
      live = false;
    };
  }, []);
  return sims;
}

// A drawn poster (no photo), so nothing about it can pass for a real scene.
function poster(sim: Simulation) {
  const y = Math.max(120, 250 - Math.min(sim.depth_cm, 120) * 1.1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c1218"/><stop offset="1" stop-color="#111922"/></linearGradient><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b4a5c"/><stop offset="1" stop-color="#0a1c24"/></linearGradient></defs><rect width="640" height="360" fill="url(#s)"/><path d="M0 250 L250 150 L390 150 L640 250Z" fill="#1c2733"/><rect x="60" y="120" width="70" height="130" fill="#15202b"/><rect x="510" y="100" width="90" height="150" fill="#15202b"/><rect y="${y}" width="640" height="${360 - y}" fill="url(#w)" opacity="0.92"/><path d="M0 ${y} Q80 ${y - 5} 160 ${y} T320 ${y} T480 ${y} T640 ${y}" stroke="#7dd3fc" stroke-width="2" fill="none"/><text x="320" y="330" text-anchor="middle" font-family="monospace" font-size="15" fill="#8c99a8">${sim.street.replace(/[<&]/g, "")} at ${sim.depth_cm} cm, simulated</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function SimulationPlayer({ sim }: { sim: Simulation }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="space-y-1.5">
      <div className="relative overflow-hidden rounded-md border-2 border-dashed border-warn/60 bg-panel-2">
        <video
          src={mediaUrl(sim.video_url)}
          poster={poster(sim)}
          controls
          playsInline
          preload="none"
          onError={() => setFailed(true)}
          className="w-full aspect-video object-cover"
          aria-label={`${sim.label}. ${sim.street} at ${sim.depth_cm} cm.`}
        />
        {/* Always on top of the frame, never hidden by controls or fullscreen-less playback. */}
        <p className="pointer-events-none absolute inset-x-0 top-0 bg-black/75 px-2.5 py-1.5 font-mono text-[10.5px] leading-snug text-warn uppercase tracking-wide">
          {sim.label}
        </p>
      </div>
      <figcaption className="flex justify-between gap-2 font-mono text-[10.5px] text-faint">
        <span>
          {sim.street} · {sim.depth_cm} cm ({inches(sim.depth_cm)} in)
        </span>
        {failed && <span className="text-warn">clip not available</span>}
      </figcaption>
    </figure>
  );
}

export function SimulationGallery() {
  const sims = useSimulations();
  if (!sims.length)
    return (
      <div className="rounded-2xl border border-dashed border-line-strong bg-panel p-6">
        <p className="eyebrow">Simulations</p>
        <p className="text-[13px] text-muted mt-1">No simulated clips yet.</p>
      </div>
    );
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {sims.map((s) => (
        <SimulationPlayer key={s.id} sim={s} />
      ))}
    </div>
  );
}
