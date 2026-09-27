"use client";
import { useState } from "react";
import { mediaUrl, type Evidence, type SegmentState, type Vehicle } from "@/lib/api";
import { PALETTE, THRESHOLDS, bandFor, describe, fmtTime, inches, range } from "@/lib/depth";
import { useTheme } from "@/lib/theme";
import { VehicleSilhouette } from "./Vehicles";

const SOURCE: Record<NonNullable<Evidence["kind"]>, string> = {
  photo: "Photo · depth read by Cosmos Reason 2",
  survey: "USGS survey · estimated peak depth, surveyed after the flood",
  dashcam: "Dashcam frame · not stored",
  voice: "Voice report · low confidence",
};

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
  // Dashcam frames are never stored and voice reports have no picture, whatever the payload says.
  const photo = ev.image_url && imgOk && !noPhoto && ev.kind !== "dashcam" && ev.kind !== "voice";
  return (
    <div className="space-y-2.5">
      {photo && (
        <figure className="relative overflow-hidden rounded-md border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element -- media is served by the backend, not Next */}
          <img
            src={mediaUrl(ev.image_url!)}
            alt={`Flood photo${ev.reference ? ` measured against a ${ev.reference}` : ""}`}
            className="w-full max-h-52 object-cover bg-panel-2"
            onError={() => setImgOk(false)}
          />
          {/* The API gives the reading, not the waterline's pixel position, so this is a labelled readout, not a marker. */}
          <figcaption className="absolute inset-x-0 bottom-0 pt-8 pb-2 px-2.5 bg-gradient-to-t from-black/80 to-transparent">
            <span className="block border-t border-dashed border-[var(--water-line)] mb-1.5" aria-hidden />
            <span className="flex justify-between gap-2 font-mono text-[10.5px] text-white">
              <span>waterline · {ev.reference ?? "no reference object"}</span>
              <span className="text-[var(--water-line)]">{range(ev.low_cm, ev.high_cm)}</span>
            </span>
          </figcaption>
        </figure>
      )}
      {!photoOnly && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="eyebrow self-center">Source</dt>
            <dd className="text-[12.5px] text-text">
              {SOURCE[ev.kind ?? "photo"]}
            </dd>
            <dt className="eyebrow self-center">Depth</dt>
            <dd className="font-mono text-text tabular-nums">{range(ev.low_cm, ev.high_cm)}</dd>
            {ev.kind !== "voice" && (
              <>
                <dt className="eyebrow self-center">Measured on</dt>
                <dd className="text-text">{ev.reference ?? "No reference object in frame"}</dd>
              </>
            )}
            <dt className="eyebrow self-center">Observed</dt>
            <dd className="font-mono text-[12px] text-text">{fmtTime(ev.time)}</dd>
            {ev.location_precision && ev.location_precision !== "exact" && (
              <>
                <dt className="eyebrow self-center">Location</dt>
                <dd className="text-[12.5px] text-warn">Location approximated from caption ({ev.location_precision} level)</dd>
              </>
            )}
            {ev.confidence !== null && (
              <>
                <dt className="eyebrow self-center">Confidence</dt>
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
            {ev.credit ? `Credit · ${ev.credit}` : "Credit not recorded"}
            {ev.source_url && (
              <>
                {" · "}
                <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-muted">
                  source
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
  vehicle: Vehicle | undefined;
  onClose: () => void;
}) {
  const { name, state, low, high, evidence, vehicle, onClose } = props;
  const theme = useTheme();
  const band = bandFor(state, high);
  const color = PALETTE[theme][band];
  const [latest, ...earlier] = evidence;
  const unknown = state === "reported_unknown" || high === null;
  const verdict = !vehicle
    ? null
    : unknown
      ? `Depth unknown, so routes for every vehicle avoid this street.`
      : state === "stale"
        ? `This report has aged out. Current conditions are unknown, not dry.`
        : high > vehicle.limit_cm
          ? `Over your ${vehicle.label.toLowerCase()}'s ${vehicle.limit_cm} cm limit. Routes avoid this street.`
          : `Under your ${vehicle.label.toLowerCase()}'s ${vehicle.limit_cm} cm limit. Water can rise fast; look before you drive.`;

  return (
    <article
      className="rise bg-panel rounded-xl border border-line shadow-[var(--shadow)] w-full max-h-full overflow-y-auto"
      aria-label={`Report for ${name ?? "street"}`}
    >
      <div className="h-1 rounded-t-xl" style={{ background: color }} />
      <div className="p-4 space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Street report</p>
            <h3 className="font-display text-[26px] leading-tight text-text">{name ?? "Unnamed street"}</h3>
            <p className="text-[13px] mt-0.5 flex items-center gap-2" style={{ color }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
              {describe(state, high)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close report"
            className="text-faint hover:text-text w-8 h-8 -mr-1 -mt-1 rounded-md hover:bg-panel-2 text-xl leading-none"
          >
            ×
          </button>
        </header>

        {latest?.image_url && latest.kind !== "dashcam" && latest.kind !== "voice" && <EvidenceItem ev={latest} photoOnly />}

        <div className="flex items-end gap-3 rounded-lg border border-line bg-panel-2/60 p-3">
          <DepthGauge low={low} high={high} color={color} />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[26px] leading-none text-text tabular-nums">{unknown ? "?" : range(low, high).replace(" cm", "")}</p>
            <p className="eyebrow mt-1">{unknown ? "depth unreadable" : "cm, conservative range"}</p>
            <VehicleSilhouette
              id={vehicle?.id ?? "sedan"}
              waterCm={unknown ? null : (latest?.depth_cm ?? high)}
              lowCm={unknown ? null : low}
              highCm={unknown ? null : high}
              limitCm={vehicle?.limit_cm}
              unknown={unknown}
              className="w-full h-auto mt-2"
            />
            <p className="font-mono text-[10px] text-faint mt-1">solid: best estimate · pale: range · dashed: your limit</p>
          </div>
        </div>
        {verdict && <p className="text-[13px] text-text leading-snug">{verdict}</p>}

        {latest ? <EvidenceItem ev={latest} noPhoto /> : <p className="text-sm text-muted">No evidence attached.</p>}

        {earlier.length > 0 && (
          <details className="group">
            <summary className="eyebrow cursor-pointer list-none flex items-center gap-1.5 hover:text-muted">
              <span className="transition-transform group-open:rotate-90">›</span> Earlier reports ({earlier.length})
            </summary>
            <ol className="mt-2 space-y-1 border-l border-line pl-3">
              {earlier.slice(0, 8).map((ev) => (
                <li key={ev.obs_id} className="flex justify-between gap-3 font-mono text-[11.5px] text-muted">
                  <span>{fmtTime(ev.time)}</span>
                  <span className="text-text tabular-nums">{range(ev.low_cm, ev.high_cm)}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </article>
  );
}
