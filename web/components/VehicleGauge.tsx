"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Vehicle } from "@/lib/api";
import { useLang, useT, vehicleName } from "@/lib/i18n";

// Side profiles in centimetres (design handoff `V`): body polygon [x, height], wheel centres, wheel radius, length.
// Drawn at one true scale, so a waterline at N cm sits where it would on the real vehicle.
const V: Record<string, { len: number; r: number; w: number[]; b: [number, number][] }> = {
  sedan: { len: 460, r: 30, w: [90, 365], b: [[10, 30], [10, 75], [40, 90], [120, 95], [170, 140], [300, 143], [360, 100], [445, 88], [455, 45], [445, 30]] },
  suv: { len: 480, r: 38, w: [95, 385], b: [[10, 35], [10, 100], [25, 115], [80, 172], [360, 176], [400, 120], [470, 108], [478, 50], [465, 35]] },
  truck: { len: 560, r: 42, w: [110, 450], b: [[10, 45], [10, 118], [290, 118], [300, 190], [420, 192], [450, 125], [550, 115], [555, 55], [540, 45]] },
  rescue: { len: 700, r: 60, w: [150, 560], b: [[20, 95], [20, 300], [480, 300], [490, 290], [560, 290], [600, 200], [690, 180], [695, 100], [680, 95]] },
};

// Fallback only, for screens that render before /config: the same limits as backend/profiles.py. Pass config.vehicles when you have it.
export const VEHICLES: Vehicle[] = [
  { id: "sedan", label: "Sedan", limit_cm: 15 },
  { id: "suv", label: "SUV", limit_cm: 30 },
  { id: "truck", label: "Pickup truck", limit_cm: 45 },
  { id: "rescue", label: "High-water rescue truck", limit_cm: 90, responder_only: true },
];

// Handoff rule: blocked = depth > limit || depth unknown. Unknown blocks every vehicle, rescue included.
export const isBlocked = (depthCm: number | null, limitCm: number) => depthCm === null || depthCm > limitCm;

// Typical reference-object heights, as the depth prompt states them (backend/depth.py). null when the object is not one we know.
const REF_CM: [RegExp, number][] = [
  [/door sill/i, 30],
  [/hubcap/i, 33],
  [/hydrant/i, 75],
  [/\bt[iy]re/i, 65],
  [/\b(curb|kerb)/i, 15],
  [/knee/i, 50],
  [/waist/i, 100],
  [/stop.?sign/i, 210],
];
export const refHeight = (ref: string | null | undefined) => (ref ? (REF_CM.find(([re]) => re.test(ref))?.[1] ?? null) : null);

// cubic-bezier(.2,.7,.2,1). y'(s) >= 0 for these control points, so the value never overshoots: depth never "bounces" past its reading.
const cb = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
export function ease(t: number) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (cb(0.2, 0.2, m) < t) lo = m;
    else hi = m;
  }
  return cb(0.7, 1, (lo + hi) / 2);
}

