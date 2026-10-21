"use client";
import { useEffect, useRef } from "react";
import { Map as MLMap, Marker, NavigationControl, AttributionControl, setWorkerUrl, type GeoJSONSource, type ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Alerts, Config, Feature, LineString, Point, Risk, RiskProps, SegmentProps, Segments } from "@/lib/api";
import { PALETTE, bandFor, range, type Band } from "@/lib/depth";
import { useT } from "@/lib/i18n";
import type { Theme } from "@/lib/theme";

// Worker files are copied to public/ by scripts/copy-maplibre-worker.mjs (bundlers can't resolve its dynamic URL).
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const STYLES: Record<Theme, string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};
const empty = { type: "FeatureCollection" as const, features: [] };
const FRESH_MS = 1600;
const FLASH_MS = 2600;
const ROUTE_MS = 1400;
// Fallback when an observation carries no half_life_min (backend/profiles.py HALF_LIFE_MIN).
const HALF_LIFE_MIN = 45;
const RING_STEPS = 24; // ring arcs are pre-drawn in 1/24 steps, made on demand by styleimagemissing
const PIN_BG: Record<Theme, [string, string]> = { dark: ["#070b10", "#2a3847"], light: ["#f3f0e8", "#cfc8b8"] }; // --bg, --line-strong
const RISK_GLOW = [
  ["high", 0.55],
  ["elevated", 0.34],
] as const;

type Props = {
  config: Config;
  theme: Theme;
  reduced: boolean;
  segments: Segments | null;
  alerts: Alerts | null;
  risk?: Risk | null; // null = layer off
  route: LineString | null;
  endpoints: { from: Point | null; to: Point | null };
  flash: { ids: string[]; key: number };
  selectedId: string | null;
  picking: boolean;
  onSegment: (p: SegmentProps) => void;
  onPick: (p: Point) => void;
  onRisk?: (p: RiskProps) => void;
  time?: number; // scrubber time; when set, report pins with freshness rings are drawn
  live?: boolean; // live mode drops pins past 3 half-lives; replay keeps them
};

type SegFeature = Feature<LineString, SegmentProps>;
const slim = (f: SegFeature) => ({
  type: "Feature" as const,
  geometry: f.geometry,
  properties: {
    edge_id: f.properties.edge_id,
    state: f.properties.state,
    band: bandFor(f.properties.state, f.properties.high_cm),
    inferred: f.properties.basis === "inferred",
  },
});
const fc = (features: ReturnType<typeof slim>[]) => ({ type: "FeatureCollection" as const, features });

function bandColor(theme: Theme): ExpressionSpecification {
  const p = PALETTE[theme];
  const bands: Band[] = ["shallow", "stall", "float", "sweep", "unknownDepth", "stale"];
  return ["match", ["get", "band"], ...bands.flatMap((b) => [b, p[b]]), p.stale] as unknown as ExpressionSpecification;
}

function hatch(color: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 14;
  const g = c.getContext("2d")!;
  g.strokeStyle = color;
  g.lineWidth = 1.4;
  for (const o of [-14, 0, 14]) {
    g.beginPath();
    g.moveTo(o, 14);
    g.lineTo(o + 14, 0);
    g.stroke();
  }
  return g.getImageData(0, 0, 14, 14);
}

// A 45° hatch tile in a band colour, for inferred streets (line-pattern).
function hatchTile(color: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 14; // 7 px at pixelRatio 2: ~5 px stripe period
  const g = c.getContext("2d")!;
  g.strokeStyle = color;
  g.lineWidth = 4.8; // 2.4 px bars
  for (const o of [-14, 0, 14]) {
    g.beginPath();
    g.moveTo(o, 14);
    g.lineTo(o + 14, 0);
    g.stroke();
  }
  return g.getImageData(0, 0, 14, 14);
}

