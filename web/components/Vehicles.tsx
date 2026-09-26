"use client";
import type { Vehicle } from "@/lib/api";

// Side profiles drawn to one scale (CM units per cm) so a waterline at N cm sits where it would on the real vehicle.
export const CM = 0.37;
const GROUND = 96;

type Shape = { body: string; glass: string; wheels: [number, number, number][] };
const SHAPES: Record<string, Shape> = {
  sedan: {
    body: "M8 82 L12 69 Q14 64 23 63 L62 60 L86 44 Q90 42 97 42 L132 42 Q139 42 143 46 L163 60 L196 63 Q205 64 207 71 L208 82 Q208 85 204 85 L12 85 Q8 85 8 82 Z",
    glass: "M92 47 L130 47 Q135 47 138 50 L151 59 L77 59 Z",
    wheels: [[52, 83, 13], [165, 83, 13]],
  },
  suv: {
    body: "M8 82 L10 63 Q12 56 21 55 L56 53 L74 33 Q77 30 85 30 L188 30 Q196 30 198 38 L204 56 Q208 58 208 66 L208 82 Q208 86 204 86 L12 86 Q8 86 8 82 Z",
    glass: "M80 36 L184 36 Q190 36 191 41 L195 53 L64 53 Z",
    wheels: [[52, 82, 14], [168, 82, 14]],
  },
  truck: {
    body: "M6 80 L8 61 Q10 54 19 54 L54 52 L68 29 Q71 26 78 26 L112 26 Q118 26 118 32 L118 52 L208 52 Q212 52 212 56 L212 80 Q212 84 208 84 L10 84 Q6 84 6 80 Z",
    glass: "M73 32 L112 32 L112 50 L61 50 Z",
    wheels: [[50, 81, 15], [172, 81, 15]],
  },
};
export const shapeFor = (id: string) => SHAPES[id] ?? SHAPES.sedan;

export function VehicleSilhouette({
  id,
  waterCm,
  lowCm,
  highCm,
  limitCm,
  unknown,
  animate = true,
  className = "",
}: {
  id: string;
  waterCm: number | null;
  lowCm?: number | null;
  highCm?: number | null;
  limitCm?: number;
  unknown?: boolean;
  animate?: boolean;
  className?: string;
}) {
  const s = shapeFor(id);
  const yAt = (cm: number) => Math.max(4, GROUND - Math.min(cm, 240) * CM);
  const top = waterCm === null ? null : yAt(waterCm);
  const band = lowCm != null && highCm != null && highCm > lowCm ? [yAt(highCm), yAt(lowCm)] : null;
  const limitY = limitCm === undefined ? null : yAt(limitCm);
  const clip = `veh-${id}`;
  return (
    <svg viewBox="0 0 220 100" className={className} aria-hidden>
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="0" width="220" height={GROUND} />
        </clipPath>
        <pattern id="unknown-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" fill="var(--water)" />
        </pattern>
      </defs>
      <path d={s.body} fill="var(--line-strong)" />
      <path d={s.glass} fill="var(--panel-2)" opacity="0.9" />
      {s.wheels.map(([cx, cy, r]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r={r} fill="var(--bg)" stroke="var(--line-strong)" strokeWidth="2.5" />
          <circle cx={cx} cy={cy} r={r * 0.42} fill="var(--line-strong)" />
        </g>
      ))}
      <line x1="0" x2="220" y1={GROUND} y2={GROUND} stroke="var(--faint)" strokeWidth="1" />
      {unknown && (
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y={GROUND - 22} width="220" height="22" fill="url(#unknown-hatch)" />
        </g>
      )}
      {top !== null && (
        <g clipPath={`url(#${clip})`} className={animate ? "water-rise" : ""}>
          {band && <rect x="0" y={band[0]} width="220" height={band[1] - band[0]} fill="var(--water)" opacity="0.35" />}
          <rect x="0" y={top} width="220" height={GROUND - top} fill="var(--water)" />
          <line x1="0" x2="220" y1={top} y2={top} stroke="var(--water-line)" strokeWidth="1.5" />
        </g>
      )}
      {limitY !== null && (
        <g>
          <line x1="0" x2="220" y1={limitY} y2={limitY} stroke="var(--warn)" strokeWidth="1.2" strokeDasharray="4 3" />
          <text x="218" y={limitY - 3} textAnchor="end" fontSize="9" fill="var(--warn)" fontFamily="var(--font-plex-mono)">
            limit {limitCm}
          </text>
        </g>
      )}
    </svg>
  );
}

export function VehiclePicker({ vehicles, value, onChange }: { vehicles: Vehicle[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Vehicle">
      {vehicles.map((v) => {
        const on = v.id === value;
        return (
          <button
            key={v.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v.id)}
            className={`group relative rounded-lg border px-2 pt-2 pb-1.5 text-left transition-all duration-300 ${
              on ? "border-accent bg-accent-soft" : "border-line bg-panel-2 hover:border-line-strong"
            }`}
          >
            <VehicleSilhouette key={String(on)} id={v.id} waterCm={on ? v.limit_cm : null} animate={on} className={`w-full h-auto transition-opacity ${on ? "" : "opacity-70 group-hover:opacity-100"}`} />
            <span className={`block text-[12.5px] font-medium mt-1 ${on ? "text-text" : "text-muted"}`}>{v.label}</span>
            <span className="block font-mono text-[10.5px] text-faint">limit {v.limit_cm} cm</span>
          </button>
        );
      })}
    </div>
  );
}