// "Waterline rising": animates to target (from wherever it was) after `delay` ms, over `duration` ms.
// prefers-reduced-motion jumps straight to the final state.
export function useRising(target: number, delay = 120, duration = 780) {
  const [v, setV] = useState(0);
  const at = useRef(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = at.current;
    const t0 = performance.now() + (reduced ? 0 : delay);
    const dur = reduced ? 0 : duration;
    let raf = 0;
    const tick = (now: number) => {
      const p = dur ? Math.min(1, Math.max(0, (now - t0) / dur)) : 1;
      at.current = from + (target - from) * ease(p);
      setV(at.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delay, duration]);
  return v;
}

// Front ends of the vehicles at true scale against a water band. All geometry is in cm; the SVG scales to its box.
export default function VehicleGauge({
  depthCm,
  unknown = false,
  range,
  vehicles,
  selected,
  tone = "card",
  k = 0.5,
  crop = 146,
  H = 130,
  ticks = [],
  gap = 12,
  left = 0,
  lim = false,
}: {
  depthCm: number; // current (possibly animating) waterline; ignored when unknown
  unknown?: boolean;
  range?: [number, number] | null; // low..high, faded in at 40% after the rise
  vehicles: Vehicle[];
  selected?: string;
  tone?: "hero" | "card";
  k?: number; // px per cm at natural size
  crop?: number; // cm of each vehicle's front end shown
  H?: number; // cm of height shown
  ticks?: number[];
  gap?: number; // cm
  left?: number; // cm
  lim?: boolean; // dashed wading-limit line on each vehicle
}) {
  const t = useT();
  const lang = useLang();
  const uid = useId().replace(/:/g, "");
  const n = vehicles.length;
  const W = left + n * crop + (n - 1) * gap;
  const y = (c: number) => H - c;
  const d = unknown ? H : Math.max(0, depthCm);
  const ns = { vectorEffect: "non-scaling-stroke" } as const;
  const cols = [left, ...vehicles.flatMap((_, i) => (i ? [gap, crop] : [crop]))].map((c) => `${c}fr`).join(" ");

  return (
    <div className={`vg vg-${tone}`} style={{ maxWidth: W * k * 1.3 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`${uid}-w`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--vg-water)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--vg-water)" stopOpacity="0.1" />
          </linearGradient>
          <pattern id={`${uid}-h`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="10" fill="var(--vg-coral)" opacity="0.35" />
          </pattern>
          {vehicles.map((v, i) => (
            <clipPath key={v.id} id={`${uid}-c${i}`}>
              <rect x={left + i * (crop + gap)} y="0" width={crop} height={H} />
            </clipPath>
          ))}
        </defs>
        {vehicles.map((v, i) => {
          const s = V[v.id] ?? V.sedan;
          const b = unknown || isBlocked(d, v.limit_cm);
          const stroke = b ? "var(--vg-coral)" : "var(--vg-stroke)";
          const paint = { stroke, transition: "stroke 120ms, fill 120ms" };
          return (
            <g key={v.id} clipPath={`url(#${uid}-c${i})`}>
              <g transform={`translate(${left + i * (crop + gap) - (s.len - crop)} 0)`}>
                <polygon
                  points={s.b.map(([x, h]) => `${x},${y(h)}`).join(" ")}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  style={{ ...paint, fill: b ? "var(--vg-blockfill)" : "var(--vg-fill)" }}
                  {...ns}
                />
                {s.w.map((x) => (
                  <g key={x}>
                    <circle cx={x} cy={y(s.r)} r={s.r} fill="var(--vg-wheel)" strokeWidth="1.5" style={paint} {...ns} />
                    <circle cx={x} cy={y(s.r)} r={s.r * 0.42} fill="none" strokeWidth="1" opacity="0.6" style={paint} {...ns} />
                  </g>
                ))}
                {lim && (
                  <line x1={s.len - crop} x2={s.len} y1={y(v.limit_cm)} y2={y(v.limit_cm)} strokeWidth="1" strokeDasharray="3 3" opacity="0.85" style={{ ...paint, stroke: b ? "var(--vg-coral)" : "var(--vg-text)" }} {...ns} />
                )}
              </g>
            </g>
          );
        })}
        {unknown ? (
          <rect x="0" y="0" width={W} height={H} fill={`url(#${uid}-h)`} />
        ) : (
          <>
            {range && range[1] > range[0] && (
              <rect className="vg-band" x={Math.max(0, left - 4 / k)} y={y(range[1])} width={W} height={range[1] - range[0]} fill="var(--vg-water)" />
            )}
            {d > 0 && (
              <>
                <rect x={Math.max(0, left - 4 / k)} y={y(d)} width={W} height={d} fill={`url(#${uid}-w)`} />
                <line x1={Math.max(0, left - 4 / k)} x2={W} y1={y(d)} y2={y(d)} stroke="var(--vg-water)" strokeWidth="2" {...ns} />
              </>
            )}
          </>
        )}
        {ticks.map((c) => (
          <g key={c}>
            <line x1="0" x2={W} y1={y(c)} y2={y(c)} stroke="var(--vg-tick)" strokeWidth="1" strokeDasharray="3 3" {...ns} />
            <text x="0" y={y(c) - 3 / k} fontSize={10 / k} fill="var(--vg-label)" fontFamily="var(--font-plex-mono)">
              {c}
            </text>
          </g>
        ))}
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--vg-ground)" strokeWidth="1" {...ns} />
      </svg>
      <div className="grid mt-1.5" style={{ gridTemplateColumns: cols }}>
        <span />
        {vehicles.map((v, i) => {
          const b = unknown || isBlocked(d, v.limit_cm);
          return [
            i > 0 && <span key={`g${v.id}`} />,
            <div key={v.id} className="min-w-0">
              <div className="text-[11.5px] font-medium leading-tight" style={{ color: v.id === selected ? "var(--vg-selected)" : "var(--vg-text)" }}>
                {v.id === "rescue" ? t("vg.rescue") : vehicleName(t, lang, v)}
                {v.id === selected && <span className="sr-only"> ({t("evd.you")})</span>}
              </div>
              <div className="font-mono text-[10px] mt-px" style={{ color: b ? "var(--vg-coral)" : "var(--vg-label)", transition: "color 120ms" }}>
                {b ? t("vg.blocked", { n: v.limit_cm }) : t("veh.limitCm", { n: v.limit_cm })}
              </div>
            </div>,
          ];
        })}
      </div>
    </div>
  );
}
