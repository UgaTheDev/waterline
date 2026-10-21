"use client";
import { useState } from "react";
import { mediaUrl, type Evidence, type SegmentState, type Vehicle } from "@/lib/api";
import { PALETTE, bandFor, describe, fmtTime, range } from "@/lib/depth";
import { useLang, useT, vehicleName, type Key, type T } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { Selection } from "./Route";
import { SimulationPlayer, useSimulations } from "./Simulation";
import VehicleGauge, { VEHICLES, isBlocked, refHeight, useRising } from "./VehicleGauge";

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

// The model returns the reference object's name, not where it is in the photo. So the "reference top / waterline / N cm dry"
// bracket is a schematic beside the photo, at the object's typical height, never a box or line drawn on the picture.
function RefSchematic({ refName, refCm, depthCm }: { refName: string; refCm: number; depthCm: number }) {
  const t = useT();
  const H = 196;
  const top = Math.max(refCm, depthCm) * 1.25;
  const y = (cm: number) => H - 14 - (cm / top) * (H - 28);
  const gapCm = Math.round(refCm - depthCm);
  return (
    <figure className="w-[104px] shrink-0 flex flex-col">
      <svg viewBox={`0 0 104 ${H}`} className="w-full h-[196px]" role="img" aria-label={t("evd.schematicAria", { ref: refName, h: refCm, n: Math.round(depthCm) })}>
        <rect x="58" y={y(refCm)} width="16" height={y(0) - y(refCm)} rx="2" fill="var(--panel-2)" stroke="var(--line-strong)" strokeDasharray="3 2" />
        <rect x="0" y={y(depthCm)} width="104" height={y(0) - y(depthCm)} fill="var(--water)" opacity="0.6" />
        <line x1="0" x2="104" y1={y(depthCm)} y2={y(depthCm)} stroke="var(--text)" strokeWidth="1.5" strokeDasharray="4 3" />
        <line x1="50" x2="82" y1={y(refCm)} y2={y(refCm)} stroke="var(--accent)" strokeWidth="1.5" />
        <path d={`M84 ${y(refCm)} h6 V${y(depthCm)} h-6`} fill="none" stroke="var(--accent)" strokeWidth="1.2" />
        <text x="2" y={y(refCm) - 4} fontSize="9.5" fill="var(--accent)" fontFamily="var(--font-plex-mono)">
          {t("evd.refTop", { n: refCm })}
        </text>
        <text x="2" y={y(depthCm) + 12} fontSize="9.5" fill="var(--text)" fontFamily="var(--font-plex-mono)">
          {t("evd.water", { n: Math.round(depthCm) })}
        </text>
        <line x1="0" x2="104" y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth="1" />
      </svg>
      <figcaption className="mt-1 leading-snug">
        <span className="block font-mono text-[11px] font-semibold text-accent">{gapCm >= 0 ? t("evd.dry", { n: gapCm }) : t("evd.over", { n: -gapCm })}</span>
        <span className="block font-mono text-[10px] text-faint">{t("evd.schematic", { ref: refName })}</span>
      </figcaption>
    </figure>
  );
}

