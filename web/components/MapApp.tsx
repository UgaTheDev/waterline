"use client";
import { BRAND } from "@/lib/brand";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentEvent, setEvent } from "@/lib/event";
import { useOffline } from "@/lib/fallback";
import { api, parsePoint, type Alerts, type Config, type EventInfo, type Point, type Risk, type RiskProps, type RouteResponse, type SegmentProps, type Segments } from "@/lib/api";
import { LEGEND, PALETTE, bandFor, fmtClock, fmtTime } from "@/lib/depth";
import { useReducedMotion, useTheme } from "@/lib/theme";
import { useLang, useT, vehicleName, type Key } from "@/lib/i18n";
import Chat from "./Chat";
import EvidenceCard from "./EvidenceCard";
import Hero from "./Hero";
import RiskCard from "./Risk";
import RouteSummary, { type Selection } from "./Route";
import Timeline from "./Timeline";
import { VehiclePicker } from "./Vehicles";

// MapLibre touches window/WebGL, so it only renders in the browser.
const FloodMap = dynamic(() => import("./FloodMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-bg" />,
});

const TICK_MS = 400;
const TICK_STEP = 10 * 60_000; // 1x plays the whole event in about four minutes
const HOUR = 3_600_000;

const toSel = (p: SegmentProps): Selection => ({ id: p.edge_id, name: p.name, state: p.state, low: p.low_cm, high: p.high_cm, evidence: p.evidence, basis: p.basis });
const isInferred = (p: SegmentProps) => p.basis === "inferred";