// Report pin: 9 px ring on the bg with a track; the arc in the depth colour is the freshness left; "?" core = depth unknown.
function ringPin(color: string, frac: number, unknown: boolean, theme: Theme) {
  const [bg, track] = PIN_BG[theme];
  const r = 2;
  const c = document.createElement("canvas");
  c.width = c.height = 24 * r;
  const g = c.getContext("2d")!;
  const m = 12 * r;
  g.lineWidth = 2 * r;
  g.beginPath();
  g.arc(m, m, 9 * r, 0, Math.PI * 2);
  g.fillStyle = bg;
  g.fill();
  g.strokeStyle = track;
  g.stroke();
  if (frac > 0) {
    g.beginPath();
    g.arc(m, m, 9 * r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    g.strokeStyle = color;
    g.lineCap = "round";
    g.stroke();
  }
  g.fillStyle = color;
  if (unknown) {
    g.font = `700 ${11 * r}px ui-monospace, Menlo, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("?", m, m + 0.5 * r);
  } else {
    g.beginPath();
    g.arc(m, m, 4 * r, 0, Math.PI * 2);
    g.fill();
  }
  return g.getImageData(0, 0, c.width, c.height);
}

function midpoint(coords: [number, number][]): [number, number] {
  return coords[Math.floor(coords.length / 2)] ?? coords[0];
}

export default function FloodMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const latest = useRef(props);
  const t = useT();
  const anim = useRef({ fresh: 0, flash: 0, route: 0 });
  const seen = useRef<Set<string>>(new Set());
  const callouts = useRef<Marker[]>([]);
  const styleTheme = useRef<Theme>(props.theme);
  useEffect(() => {
    latest.current = props;
  });

  const src = (id: string) => map.current?.getSource(id) as GeoJSONSource | undefined;
  const paint = (layer: string, prop: string, value: unknown) => {
    const m = map.current;
    if (m?.getLayer(layer)) m.setPaintProperty(layer, prop as never, value as never);
  };

  const routeGradient = (p: number) => {
    const pal = PALETTE[latest.current.theme];
    const stop = Math.min(1, Math.max(0.0001, p));
    const grad = (c: string): ExpressionSpecification =>
      stop >= 1 ? ["interpolate", ["linear"], ["line-progress"], 0, c, 1, c] : ["step", ["line-progress"], c, stop, "rgba(0,0,0,0)"];
    paint("route-line", "line-gradient", grad(pal.route));
    paint("route-casing", "line-gradient", grad(pal.routeCasing));
  };

  // --- data pushes (safe to call before the style is ready: they no-op) ---
  const pushSegments = (animateNew: boolean) => {
    const source = src("segments");
    if (!source) return; // not installed yet; install() pushes again
    const feats = (latest.current.segments?.features ?? []).filter((f) => f.properties.state !== "unknown");
    source.setData(fc(feats.map(slim)));
    const ids = new Set(feats.map((f) => f.properties.edge_id));
    const fresh = feats.filter((f) => !seen.current.has(f.properties.edge_id) && f.properties.basis !== "inferred");
    seen.current = ids;
    if (animateNew && fresh.length && !latest.current.reduced) {
      src("fresh")?.setData(fc(fresh.map(slim)));
      anim.current.fresh = performance.now();
    }
  };
  const pushAlerts = () => src("alerts")?.setData(latest.current.alerts ?? empty);
  const pushRisk = () => src("risk")?.setData(latest.current.risk ?? empty);
  const haloFilter = (): ExpressionSpecification => ["==", ["get", "edge_id"], latest.current.selectedId ?? ""];
  const pushSelected = () => {
    const f = latest.current.segments?.features.find((x) => x.properties.edge_id === latest.current.selectedId);
    src("selected")?.setData(f ? fc([slim(f)]) : empty);
    if (map.current?.getLayer("pins-halo")) map.current.setFilter("pins-halo", haloFilter());
  };
  // One pin per observed report (inferred values are not reports), at its street's midpoint.
  // Ring arc = 0.5^(age / half-life), age measured from the scrubber time.
  const pushPins = () => {
    const { segments, time, live } = latest.current;
    const feats: Feature<{ type: "Point"; coordinates: [number, number] }, { edge_id: string; ring: string; t: number }>[] = [];
    const seenObs = new Set<string>();
    if (time !== undefined)
      for (const f of segments?.features ?? []) {
        if (f.properties.state === "unknown") continue;
        for (const e of f.properties.evidence) {
          if (e.kind === "inferred" || seenObs.has(e.obs_id)) continue; // both directions of a street share observations
          seenObs.add(e.obs_id);
          const at = Date.parse(e.time);
          const frac = 0.5 ** (Math.max(0, time - at) / 60_000 / (e.half_life_min || HALF_LIFE_MIN));
          if (live && frac < 0.125) continue; // past 3 half-lives: off the live map, still shown in replay
          const band = bandFor("reported", e.high_cm); // null high = depth unreadable = unknownDepth
          feats.push({ type: "Feature", geometry: { type: "Point", coordinates: midpoint(f.geometry.coordinates) }, properties: { edge_id: f.properties.edge_id, ring: `ring-${band}-${Math.round(frac * RING_STEPS)}`, t: at } });
        }
      }
    src("pins")?.setData({ type: "FeatureCollection", features: feats });
  };
  const pushEndpoints = () => {
    const { from, to } = latest.current.endpoints;
    const pts = ([
      [from, "from"],
      [to, "to"],
    ] as const).flatMap(([p, kind]) => (p ? [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] }, properties: { kind } }] : []));
    src("endpoints")?.setData({ type: "FeatureCollection", features: pts });
  };
  const pushRoute = (animate: boolean) => {
    const r = latest.current.route;
    src("route")?.setData(r ? { type: "Feature", geometry: r, properties: {} } : empty);
    if (r && animate && !latest.current.reduced) {
      anim.current.route = performance.now();
      routeGradient(0);
    } else routeGradient(1);
  };

  const install = (m: MLMap) => {
    const theme = latest.current.theme;
    const pal = PALETTE[theme];
    const color = bandColor(theme);
    const firstLabel = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
    const under = (layer: Parameters<MLMap["addLayer"]>[0]) => m.addLayer(layer, firstLabel);
    if (m.hasImage("hatch")) m.removeImage("hatch");
    m.addImage("hatch", hatch(pal.alert));
    for (const id of ["alerts", "risk", "segments", "fresh", "selected", "flash", "endpoints", "pins"]) m.addSource(id, { type: "geojson", data: empty });
    m.addSource("route", { type: "geojson", data: empty, lineMetrics: true });
    const round = { "line-cap": "round", "line-join": "round" } as const;
    const w = (a: number, b: number): ExpressionSpecification => ["interpolate", ["exponential", 1.5], ["zoom"], 11, a, 17, b];
    const observed: ExpressionSpecification = ["!", ["get", "inferred"]];
    const notStale: ExpressionSpecification = ["all", ["!=", ["get", "state"], "stale"], observed];
    const inferred: ExpressionSpecification = ["all", ["!=", ["get", "state"], "stale"], ["get", "inferred"]];

    under({ id: "alerts-tint", type: "fill", source: "alerts", paint: { "fill-color": pal.alert, "fill-opacity": theme === "dark" ? 0.05 : 0.04 } });
    under({ id: "alerts-hatch", type: "fill", source: "alerts", paint: { "fill-pattern": "hatch", "fill-opacity": 0.2 } });
    under({ id: "alerts-line", type: "line", source: "alerts", paint: { "line-color": pal.alert, "line-width": 1.4, "line-opacity": 0.8, "line-dasharray": [3, 2] } });
    // Risk is a haze and a dotted edge, never a solid depth colour, and sits under every depth layer.
    for (const [band, op] of RISK_GLOW)
      under({ id: `risk-glow-${band}`, type: "line", source: "risk", layout: round, filter: ["==", ["get", "band"], band], paint: { "line-color": pal.risk, "line-width": w(16, 40), "line-blur": w(8, 16), "line-opacity": op } });
    under({ id: "risk-line", type: "line", source: "risk", layout: round, paint: { "line-color": pal.risk, "line-width": w(2.2, 4), "line-opacity": 0.9, "line-dasharray": [0.1, 2] } });
    under({ id: "selected", type: "line", source: "selected", layout: round, paint: { "line-color": pal.route, "line-width": w(10, 26), "line-blur": 3, "line-opacity": 0.55 } });
    // Observed depth: solid stroke plus a soft steady glow. Inferred: hatched, dimmer, no glow.
    under({ id: "seg-glow", type: "line", source: "segments", layout: round, filter: notStale, paint: { "line-color": color, "line-width": w(8, 24), "line-blur": w(3, 8), "line-opacity": theme === "dark" ? 0.3 : 0.15 } });
    // Inferred streets: same depth colour, 45° hatch at .6, drawn below observed ones so they never read stronger.
    under({ id: "inferred-casing", type: "line", source: "segments", filter: inferred, paint: { "line-color": theme === "dark" ? "#04070a" : "#ffffff", "line-width": w(5, 11), "line-opacity": 0.6 } });
    under({ id: "inferred", type: "line", source: "segments", filter: inferred, paint: { "line-pattern": ["concat", "hatch-", ["get", "band"]], "line-width": w(4, 9), "line-opacity": 0.6 } });
    under({ id: "seg-casing", type: "line", source: "segments", layout: round, filter: notStale, paint: { "line-color": theme === "dark" ? "#04070a" : "#ffffff", "line-width": w(6, 15) } });
    under({ id: "segments", type: "line", source: "segments", layout: round, filter: notStale, paint: { "line-color": color, "line-width": w(3.5, 11) } });
    // Deepest band (and unknown depth, drawn exactly like it) gets a hot core so it reads apart from 30-60 cm on a dark map.
    if (theme === "dark") under({ id: "seg-core", type: "line", source: "segments", layout: round, filter: ["all", observed, ["in", ["get", "band"], ["literal", ["sweep", "unknownDepth"]]]], paint: { "line-color": "#ffb3bf", "line-width": w(1, 3) } });
    under({ id: "segments-stale", type: "line", source: "segments", layout: { "line-join": "round" }, filter: ["==", ["get", "state"], "stale"], paint: { "line-color": color, "line-width": w(2, 6), "line-dasharray": [1.2, 1.2] } });
    under({ id: "fresh", type: "line", source: "fresh", layout: round, paint: { "line-color": color, "line-width": 0, "line-blur": 4, "line-opacity": 0 } });
    under({ id: "flash", type: "line", source: "flash", layout: round, paint: { "line-color": theme === "dark" ? "#ffffff" : pal.alert, "line-width": w(8, 22), "line-blur": 2, "line-opacity": 0 } });
    under({ id: "risk-hit", type: "line", source: "risk", paint: { "line-color": "#000", "line-width": 22, "line-opacity": 0 } });
    under({ id: "seg-hit", type: "line", source: "segments", paint: { "line-color": "#000", "line-width": 22, "line-opacity": 0 } });
    m.addLayer({ id: "route-casing", type: "line", source: "route", layout: round, paint: { "line-color": pal.routeCasing, "line-width": w(7, 14) } });
    m.addLayer({ id: "route-line", type: "line", source: "route", layout: round, paint: { "line-color": pal.route, "line-width": w(4, 8) } });
    m.addLayer({
      id: "endpoints",
      type: "circle",
      source: "endpoints",
      paint: {
        "circle-radius": 6.5,
        "circle-color": ["match", ["get", "kind"], "from", theme === "dark" ? "#e6edf3" : "#12161b", pal.route],
        "circle-stroke-color": pal.routeCasing,
        "circle-stroke-width": 3,
      },
    });
    m.addLayer({ id: "pins-halo", type: "circle", source: "pins", filter: haloFilter(), paint: { "circle-radius": 16, "circle-color": pal.route, "circle-opacity": 0.15, "circle-stroke-color": pal.route, "circle-stroke-width": 1.5 } });
    m.addLayer({
      id: "pins",
      type: "symbol",
      source: "pins",
      layout: {
        "icon-image": ["get", "ring"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 15, 1],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "t"], // newest report on top
      },
    });
    pushAlerts();
    pushRisk();
    pushPins();
    pushSegments(true);
    pushSelected();
    pushEndpoints();
    pushRoute(false);
  };

  useEffect(() => {
    const m = new MLMap({
      container: el.current!,
      style: STYLES[styleTheme.current],
      center: props.config.center,
      zoom: props.config.zoom,
      attributionControl: false,
      fadeDuration: 200,
    });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new AttributionControl({ compact: true }), "bottom-right");
    m.on("style.load", () => install(m));
    // Pin rings and hatch tiles are drawn on first use, in the current theme (setStyle drops them, so they redraw).
    m.on("styleimagemissing", ({ id }) => {
      const theme = latest.current.theme;
      const [kind, band, step] = id.split("-");
      const color = PALETTE[theme][band as Band];
      if (!color || m.hasImage(id)) return;
      if (kind === "hatch") m.addImage(id, hatchTile(color), { pixelRatio: 2 });
      else if (kind === "ring") m.addImage(id, ringPin(color, Number(step) / RING_STEPS, band === "unknownDepth", theme), { pixelRatio: 2 });
    });
    let lastPick = 0;
    for (const layer of ["seg-hit", "pins"])
      m.on("click", layer, (e) => {
        if (latest.current.picking || e.originalEvent.timeStamp === lastPick) return; // a pin over its street fires both
        lastPick = e.originalEvent.timeStamp;
        const edge = e.features?.[0]?.properties?.edge_id;
        const f = latest.current.segments?.features.find((x) => x.properties.edge_id === edge);
        if (f) latest.current.onSegment(f.properties);
      });
    // Depth reports win over the risk layer when both are under the pointer.
    m.on("click", "risk-hit", (e) => {
      if (latest.current.picking || m.queryRenderedFeatures(e.point, { layers: ["seg-hit"] }).length) return;
      const edge = e.features?.[0]?.properties?.edge_id;
      const f = latest.current.risk?.features.find((x) => x.properties.edge_id === edge);
      if (f) latest.current.onRisk?.(f.properties);
    });
    for (const layer of ["seg-hit", "risk-hit", "pins"]) {
      m.on("mouseenter", layer, () => {
        if (!latest.current.picking) m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", layer, () => {
        if (!latest.current.picking) m.getCanvas().style.cursor = "";
      });
    }
    m.on("click", (e) => {
      if (latest.current.picking) latest.current.onPick({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    // One rAF loop for every moving part. It only touches paint properties; sources are never re-set per frame.
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (latest.current.reduced) return;
      const s = now / 1000;
      paint("alerts-hatch", "fill-opacity", 0.16 + 0.1 * Math.sin(s * 0.8));
      if (latest.current.risk) {
        const b = 0.85 + 0.15 * Math.sin(s * 1.1);
        for (const [band, op] of RISK_GLOW) paint(`risk-glow-${band}`, "line-opacity", op * b);
      }
      const a = anim.current;
      if (a.fresh) {
        const p = (now - a.fresh) / FRESH_MS;
        paint("fresh", "line-width", 4 + 26 * p);
        paint("fresh", "line-opacity", p >= 1 ? 0 : 0.7 * (1 - p) ** 1.6);
        if (p >= 1) a.fresh = 0;
      }
      if (a.flash) {
        const p = (now - a.flash) / FLASH_MS;
        paint("flash", "line-opacity", p >= 1 ? 0 : 0.85 * Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p * 0.6));
        if (p >= 1) a.flash = 0;
      }
      if (a.route) {
        const p = Math.min(1, (now - a.route) / ROUTE_MS);
        routeGradient(1 - (1 - p) ** 3);
        if (p >= 1) a.route = 0;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      callouts.current.forEach((c) => c.remove());
      map.current = null;
      m.remove();
    };
    // Map is created once; later prop changes flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || styleTheme.current === props.theme) return;
    styleTheme.current = props.theme;
    m.setStyle(STYLES[props.theme]); // style.load re-installs our layers in the new palette
  }, [props.theme]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => pushSegments(true), [props.segments]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void pushAlerts(), [props.alerts]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void pushRisk(), [props.risk]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => pushPins(), [props.segments, props.time, props.live]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => pushSelected(), [props.selectedId, props.segments]);
  const { from, to } = props.endpoints;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => pushEndpoints(), [from, to]);

  useEffect(() => {
    pushRoute(true);
    const m = map.current;
    const r = props.route;
    if (!m || !r || r.coordinates.length < 2) return;
    const xs = r.coordinates.map((c) => c[0]);
    const ys = r.coordinates.map((c) => c[1]);
    const wide = window.innerWidth >= 768;
    m.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { padding: wide ? { top: 90, bottom: 150, left: 90, right: 90 } : { top: 60, bottom: 110, left: 30, right: 30 }, maxZoom: 15.5, duration: props.reduced ? 0 : 1100 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.route]);

  // Avoided streets flash, with a short callout naming the depth.
  useEffect(() => {
    const m = map.current;
    if (!m || !props.flash.key) return;
    const feats = (latest.current.segments?.features ?? []).filter((f) => props.flash.ids.includes(f.properties.edge_id));
    src("flash")?.setData(fc(feats.map(slim)));
    anim.current.flash = performance.now();
    if (props.reduced) paint("flash", "line-opacity", 0.5);
    callouts.current.forEach((c) => c.remove());
    const pal = PALETTE[latest.current.theme];
    callouts.current = feats.slice(0, 5).map((f) => {
      const node = document.createElement("div");
      const inner = document.createElement("div");
      inner.className = `${props.reduced ? "" : "callout "}glass rounded-md border px-2 py-1 font-mono text-[10.5px] whitespace-nowrap shadow-lg`;
      inner.style.borderColor = pal[bandFor(f.properties.state, f.properties.high_cm)];
      inner.style.color = "var(--text)";
      inner.textContent = t("map.avoidedCallout", { name: f.properties.name ?? t("street"), range: range(f.properties.low_cm, f.properties.high_cm, t) });
      node.appendChild(inner);
      return new Marker({ element: node, anchor: "bottom", offset: [0, -8] }).setLngLat(midpoint(f.geometry.coordinates)).addTo(m);
    });
    const id = setTimeout(() => {
      callouts.current.forEach((c) => c.remove());
      callouts.current = [];
      if (props.reduced) paint("flash", "line-opacity", 0);
    }, 4800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.flash.key]);

  useEffect(() => {
    if (map.current) map.current.getCanvas().style.cursor = props.picking ? "crosshair" : "";
  }, [props.picking]);

  // MapLibre sets position:relative on its container, so the absolute box is a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="w-full h-full" role="region" aria-label={t("map.aria")} />
    </div>
  );
}
