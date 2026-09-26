"use client";
import type { Avoided, RouteResponse } from "@/lib/api";
import { PALETTE, bandFor, fmtDistance } from "@/lib/depth";
import { useTheme } from "@/lib/theme";

export type Selection = { id?: string; name: string | null; state: Avoided["state"]; low: number | null; high: number | null; evidence: Avoided["evidence"] };

function AvoidedList({ items, onEvidence }: { items: Avoided[]; onEvidence: (s: Selection) => void }) {
  const theme = useTheme();
  if (!items.length) return null;
  return (
    <div>
      <p className="eyebrow mb-2">Streets avoided · {items.length}</p>
      <ul className="space-y-1.5">
        {items.map((a, i) => {
          const color = PALETTE[theme][bandFor(a.state, a.high_cm)];
          return (
            <li key={a.edge_id} className="rise" style={{ animationDelay: `${120 + i * 60}ms` }}>
              <button
                disabled={!a.evidence.length}
                onClick={() => onEvidence({ id: a.edge_id, name: a.name, state: a.state, low: a.evidence[0]?.low_cm ?? null, high: a.high_cm, evidence: a.evidence })}
                className="w-full text-left flex items-stretch gap-3 rounded-lg border border-line bg-panel-2/60 hover:border-line-strong hover:bg-panel-2 transition-colors p-2.5 disabled:cursor-default"
              >
                <span className="w-1 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[13.5px] font-medium text-text truncate">{a.name ?? "Unnamed street"}</span>
                    <span className="font-mono text-[12px] tabular-nums shrink-0" style={{ color }}>
                      {a.high_cm === null ? "depth ?" : `≤ ${Math.round(a.high_cm)} cm`}
                    </span>
                  </span>
                  <span className="block text-[12px] text-muted mt-0.5">{a.reason}</span>
                </span>
                {a.evidence.length > 0 && <span className="self-center text-faint text-sm">›</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function RouteSummary({ route, onEvidence }: { route: RouteResponse; onEvidence: (s: Selection) => void }) {
  if (!route.found) {
    return (
      <div className="space-y-3 rise">
        <div className="rounded-lg border border-danger/40 bg-danger-soft p-3.5">
          <p className="eyebrow text-danger!">No route</p>
          <p className="font-display text-[22px] leading-tight text-text mt-0.5">{route.reason}</p>
          <p className="text-[13px] text-text mt-2">
            <strong className="text-danger">Turn Around, Don&apos;t Drown.</strong> Wait it out, or ask local officials for help.
          </p>
        </div>
        <AvoidedList items={route.avoided} onEvidence={onEvidence} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rise flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Route found</p>
          <p className="font-mono text-[30px] leading-none text-text tabular-nums mt-1">{fmtDistance(route.distance_m)}</p>
        </div>
        <p className="text-right text-[12.5px] text-muted leading-snug">
          avoids <span className="text-text font-medium">{route.avoided.length}</span> {route.avoided.length === 1 ? "street" : "streets"}
          <br />
          with reported water
        </p>
      </div>
      {(route.from?.label || route.to?.label) && (
        <p className="rise text-[12px] text-muted leading-snug">
          {route.from?.label} <span className="text-accent">→</span> {route.to?.label}
        </p>
      )}
      {route.warnings.map((w) => (
        <p key={w} className="rise rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[13px] text-text flex gap-2">
          <span className="text-warn" aria-hidden>▲</span>
          {w}
        </p>
      ))}
      {route.unknown_m > 0 && (
        <p className="rise text-[12.5px] text-muted">
          <span className="font-mono text-text">{fmtDistance(route.unknown_m)}</span> of this route has no recent reports: unknown, not dry.
        </p>
      )}
      <AvoidedList items={route.avoided} onEvidence={onEvidence} />
    </div>
  );
}