function Legend({ open, onToggle, risk }: { open: boolean; onToggle: () => void; risk: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <div className="glass rounded-xl border border-line shadow-[var(--shadow)] text-[12px] overflow-hidden">
      <button onClick={onToggle} aria-expanded={open} className="w-full flex items-center justify-between gap-3 px-3 py-2">
        <span className="eyebrow">{t("lg.title")}</span>
        <span className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          ⌃
        </span>
      </button>
      {!open && <p className="px-3 pb-2 -mt-1 text-[11px] text-muted">{t("lg.collapsed")}</p>}
      {open && (
        <div className="px-3 pb-3 fade">
          <ul className="grid grid-cols-2 md:grid-cols-1 gap-x-3 gap-y-1.5">
            {LEGEND.map((l) => {
              const c = PALETTE[theme][l.band];
              return (
                <li key={l.band} className="flex items-center gap-2.5">
                  <span
                    className="inline-block w-6 h-[5px] rounded-full shrink-0"
                    style={
                      l.band === "stale"
                        ? { background: `repeating-linear-gradient(90deg, ${c} 0 4px, transparent 4px 7px)` }
                        : l.band === "sweep" && theme === "dark"
                          ? { background: `linear-gradient(${c} 0 35%, #ffb3bf 35% 65%, ${c} 65%)`, boxShadow: `0 0 8px ${c}` }
                          : { background: c, boxShadow: l.band === "float" ? `0 0 8px ${c}` : undefined }
                    }
                  />
                  <span className="font-mono text-[11px] text-text w-12 shrink-0">{l.label.startsWith("lg.") ? t(l.label as Key) : l.label}</span>
                  <span className="text-muted hidden md:inline">{t(l.note)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 flex items-center gap-2.5 text-muted leading-snug">
            <span
              className="inline-block w-6 h-[5px] rounded-full shrink-0 opacity-60"
              style={{ background: `repeating-linear-gradient(90deg, ${PALETTE[theme].float} 0 5px, transparent 5px 8px)` }}
              aria-hidden
            />
            {t("lg.inferred")}
          </p>
          {risk && (
            <p className="mt-2 flex items-center gap-2.5 text-muted leading-snug">
              <span className="inline-block w-6 h-[9px] rounded-full shrink-0 blur-[2px]" style={{ background: PALETTE[theme].risk, opacity: 0.45 }} aria-hidden />
              {t("lg.risk", { label: t("risk.label") })}
            </p>
          )}
          <p className="mt-2.5 pt-2.5 border-t border-line text-muted leading-snug">
            {t("lg.noReportsA")}
            <span className="text-text">{t("lg.noReportsB")}</span>
            {t("lg.noReportsC")}
          </p>
        </div>
      )}
    </div>
  );
}

function ReportsFeed({ segments, onOpen }: { segments: Segments | null; onOpen: (s: Selection) => void }) {
  const theme = useTheme();
  const t = useT();
  const seen = new Set<string>();
  const rows = (segments?.features ?? [])
    .filter((f) => f.properties.state !== "unknown" && !isInferred(f.properties) && f.properties.evidence.length)
    .sort((a, b) => b.properties.obs_time.localeCompare(a.properties.obs_time))
    .filter((f) => {
      const k = f.properties.name ?? f.properties.edge_id;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, 6);
  return (
    <div>
      <p className="eyebrow mb-2 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent text-accent live-dot" /> {t("feed.title")}
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{t("feed.empty")}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map((f) => {
            const p = f.properties;
            const color = PALETTE[theme][bandFor(p.state, p.high_cm)];
            return (
              <li key={p.edge_id + p.obs_time} className="fade">
                <button
                  onClick={() => onOpen(toSel(p))}
                  className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-panel-2/60 transition-colors"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                  <span className="flex-1 min-w-0 text-[13.5px] text-text truncate">{p.name ?? t("unnamed")}</span>
                  <span className="font-mono text-[12px] tabular-nums" style={{ color }}>
                    {p.state === "reported_unknown" || p.high_cm === null ? t("depth.q") : `≤ ${Math.round(p.high_cm)} cm`}
                  </span>
                  <span className="font-mono text-[11px] text-faint w-16 text-right">{fmtClock(new Date(p.obs_time).getTime())}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function MapApp() {
  const theme = useTheme();
  const t_ = useT(); // `t` is the replay time here
  const lang = useLang();
  const reduced = useReducedMotion();
  const offline = useOffline(); // flips when the live backend goes down/comes back (lib/fallback.ts)
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [t, setT] = useState<number>(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hist, setHist] = useState<number[]>([]);
  const [segments, setSegments] = useState<Segments | null>(null);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [layerError, setLayerError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tab, setTab] = useState<"route" | "ask">("route");
  const [vehicle, setVehicle] = useState("sedan");
  const [legendOpen, setLegendOpen] = useState(false); // collapsed: the open legend covers the densest replay data
  const [reload, setReload] = useState(0); // bumped when a report is filed, so it appears on the map
  const [riskOn, setRiskOn] = useState(false);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [riskSel, setRiskSel] = useState<RiskProps | null>(null);

  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [fromPt, setFromPt] = useState<Point | null>(null);
  const [toPt, setToPt] = useState<Point | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [events, setEvents] = useState<EventInfo[]>([]);
  useEffect(() => {
    api.events().then(setEvents).catch(() => setEvents([]));
  }, []);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [flash, setFlash] = useState({ ids: [] as string[], key: 0 });
  const routeAbort = useRef<AbortController | null>(null);
  const mapBox = useRef<HTMLElement>(null);

  // On phones the map sits above the panel; bring it into view so the report card is seen.
  const open = (sel: Selection) => {
    setSelected(sel);
    setRiskSel(null);
    if (window.innerWidth < 768) mapBox.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  const loadConfig = useCallback(() => {
    api
      .config()
      .then((c) => {
        setConfig(c);
        setT(new Date(c.replay.default_t || c.replay.start).getTime());
        const pub = c.vehicles.filter((v) => !v.responder_only);
        if (pub.length && !pub.some((v) => v.id === "sedan")) setVehicle(pub[0].id);
        // Sparkline: every observation the replay will ever show, bucketed by hour.
        const start = new Date(c.replay.start).getTime();
        const hours = Math.ceil((new Date(c.replay.end).getTime() - start) / HOUR);
        api
          .segments(c.replay.end)
          .then((s) => {
            const h = new Array(Math.max(1, hours)).fill(0);
            const ids = new Set<string>();
            for (const f of s.features)
              for (const e of f.properties.evidence) {
                if (ids.has(e.obs_id) || e.kind === "inferred") continue; // both directions of a street share observations
                ids.add(e.obs_id);
                const i = Math.floor((new Date(e.time).getTime() - start) / HOUR);
                if (i >= 0 && i < h.length) h[i]++;
              }
            setHist(h);
          })
          .catch(() => {});
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);
  useEffect(loadConfig, [loadConfig]);

  const iso = t ? new Date(t).toISOString() : "";

  // Refetch the depth layer and alerts when the replay time moves.
  useEffect(() => {
    if (!iso) return;
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      Promise.all([api.segments(iso, ctrl.signal), api.alerts(iso, ctrl.signal)])
        .then(([s, a]) => {
          setSegments(s);
          setAlerts(a);
          setLayerError(null);
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") setLayerError(e.message);
        });
    }, 90);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
    // `offline` is included so segments/alerts refetch live as soon as the backend comes back,
    // instead of leaving the archived snapshot on screen until the next scrub or report.
  }, [iso, reload, offline]);

  // The risk layer is fetched only while it is switched on.
  useEffect(() => {
    if (!iso || !riskOn) return;
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      api
        .risk(iso, ctrl.signal)
        .then(setRisk)
        .catch((e: Error) => {
          if (e.name !== "AbortError") setLayerError(t_("map.riskLayer", { err: e.message }));
        });
    }, 90);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [iso, riskOn, t_]);

  useEffect(() => {
    if (!playing || !config) return;
    const end = new Date(config.replay.end).getTime();
    const id = setInterval(() => {
      setT((cur) => {
        const next = Math.min(end, cur + TICK_STEP * speed);
        if (next >= end) setPlaying(false);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, config, speed]);

  const showRoute = useCallback((r: RouteResponse) => {
    setRoute(r);
    if (r.avoided.length) setFlash({ ids: r.avoided.map((a) => a.edge_id), key: Date.now() });
  }, []);

  const findRoute = useCallback(
    async (veh: string) => {
      const from = fromPt ?? parsePoint(fromText);
      const to = toPt ?? parsePoint(toText);
      if (!from || !to) {
        setRouteError(t_("map.needPoints"));
        return;
      }
      routeAbort.current?.abort();
      const ctrl = new AbortController();
      routeAbort.current = ctrl;
      setRouting(true);
      setRouteError(null);
      try {
        showRoute(await api.route({ from, to, vehicle: veh, t: iso }, ctrl.signal));
      } catch (e) {
        if ((e as Error).name !== "AbortError") setRouteError((e as Error).message);
      } finally {
        if (routeAbort.current === ctrl) setRouting(false);
      }
    },
    [fromPt, toPt, fromText, toText, iso, showRoute, t_],
  );

  const chooseVehicle = (id: string) => {
    setVehicle(id);
    // Switching vehicle re-plans the same trip, so the difference is visible.
    if (route && tab === "route" && (fromPt || fromText) && (toPt || toText)) findRoute(id);
  };

  const onPick = (p: Point) => {
    const label = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    if (picking === "from") {
      setFromPt(p);
      setFromText(label);
    } else if (picking === "to") {
      setToPt(p);
      setToText(label);
    }
    setPicking(null);
  };

  const stats = useMemo(() => {
    const f = segments?.features ?? [];
    const live = f.filter((x) => !isInferred(x.properties) && (x.properties.state === "reported" || x.properties.state === "reported_unknown"));
    const names = (xs: typeof f) => new Set(xs.map((x) => x.properties.name ?? x.properties.edge_id)).size;
    return {
      reported: names(live),
      deep: names(live.filter((x) => ["float", "sweep", "unknownDepth"].includes(bandFor(x.properties.state, x.properties.high_cm)))),
    };
  }, [segments]);

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <p className="font-display text-[28px] text-text">{t_("unreachable")}</p>
          <p className="text-sm text-muted font-mono">{loadError}</p>
          <button
            onClick={() => {
              setLoadError(null);
              loadConfig();
            }}
            className="rounded-full bg-accent text-accent-ink text-sm px-5 py-2"
          >
            {t_("retry")}
          </button>
        </div>
      </div>
    );
  }
  if (!config)
    return (
      <div className="flex-1 flex items-center justify-center">
        <Hero />
        <p className="shimmer-text font-mono text-sm">{t_("map.loading")}</p>
      </div>
    );

  const start = new Date(config.replay.start).getTime();
  const end = new Date(config.replay.end).getTime();
  const activeAlerts = alerts?.features ?? [];
  const vehicles = config.vehicles.filter((v) => !v.responder_only); // rescue is responder mode only
  const current = vehicles.find((v) => v.id === vehicle);
  const derived = selected?.evidence[0]?.provenance?.derived_from ?? [];
  const sources = derived.length
    ? (segments?.features ?? []).filter((f) => !isInferred(f.properties) && f.properties.evidence.some((e) => derived.includes(e.obs_id))).map((f) => toSel(f.properties))
    : [];

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0">
      <Hero />
      <main ref={mapBox} className="relative h-[62dvh] md:h-auto md:flex-1 md:order-2 shrink-0 overflow-hidden">
        <FloodMap
          config={config}
          theme={theme}
          reduced={reduced}
          segments={segments}
          alerts={alerts}
          risk={riskOn ? risk : null}
          route={route?.found ? route.geometry : null}
          endpoints={route?.found && route.from && route.to ? { from: route.from, to: route.to } : { from: fromPt, to: toPt }}
          flash={flash}
          selectedId={selected?.id ?? null}
          picking={picking !== null}
          onSegment={(p) => {
            setSelected(toSel(p));
            setRiskSel(null);
          }}
          onRisk={(p) => {
            setRiskSel(p);
            setSelected(null);
          }}
          onPick={onPick}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-bg/50 to-transparent" aria-hidden />

        <div className="absolute top-3 left-3 right-14 flex flex-wrap gap-2 pointer-events-none">
          <span className="pointer-events-auto glass rounded-full border border-line px-3 py-1 text-[11.5px] text-text flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full live-dot ${config.live ? "bg-danger text-danger" : "bg-accent text-accent"}`} />
            <span className="font-mono uppercase tracking-wider text-[10.5px]">{config.live ? t_("live") : t_("replay")}</span>
            {events.length > 1 ? (
              // ponytail: switching reloads the page (choice kept per tab), so no per-event state can go stale
              <select
                aria-label={t_("map.event")}
                value={currentEvent() || events[0].id}
                onChange={(e) => {
                  setEvent(e.target.value);
                  window.location.reload();
                }}
                className="bg-transparent text-muted outline-none cursor-pointer"
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id} className="bg-bg text-text">
                    {ev.name} · {ev.city}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-muted">{config.event}</span>
            )}
          </span>
          {activeAlerts.slice(0, 1).map((a, i) => (
            <span key={i} className="pointer-events-auto rise glass rounded-full border border-danger/50 px-3 py-1 text-[11.5px] text-text flex items-center gap-2">
              <span className="text-danger" aria-hidden>▲</span>
              {a.properties.event}
              <span className="text-muted font-mono text-[10.5px] hidden sm:inline">{t_("map.until", { time: fmtTime(a.properties.expires, false, lang) })}</span>
              {activeAlerts.length > 1 && <span className="text-muted">+{activeAlerts.length - 1}</span>}
            </span>
          ))}
          {config?.features?.risk && (
          <button
            onClick={() => {
              setRiskOn(!riskOn);
              setRiskSel(null);
            }}
            aria-pressed={riskOn}
            title={t_("risk.label")}
            className={`pointer-events-auto glass rounded-full border px-3 py-1 text-[11.5px] flex items-center gap-2 transition-colors ${riskOn ? "border-text/50 text-text" : "border-line text-muted hover:text-text"}`}
          >
            <span className={`relative w-6 h-3.5 rounded-full border transition-colors ${riskOn ? "border-text/60 bg-text/20" : "border-line-strong"}`} aria-hidden>
              <span className={`absolute left-0 top-[2px] w-2 h-2 rounded-full bg-current transition-transform ${riskOn ? "translate-x-[12px]" : "translate-x-[2px]"}`} />
            </span>
            {t_("risk.toggle")}
          </button>
          )}
          {layerError && (
            <span className="pointer-events-auto glass rounded-full border border-warn/50 px-3 py-1 text-[11.5px] text-warn">{t_("map.layerError", { err: layerError })}</span>
          )}
        </div>

        {picking && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 rise glass rounded-full border border-accent px-4 py-1.5 text-[13px] text-text shadow-[var(--shadow)] z-10 whitespace-nowrap">
            {t_(picking === "from" ? "map.pickStart" : "map.pickDest")}
            <button className="ml-3 text-accent underline" onClick={() => setPicking(null)}>
              {t_("cancel")}
            </button>
          </div>
        )}

        {selected && (
          <div className="absolute z-20 left-2 right-2 bottom-2 top-14 md:top-14 md:left-3 md:right-auto md:bottom-auto md:w-[360px] md:max-h-[calc(100%-13rem)] flex flex-col justify-end md:justify-start pointer-events-none">
            <div className="pointer-events-auto min-h-0 flex">
              <EvidenceCard key={selected.id ?? selected.name} {...selected} vehicle={current} sources={sources} onOpen={open} onClose={() => setSelected(null)} />
            </div>
          </div>
        )}
        {!selected && riskSel && (
          <div className="absolute z-20 left-2 right-2 bottom-2 top-14 md:top-14 md:left-3 md:right-auto md:bottom-auto md:w-[360px] md:max-h-[calc(100%-13rem)] flex flex-col justify-end md:justify-start pointer-events-none">
            <div className="pointer-events-auto min-h-0 flex">
              <RiskCard key={riskSel.edge_id} risk={riskSel} onClose={() => setRiskSel(null)} />
            </div>
          </div>
        )}

        <div className={`hidden md:block absolute bottom-[6.75rem] left-3 w-[300px] transition-opacity ${selected || riskSel ? "opacity-0 pointer-events-none" : ""}`}>
          <Legend open={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} risk={riskOn} />
        </div>

        <div className="absolute bottom-8 left-2 right-2 md:left-3 md:right-3">
          <Timeline
            start={start}
            end={end}
            t={t}
            onScrub={(v) => {
              setPlaying(false);
              setT(v);
            }}
            playing={playing}
            onPlay={() => {
              if (!playing && t >= end) setT(start);
              setPlaying(!playing);
            }}
            speed={speed}
            onSpeed={setSpeed}
            hist={hist}
            live={config.live}
          />
        </div>
      </main>

      <aside id="route-planner" tabIndex={-1} className="md:order-1 md:w-[420px] shrink-0 bg-panel md:border-r border-line flex flex-col md:min-h-0 focus:outline-none">
        <div className="px-4 pt-4 pb-3 border-b border-line">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">{config.city}</p>
              <p className="font-display text-[26px] leading-none text-text mt-1">{t_("map.title")}</p>
            </div>
            <dl className="flex gap-4 text-right">
              <div>
                <dt className="eyebrow">{t_("map.reported")}</dt>
                <dd className="font-mono text-[20px] leading-tight text-text tabular-nums">{stats.reported}</dd>
              </div>
              <div>
                <dt className="eyebrow whitespace-nowrap">{t_("map.deep")}</dt>
                <dd className="font-mono text-[20px] leading-tight tabular-nums" style={{ color: stats.deep ? PALETTE[theme].float : "var(--muted)" }}>
                  {stats.deep}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-line">
          <p className="eyebrow mb-2">{t_("veh.your")}</p>
          <VehiclePicker vehicles={vehicles} value={vehicle} onChange={chooseVehicle} />
          <p className="text-[12px] text-muted mt-2 leading-snug">
            {t_("map.vehicleHelp")}
          </p>
        </div>

        <div className="flex border-b border-line px-2" role="tablist">
          {(["route", "ask"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`relative flex-1 py-3 text-[13px] font-medium transition-colors ${tab === k ? "text-text" : "text-muted hover:text-text"}`}
            >
              {t_(k === "route" ? "map.tabRoute" : "map.tabAsk")}
              <span className={`absolute left-4 right-4 -bottom-px h-0.5 rounded-full bg-accent transition-opacity ${tab === k ? "opacity-100" : "opacity-0"}`} />
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4 md:overflow-y-auto md:flex-1">
          {tab === "route" ? (
            <>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  findRoute(vehicle);
                }}
              >
                <div className="relative space-y-2">
                  <span className="absolute left-[13px] top-[26px] bottom-[26px] w-px bg-line-strong" aria-hidden />
                  {(
                    [
                      ["from", t_("map.start"), fromText, setFromText, setFromPt, t_("map.startPh"), t_("map.pickStartAria")],
                      ["to", t_("map.dest"), toText, setToText, setToPt, t_("map.destPh"), t_("map.pickDestAria")],
                    ] as const
                  ).map(([key, label, value, setText, setPt, ph, pickAria]) => (
                    <label key={key} className="flex items-center gap-2.5">
                      <span
                        className={`relative z-10 w-[11px] h-[11px] ml-2 shrink-0 rounded-full border-2 ${key === "from" ? "border-text bg-panel" : "border-accent bg-accent"}`}
                        aria-hidden
                      />
                      <span className="sr-only">{label}</span>
                      <input
                        value={value}
                        onChange={(e) => {
                          setText(e.target.value);
                          setPt(null);
                        }}
                        placeholder={ph}
                        className="flex-1 min-w-0 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[14px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setPicking(picking === key ? null : key)}
                        aria-label={pickAria}
                        aria-pressed={picking === key}
                        className={`shrink-0 w-10 h-10 rounded-lg border flex items-center justify-center transition-colors ${picking === key ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-text hover:border-line-strong"}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <circle cx="12" cy="12" r="7" />
                          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                        </svg>
                      </button>
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={routing}
                  className="w-full rounded-lg bg-accent text-accent-ink text-[14px] font-medium py-3 disabled:opacity-60 hover:brightness-110 transition"
                >
                  {routing ? (
                    <span className="animate-pulse">{t_("map.planning")}</span>
                  ) : (
                    t_("map.find", { v: current ? vehicleName(t_, lang, current, true) : "" })
                  )}
                </button>
              </form>
              {routeError && <p role="alert" className="text-[13px] text-danger">{routeError}</p>}
              {!route && <ReportsFeed segments={segments} onOpen={open} />}
              <div aria-live="polite">
                {route && <RouteSummary key={JSON.stringify(route.found ? route.geometry.coordinates[0] : route.reason) + vehicle} route={route} onEvidence={open} />}
              </div>
            </>
          ) : (
            <Chat vehicle={vehicle} vehicleLabel={current ? vehicleName(t_, lang, current) : t_("veh.car")} t={iso} location={fromPt} onRoute={showRoute} onEvidence={open} onFiled={() => setReload((n) => n + 1)} />
          )}

          <div className="md:hidden">
            <Legend open={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} risk={riskOn} />
          </div>

          <p className="text-[11.5px] text-faint border-t border-line pt-3 leading-relaxed">
            {t_("map.footer", { brand: BRAND })}
            <strong className="text-muted">{t_("slogan")}</strong>.
          </p>
        </div>
      </aside>
    </div>
  );
}
