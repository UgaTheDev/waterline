"use client";
import { useT, type Key } from "@/lib/i18n";
import { useRising } from "./VehicleGauge";

// Real objects of known height, the same ones the depth model reads against (backend/depth.py).
const OBJECTS: [number, Key][] = [
  [15, "rul.curb"],
  [30, "rul.sill"],
  [65, "rul.tire"],
  [75, "rul.hydrant"],
];
const MAX = 90;
const pct = (cm: number) => `${(Math.min(cm, MAX) / MAX) * 100}%`;

// Desktop left-rail ruler: water filled to the selected street's depth (the conservative high_cm).
// depthCm null + unknown: water reported but unreadable, drawn full and hatched like the deepest water. null alone: nothing selected.
export default function DepthRuler({ depthCm, unknown = false }: { depthCm: number | null; unknown?: boolean }) {
  const t = useT();
  const d = useRising(unknown || depthCm === null ? 0 : depthCm);
  return (
    <section className="flex flex-col gap-3" aria-label={t("rul.title")}>
      <span className="eyebrow">{t("rul.title")}</span>
      <div className="relative h-[150px] ml-7 border-l border-line-strong">
        {unknown ? (
          <div className="dr-unknown absolute inset-0" />
        ) : (
          depthCm !== null && <div className="dr-water absolute inset-x-0 bottom-0" style={{ height: pct(d) }} />
        )}
        {OBJECTS.map(([cm, k]) => (
          <div key={cm} className="absolute inset-x-0 flex justify-between border-t border-dashed border-line-strong" style={{ bottom: pct(cm) }}>
            <span className="font-mono text-[10.5px] text-muted -mt-2 -ml-[30px]">{cm}</span>
            <span className="text-[12px] text-text -mt-[9px] bg-panel pl-1.5">{t(k)}</span>
          </div>
        ))}
        <span
          className="absolute left-2 font-mono text-[11px] font-semibold bg-panel px-1 rounded-sm"
          style={{ bottom: unknown ? "6px" : `min(calc(${pct(d)} + 6px), calc(100% - 22px))`, color: unknown ? "var(--danger)" : "var(--accent)" }}
        >
          {unknown ? t("rul.unknown") : depthCm === null ? t("rul.none") : t("rul.at", { n: Math.round(depthCm) })}
        </span>
      </div>
    </section>
  );
}
