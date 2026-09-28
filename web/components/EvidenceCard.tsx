"use client";
import { useState } from "react";
import { mediaUrl, type Evidence, type SegmentState, type Vehicle } from "@/lib/api";
import { PALETTE, THRESHOLDS, bandFor, describe, fmtTime, inches, range } from "@/lib/depth";
import { useLang, useT, vehicleName, type Key, type T } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { Selection } from "./Route";
import { SimulationPlayer, useSimulations } from "./Simulation";
import { VehicleSilhouette } from "./Vehicles";

const SOURCE: Record<NonNullable<Evidence["kind"]>, Key> = {
  photo: "ev.photo",
  survey: "ev.survey",
  dashcam: "ev.dashcam",
  voice: "ev.voice",
  inferred: "ev.inferred",
  report311: "ev.report311",
};

const nReports = (ev: Evidence) => ev.provenance?.derived_from.length ?? 0;
export const sourceLabel = (ev: Evidence, t: T) =>
  ev.kind === "inferred" && nReports(ev)
    ? nReports(ev) === 1
      ? t("ev.inferred1")
      : t("ev.inferredN", { n: nReports(ev) })
    : t(SOURCE[ev.kind ?? "photo"] ?? SOURCE.photo);

function DepthGauge({ low, high, color }: { low: number | null; high: number | null; color: string }) {
  const H = 132;
  const max = Math.max(90, (high ?? 0) + 10);
  const y = (cm: number) => H - (Math.min(cm, max) / max) * H;
  return (
    <svg viewBox={`0 0 64 ${H + 8}`} className="w-16 h-auto shrink-0" aria-hidden>
      <rect x="22" y="4" width="10" height={H} rx="2" fill="var(--panel-2)" stroke="var(--line)" />
      {high !== null && (
        <g className="water-rise" style={{ transformOrigin: `27px ${H + 4}px` }}>
          <rect x="22" y={y(high) + 4} width="10" height={H - y(high)} rx="2" fill={color} opacity="0.28" />
          <rect x="22" y={y(high) + 4} width="10" height={Math.max(2, y(low ?? high) - y(high))} fill={color} />
        </g>
      )}
      {THRESHOLDS.map((cm) => (
        <g key={cm}>
          <line x1="18" x2="36" y1={y(cm) + 4} y2={y(cm) + 4} stroke="var(--muted)" strokeWidth="1" />
          <text x="40" y={y(cm) + 7} fontSize="8.5" fill="var(--muted)" fontFamily="var(--font-plex-mono)">
            {cm}
          </text>
          <text x="15" y={y(cm) + 7} fontSize="7.5" fill="var(--faint)" textAnchor="end" fontFamily="var(--font-plex-mono)">
            {inches(cm)}″
          </text>
        </g>
      ))}
      {high !== null && <path d={`M34 ${y(high) + 4} l6 -4 v8 z`} fill={color} />}
    </svg>
  );
}

