"use client";
import type { RiskProps } from "@/lib/api";
import { useT } from "@/lib/i18n";

// The risk layer is a forecast of where water may collect next, from rain and terrain. It is never a depth and never "dry".
// Its label is the i18n key "risk.label": "Risk estimate, not a depth report".

export default function RiskCard({ risk, onClose }: { risk: RiskProps; onClose: () => void }) {
  const t = useT();
  const num = (v: number | null, unit: string, digits = 0) => (v === null ? t("risk.na") : `${v.toFixed(digits)} ${unit}`);
  const d = risk.drivers;
  const rows = [
    [t("risk.rain"), num(d.rain_3h_mm, "mm")],
    [t("risk.depression"), num(d.depression_cm, "cm")],
    [t("risk.hand"), num(d.hand_m, "m", 1)],
  ];
  return (
    <article className="rise bg-panel rounded-xl border border-line shadow-[var(--shadow)] w-full max-h-full overflow-y-auto" aria-label={t("risk.aria", { name: risk.name ?? t("street") })}>
      <div className="h-1 rounded-t-xl" style={{ background: "repeating-linear-gradient(90deg, var(--muted) 0 2px, transparent 2px 6px)" }} />
      <div className="p-4 space-y-3.5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{t("risk.toggle")}</p>
            <h3 className="font-display text-[26px] leading-tight text-text">{risk.name ?? t("unnamed")}</h3>
            <p className="text-[13px] mt-1 flex items-center gap-2 text-text">
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider ${risk.band === "high" ? "border-text/60" : "border-line-strong text-muted"}`}>
                {t(risk.band === "high" ? "risk.high" : "risk.elevated")}
              </span>
              <span className="font-mono text-[12px] text-muted tabular-nums">{Math.round(risk.risk * 100)} / 100</span>
            </p>
          </div>
          <button onClick={onClose} aria-label={t("risk.close")} className="text-faint hover:text-text w-8 h-8 -mr-1 -mt-1 rounded-md hover:bg-panel-2 text-xl leading-none">
            ×
          </button>
        </header>
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-[12.5px] text-text">{t("risk.label")}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="eyebrow self-center">{k}</dt>
              <dd className="font-mono text-[12.5px] text-text tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12.5px] text-muted leading-relaxed">
          {t("risk.body")}
        </p>
      </div>
    </article>
  );
}