const confWord = (c: number): Key => (c < 0.4 ? "evd.confLow" : c < 0.6 ? "evd.confMed" : c < 0.8 ? "evd.confMedHigh" : "evd.confHigh");

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
          {/* The API gives the reading, not the waterline's pixel position, so this is a text readout: nothing is drawn on the photo. */}
          <figcaption className="absolute inset-x-0 bottom-0 pt-8 pb-2 px-2.5 bg-gradient-to-t from-black/80 to-transparent">
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
  nearby?: number; // other streets with observed water within 200 m (corroboration), computed from the loaded map
  onOpen?: (s: Selection) => void;
  onClose: () => void;
}) {
  const { name, state, low, high, evidence, vehicle, sources = [], nearby, onOpen, onClose } = props;
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

  // Every vehicle class, with the user's from /config taking precedence over the backend-default list.
  // rescue is responder-only (/responder); the public card compares the three vehicles people drive
  const fleet = VEHICLES.filter((v) => v.id !== "rescue").map((v) => (v.id === vehicle?.id ? vehicle : v));
  // The gauge and the blocked count use the conservative upper bound (high_cm), the same number routing uses.
  const est = latest?.depth_cm ?? high;
  const p = useRising(unknown ? 0 : 1);
  const nBlocked = fleet.filter((v) => isBlocked(unknown ? null : high, v.limit_cm)).length;
  const hasPhoto = !!latest?.image_url && latest.kind !== "dashcam" && latest.kind !== "voice";
  const refCm = refHeight(latest?.reference);

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
            <h3 className="text-[18px] font-semibold leading-tight text-text">{name ?? t("unnamed")}</h3>
            <p className="text-[12.5px] text-muted mt-0.5">
              {t(inferred ? "ev.inferredHead" : "ev.streetReport")}
              {evidence.length > 1 && ` · ${t("evd.latestOf", { n: evidence.length })}`}
              {nearby ? ` · ${t("evd.nearby", { n: nearby })}` : ""}
            </p>
            <p className="text-[13px] mt-1 flex items-center gap-2" style={{ color }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
              {describe(state, high, t)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("ev.close")}
            className="shrink-0 text-faint hover:text-text w-9 h-9 -mr-1 -mt-1 rounded-full border border-line hover:bg-panel-2 text-xl leading-none"
          >
            ×
          </button>
        </header>

        {hasPhoto && (
          <div className="flex gap-3 items-start">
            <div className="flex-1 min-w-0">
              <EvidenceItem ev={latest} photoOnly />
            </div>
            {refCm !== null && !unknown && est !== null && <RefSchematic refName={latest.reference!} refCm={refCm} depthCm={est} />}
          </div>
        )}

        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span className="font-mono text-[38px] leading-none font-semibold tabular-nums" style={{ color }}>
            {unknown ? "?" : `${Math.round(p * (est ?? 0))} cm`}
          </span>
          <span className="font-mono text-[15px] text-muted">· {unknown ? t("ev.unreadable") : t("evd.range", { r: range(low, high, t) })}</span>
        </div>

        {latest && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className={(latest.reference?.length ?? 0) > 26 ? "col-span-2" : ""}>
              <p className="eyebrow">{t("evd.reference")}</p>
              <p className="text-[14px] text-text mt-1">
                {latest.reference ? (refCm !== null ? `${latest.reference} · ${refCm} cm` : latest.reference) : t("ev.noRefFrame")}
              </p>
            </div>
            <div>
              <p className="eyebrow">{t(inferred ? "ev.asOf" : latest.kind === "survey" ? "evd.peak" : "evd.taken")}</p>
              <p className="font-mono text-[14px] text-text mt-1">{fmtTime(latest.time, false, lang)}</p>
            </div>
            <div className="col-span-2">
              <p className="eyebrow">{t("source")}</p>
              <p className="text-[13px] text-text mt-1">{sourceLabel(latest, t)}</p>
            </div>
            {latest.location_precision && latest.location_precision !== "exact" && (
              <p className="col-span-2 text-[12.5px] text-warn">{t("ev.approx", { p: latest.location_precision })}</p>
            )}
            {latest.confidence !== null && (
              <div className="col-span-2">
                <p className="eyebrow flex justify-between gap-2">
                  <span>{t("ev.confidence")}</span>
                  <span className="text-text">
                    {latest.confidence.toFixed(2)} · {t(confWord(latest.confidence))}
                  </span>
                </p>
                <div className="h-1.5 rounded-full bg-line mt-1.5 overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${Math.round(latest.confidence * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        <section className="rounded-xl border border-line p-3 flex flex-col gap-2" aria-label={t("evd.vehiclesAria")}>
          <div className="flex justify-between gap-2">
            <span className="eyebrow">{unknown ? t("evd.vehiclesUnknown") : t("evd.vehiclesAt", { n: Math.round(high ?? 0) })}</span>
            <span className={`font-mono text-[11px] ${nBlocked ? "text-danger" : "text-muted"}`}>{t("evd.blocked", { n: nBlocked })}</span>
          </div>
          <VehicleGauge
            depthCm={p * (high ?? 0)}
            unknown={unknown}
            range={!unknown && low !== null && high !== null ? [low, high] : null}
            vehicles={fleet}
            selected={vehicle?.id}
            lim
          />
        </section>
        {verdict && <p className="text-[13px] text-text leading-snug">{verdict}</p>}

        {latest ? (
          <>
            {latest.rationale && <p className="text-[13px] text-muted leading-relaxed">{latest.rationale}</p>}
            <p className="text-[11.5px] leading-snug text-muted">
              {latest.credit ? t("ev.credit", { c: latest.credit }) : t("ev.noCredit")}
              {hasPhoto && (latest.kind ?? "photo") === "photo" && latest.reference && ` · ${t("evd.readBy")}`}
              {latest.source_url && (
                <>
                  {" · "}
                  <a href={latest.source_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-text">
                    {t("ev.sourceLink")}
                  </a>
                </>
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">{t("ev.none")}</p>
        )}

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