export function EvidenceItem({
  ev,
  compact = false,
  photoOnly = false,
  noPhoto = false,
}: {
  ev: Evidence;
  compact?: boolean;
  photoOnly?: boolean;
  noPhoto?: boolean;
}) {
  const [imgOk, setImgOk] = useState(true);
  const t = useT();
  const lang = useLang();
  // Dashcam frames are never stored and voice reports have no picture, whatever the payload says.
  const photo = ev.image_url && imgOk && !noPhoto && ev.kind !== "dashcam" && ev.kind !== "voice";
  return (
    <div className="space-y-2.5">
      {photo && (
        <figure className="relative overflow-hidden rounded-md border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element -- media is served by the backend, not Next */}
          <img
            src={mediaUrl(ev.image_url!)}
            alt={ev.reference ? t("ev.photoAltRef", { ref: ev.reference }) : t("ev.photoAlt")}
            className="w-full max-h-52 object-cover bg-panel-2"
            onError={() => setImgOk(false)}
          />
          {/* The API gives the reading, not the waterline's pixel position, so this is a labelled readout, not a marker. */}
          <figcaption className="absolute inset-x-0 bottom-0 pt-8 pb-2 px-2.5 bg-gradient-to-t from-black/80 to-transparent">
            <span className="block border-t border-dashed border-[var(--water-line)] mb-1.5" aria-hidden />
            <span className="flex justify-between gap-2 font-mono text-[10.5px] text-white">
              <span>{t("ev.waterline", { ref: ev.reference ?? t("ev.noRef") })}</span>
              <span className="text-[var(--water-line)]">{range(ev.low_cm, ev.high_cm, t)}</span>
            </span>
          </figcaption>
        </figure>
      )}
      {!photoOnly && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="eyebrow self-center">{t("source")}</dt>
            <dd className="text-[12.5px] text-text">
              {sourceLabel(ev, t)}
            </dd>
            <dt className="eyebrow self-center">{t("ev.depth")}</dt>
            <dd className="font-mono text-text tabular-nums">{range(ev.low_cm, ev.high_cm, t)}</dd>
            {ev.kind !== "voice" && ev.kind !== "inferred" && ev.kind !== "report311" && (
              <>
                <dt className="eyebrow self-center">{t("ev.measuredOn")}</dt>
                <dd className="text-text">{ev.reference ?? t("ev.noRefFrame")}</dd>
              </>
            )}
            <dt className="eyebrow self-center">{t(ev.kind === "inferred" ? "ev.asOf" : "ev.observed")}</dt>
            <dd className="font-mono text-[12px] text-text">{fmtTime(ev.time, true, lang)}</dd>
            {ev.location_precision && ev.location_precision !== "exact" && (
              <>
                <dt className="eyebrow self-center">{t("ev.location")}</dt>
                <dd className="text-[12.5px] text-warn">{t("ev.approx", { p: ev.location_precision })}</dd>
              </>
            )}
            {ev.confidence !== null && (
              <>
                <dt className="eyebrow self-center">{t("ev.confidence")}</dt>
                <dd className="flex items-center gap-2">
                  <span className="h-1 w-20 rounded-full bg-panel-2 overflow-hidden">
                    <span className="block h-full bg-accent" style={{ width: `${Math.round(ev.confidence * 100)}%` }} />
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-muted">{Math.round(ev.confidence * 100)}%</span>
                </dd>
              </>
            )}
          </dl>
          {!compact && ev.rationale && <p className="text-[13px] text-muted leading-relaxed">{ev.rationale}</p>}
          <p className="font-mono text-[10.5px] text-faint">
            {ev.credit ? t("ev.credit", { c: ev.credit }) : t("ev.noCredit")}
            {ev.source_url && (
              <>
                {" · "}
                <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-muted">
                  {t("ev.sourceLink")}
                </a>
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

export default function EvidenceCard(props: {
  name: string | null;
  state: SegmentState;
  low: number | null;
  high: number | null;
  evidence: Evidence[];
  basis?: "observed" | "inferred";
  vehicle: Vehicle | undefined;
  sources?: Selection[]; // the reports an inferred street was interpolated from, when they're on the map
  onOpen?: (s: Selection) => void;
  onClose: () => void;
}) {
  const { name, state, low, high, evidence, vehicle, sources = [], onOpen, onClose } = props;
  const sims = useSimulations();
  const sim = name ? sims.find((s) => s.street === name) : undefined;
  const [showSim, setShowSim] = useState(false);
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const vName = vehicle ? vehicleName(t, lang, vehicle, true) : "";
  const band = bandFor(state, high);
  const color = PALETTE[theme][band];
  const [latest, ...earlier] = evidence;
  const unknown = state === "reported_unknown" || high === null;
  const inferred = props.basis === "inferred" || latest?.kind === "inferred";
  const verdict = !vehicle
    ? null
    : unknown
      ? t("ev.vUnknown")
      : state === "stale"
        ? t("ev.vStale")
        : t(high > vehicle.limit_cm ? "ev.vOver" : "ev.vUnder", { v: vName, n: vehicle.limit_cm });

  return (
    <article
      className="rise bg-panel rounded-xl border border-line shadow-[var(--shadow)] w-full max-h-full overflow-y-auto"
      aria-label={t("ev.aria", { name: name ?? t("street") })}
    >
      <div
        className="h-1 rounded-t-xl"
        style={{ background: inferred ? `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 10px)` : color }}
      />
      <div className="p-4 space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{t(inferred ? "ev.inferredHead" : "ev.streetReport")}</p>
            <h3 className="font-display text-[26px] leading-tight text-text">{name ?? t("unnamed")}</h3>
            <p className="text-[13px] mt-0.5 flex items-center gap-2" style={{ color }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
              {describe(state, high, t)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("ev.close")}
            className="text-faint hover:text-text w-8 h-8 -mr-1 -mt-1 rounded-md hover:bg-panel-2 text-xl leading-none"
          >
            ×
          </button>
        </header>

        {latest?.image_url && latest.kind !== "dashcam" && latest.kind !== "voice" && <EvidenceItem ev={latest} photoOnly />}

        <div className="flex items-end gap-3 rounded-lg border border-line bg-panel-2/60 p-3">
          <DepthGauge low={low} high={high} color={color} />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[26px] leading-none text-text tabular-nums">{unknown ? "?" : range(low, high, t).replace(" cm", "")}</p>
            <p className="eyebrow mt-1">{t(unknown ? "ev.unreadable" : "ev.range")}</p>
            <VehicleSilhouette
              id={vehicle?.id ?? "sedan"}
              waterCm={unknown ? null : (latest?.depth_cm ?? high)}
              lowCm={unknown ? null : low}
              highCm={unknown ? null : high}
              limitCm={vehicle?.limit_cm}
              unknown={unknown}
              className="w-full h-auto mt-2"
            />
            <p className="font-mono text-[10px] text-faint mt-1">{t("ev.key")}</p>
          </div>
        </div>
        {verdict && <p className="text-[13px] text-text leading-snug">{verdict}</p>}

        {latest ? <EvidenceItem ev={latest} noPhoto /> : <p className="text-sm text-muted">{t("ev.none")}</p>}

        {inferred && sources.length > 0 && (
          <div>
            <p className="eyebrow mb-1.5">{t("ev.sources")}</p>
            <ul className="flex flex-wrap gap-1.5">
              {sources.map((s) => (
                <li key={s.id ?? s.name}>
                  <button
                    onClick={() => onOpen?.(s)}
                    className="rounded-full border border-line px-2.5 py-1 text-[12px] text-text hover:border-line-strong hover:bg-panel-2 transition-colors"
                  >
                    {s.name ?? t("unnamed")} <span className="text-faint">&rarr;</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {earlier.length > 0 && (
          <details className="group">
            <summary className="eyebrow cursor-pointer list-none flex items-center gap-1.5 hover:text-muted">
              <span className="transition-transform group-open:rotate-90">›</span> {t("ev.earlier", { n: earlier.length })}
            </summary>
            <ol className="mt-2 space-y-1 border-l border-line pl-3">
              {earlier.slice(0, 8).map((ev) => (
                <li key={ev.obs_id} className="flex justify-between gap-3 font-mono text-[11.5px] text-muted">
                  <span>{fmtTime(ev.time, true, lang)}</span>
                  <span className="text-text tabular-nums">{range(ev.low_cm, ev.high_cm, t)}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>

      {sim && (
        <section className="border-t-2 border-dashed border-warn/40 bg-warn-soft p-4 space-y-2.5 rounded-b-xl" aria-label={t("ev.simAria")}>
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow text-warn!">{t("ev.simHead")}</p>
            <button
              onClick={() => setShowSim(!showSim)}
              aria-expanded={showSim}
              className="rounded-full border border-warn/50 px-3 py-1 text-[12px] text-text hover:bg-warn-soft transition-colors"
            >
              {t(showSim ? "ev.simHide" : "ev.simShow")}
            </button>
          </div>
          {showSim && <SimulationPlayer sim={sim} />}
        </section>
      )}
    </article>
  );
}
