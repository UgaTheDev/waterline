"use client";
import type { Avoided, RouteResponse } from "@/lib/api";
import { PALETTE, bandFor, fmtDistance } from "@/lib/depth";
import { routerText, useLang, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export type Selection = {
  id?: string;
  name: string | null;
  state: Avoided["state"];
  low: number | null;
  high: number | null;
  evidence: Avoided["evidence"];
  basis?: "observed" | "inferred";
};

// Design handoff "04 Route sheet": five row states. Never green, and "none" (no reports) is a dashed outline, never a fill.
// ponytail: the route API returns avoided streets and the unreported distance, not per-street rows on the route,
// so only "avoided", "unknownDepth" and "none" rows are drawn today; "clear" and "under" render once it does.
export type RowKind = "clear" | "none" | "under" | "unknownDepth" | "avoided";

export function SegmentRow(p: { kind: RowKind; name: string; note: string; color?: string; dist?: string; onClick?: () => void; delay?: number }) {
  const color = p.kind === "clear" || p.kind === "none" ? "var(--muted)" : (p.color ?? "var(--danger)");
  const struck = p.kind === "avoided" || p.kind === "unknownDepth";
  const body = (
    <>
      <span
        className="h-8 rounded-[2px] box-border"
        style={p.kind === "none" ? { border: `1px dashed ${color}` } : { background: color }}
        aria-hidden
      />
      <span className="min-w-0 text-left">
        <span className={`block text-[14px] truncate ${struck ? "line-through text-muted" : "text-text"}`} style={struck ? { textDecorationColor: color } : undefined}>
          {p.name}
        </span>
        <span className="block font-mono text-[11.5px]" style={{ color }}>
          {p.note}
        </span>
      </span>
      <span className="font-mono text-[12px] text-muted tabular-nums">{p.dist ?? "—"}</span>
    </>
  );
  const cls = "w-full grid grid-cols-[4px_1fr_auto] gap-3 items-center py-2 min-h-11";
  return (
    <li className="rise border-b border-line last:border-b-0" style={{ animationDelay: `${p.delay ?? 0}ms` }}>
      {p.onClick ? (
        <button onClick={p.onClick} className={`${cls} hover:bg-panel-2/60 transition-colors`}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

function Rows({ route, onEvidence }: { route: RouteResponse; onEvidence: (s: Selection) => void }) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  if (!route.avoided.length && !(route.found && route.unknown_m > 0)) return null;
  return (
    <div>
      {route.avoided.length > 0 && <p className="eyebrow mb-1">{t("rt.avoidedN", { n: route.avoided.length })}</p>}
      <ul>
        {route.avoided.map((a, i) => {
          const unknown = a.high_cm === null;
          // the router's reason already names the depth and the vehicle limit ("reported up to 52 cm; ... limit 30 cm")
          const depth = unknown ? t("rt.blocksAll") : routerText(lang, a.reason);
          return (
            <SegmentRow
              key={a.edge_id}
              kind={unknown ? "unknownDepth" : "avoided"}
              name={a.name ?? t("unnamed")}
              note={`${depth} · ${t("rt.avoidedTag")}`}
              color={PALETTE[theme][bandFor(a.state, a.high_cm)]}
              delay={120 + i * 60}
              onClick={
                a.evidence.length
                  ? () => onEvidence({ id: a.edge_id, name: a.name, state: a.state, low: a.evidence[0]?.low_cm ?? null, high: a.high_cm, evidence: a.evidence })
                  : undefined
              }
            />
          );
        })}
        {route.found && route.unknown_m > 0 && (
          <SegmentRow kind="none" name={t("rt.noReportsRow")} note={t("rt.noReportsNote")} dist={fmtDistance(route.unknown_m)} delay={120 + route.avoided.length * 60} />
        )}
      </ul>
    </div>
  );
}

export default function RouteSummary({ route, onEvidence }: { route: RouteResponse; onEvidence: (s: Selection) => void }) {
  const t = useT();
  const lang = useLang();
  if (!route.found) {
    return (
      <div className="space-y-3 rise">
        <div className="rounded-lg border border-danger/40 bg-danger-soft p-3.5">
          <p className="eyebrow text-danger!">{t("rt.none")}</p>
          <p className="font-display text-[22px] leading-tight text-text mt-0.5">{routerText(lang, route.reason)}</p>
          <p className="text-[13px] text-text mt-2">
            <strong className="text-danger">{t("slogan")}.</strong>
            {t("rt.noneHelp")}
          </p>
        </div>
        <Rows route={route} onEvidence={onEvidence} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {/* ponytail: no ETA, the route API returns distance only; an invented speed would be fabricated data */}
      <div className="rise flex items-baseline justify-between gap-3">
        <p className="font-mono text-[26px] font-semibold leading-none text-text tabular-nums whitespace-nowrap">
          <span className="sr-only">{t("rt.found")}: </span>
          {fmtDistance(route.distance_m)}
        </p>
        <p className="font-mono text-[12.5px] text-muted text-right">
          {t("rt.avoids")} {route.avoided.length} {t(route.avoided.length === 1 ? "rt.street" : "rt.streets")} {t("rt.withWater")}
        </p>
      </div>
      {(route.from?.label || route.to?.label) && (
        <p className="rise text-[12px] text-muted leading-snug">
          {route.from?.label} <span className="text-accent">→</span> {route.to?.label}
        </p>
      )}
      <div className="rise rounded-xl bg-panel-2 border border-line px-3 py-2.5 space-y-1.5">
        <p className="flex items-center gap-2.5 text-[14px] font-medium text-text">
          <span className="w-2.5 h-2.5 rounded-full bg-muted shrink-0" aria-hidden />
          {t("rt.clear")}
        </p>
        {route.unknown_m > 0 && (
          <p className="flex items-center gap-2.5 font-mono text-[12.5px] text-muted">
            <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-dashed border-muted shrink-0" aria-hidden />
            {t("rt.unknownKm", { d: fmtDistance(route.unknown_m) })}
          </p>
        )}
      </div>
      {route.warnings.map((w) => (
        <p key={w} className="rise rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-[13px] text-text flex gap-2">
          <span className="text-warn" aria-hidden>▲</span>
          {routerText(lang, w)}
        </p>
      ))}
      <Rows route={route} onEvidence={onEvidence} />
    </div>
  );
}
