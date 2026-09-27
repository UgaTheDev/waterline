"use client";
import type { RiskProps } from "@/lib/api";

// The risk layer is a forecast of where water may collect next, from rain and terrain. It is never a depth and never "dry".
export const RISK_LABEL = "Risk estimate, not a depth report";

const num = (v: number | null, unit: string, digits = 0) => (v === null ? "not available" : `${v.toFixed(digits)} ${unit}`);

export default function RiskCard({ risk, onClose }: { risk: RiskProps; onClose: () => void }) {
  const d = risk.drivers;
  const rows = [
    ["Rain, last 3 h", num(d.rain_3h_mm, "mm")],
    ["Depression depth", num(d.depression_cm, "cm")],
    ["Height above nearest waterway", num(d.hand_m, "m", 1)],
  ];
  return (
    <article className="rise bg-panel rounded-xl border border-line shadow-[var(--shadow)] w-full max-h-full overflow-y-auto" aria-label={`Flood risk for ${risk.name ?? "street"}`}>
      <div className="h-1 rounded-t-xl" style={{ background: "repeating-linear-gradient(90deg, var(--muted) 0 2px, transparent 2px 6px)" }} />
      <div className="p-4 space-y-3.5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Flood risk next hour</p>
            <h3 className="font-display text-[26px] leading-tight text-text">{risk.name ?? "Unnamed street"}</h3>
            <p className="text-[13px] mt-1 flex items-center gap-2 text-text">
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider ${risk.band === "high" ? "border-text/60" : "border-line-strong text-muted"}`}>
                {risk.band === "high" ? "High risk" : "Elevated risk"}
              </span>
              <span className="font-mono text-[12px] text-muted tabular-nums">{Math.round(risk.risk * 100)} / 100</span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Close risk estimate" className="text-faint hover:text-text w-8 h-8 -mr-1 -mt-1 rounded-md hover:bg-panel-2 text-xl leading-none">
            ×
          </button>
        </header>
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-[12.5px] text-text">{RISK_LABEL}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="eyebrow self-center">{k}</dt>
              <dd className="font-mono text-[12.5px] text-text tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12.5px] text-muted leading-relaxed">
          Heavy recent rain over low ground near a bayou makes water likely to collect here. Nobody has measured it. A low or missing risk does not mean the
          street is dry; check the depth reports and look before you drive.
        </p>
      </div>
    </article>
  );
}
