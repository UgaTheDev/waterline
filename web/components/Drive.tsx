"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, parsePoint, type ApiError, type Config, type DashcamResponse, type Point, type RouteResponse, type Segments } from "@/lib/api";
import { fmtDistance } from "@/lib/depth";
import { BRAND } from "@/lib/brand";
import { routerText, useLang, useT, vehicleName } from "@/lib/i18n";
import { speak, stopSpeaking, useSpeaking } from "@/lib/speech";
import { useReducedMotion, useTheme } from "@/lib/theme";
import { VehiclePicker } from "./Vehicles";

const FloodMap = dynamic(() => import("./FloodMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-bg" />,
});

const CADENCE_MS = 4000; // backend/API.md: 1 frame every 4 s, skipped while a request is in flight
const REPEAT_MS = 2 * 60_000; // don't announce the same street twice within this window
const MAX_SIDE = 1024;

type Mode = "camera" | "demo";

// Design handoff "05 Drive mode": three HUD states. Over the limit, or depth unknown, is "Turn around": unknown blocks every vehicle.
function hudState(result: DashcamResponse) {
  if (!result.water) return "clear" as const;
  const high = result.evidence?.high_cm ?? null;
  return result.over_limit || high === null ? ("turn" as const) : ("ahead" as const);
}

// Depth against the wading limit; the limit marker sits at the middle, so a full bar is twice the limit.
function DepthBar({ high, limit, color }: { high: number | null; limit: number; color: string }) {
  const t = useT();
  const fill = high === null ? 100 : Math.min(100, (high / (limit * 2)) * 100);
  return (
    <div role="img" aria-label={t("dr.depthBar", { d: high === null ? t("d.rangeUnknown") : `${Math.round(high)} cm`, n: limit })} className="relative h-3 w-full rounded-md bg-line">
      <div className="h-full rounded-md" style={{ width: `${fill}%`, background: color }} />
      <span className="absolute left-1/2 -top-1.5 -bottom-1.5 w-[3px] -ml-px rounded-sm bg-text" aria-hidden />
    </div>
  );
}

// Plates are bg/90 (>= .86 opaque, per the handoff) so contrast is measured against the plate, not the rain or the video.
function ResultCard({ result, vehicleLabel, limit, next }: { result: DashcamResponse; vehicleLabel: string; limit: number; next: string }) {
  const t = useT();
  const state = hudState(result);
  if (!result.water)
    return (
      <div className="bg-bg/90 rounded-[20px] border border-line p-5 max-w-[440px]">
        <p className="flex items-center gap-3 text-[24px] sm:text-[30px] font-semibold leading-tight text-text">
          <span className="w-3 h-3 rounded-full bg-muted shrink-0" aria-hidden />
          {t("dr.hudClear")}
        </p>
        <p className="text-[15px] text-muted mt-2">{t("dr.noWaterNote")}</p>
      </div>
    );
  const high = result.evidence?.high_cm ?? null;
  const depth = high === null ? t("depth.q") : `${Math.round(high)} cm`; // the upper bound, as routing uses
  const filed = <p className="font-mono text-[11px] text-muted">{t(result.filed ? "dr.filed" : "dr.notFiled")}</p>;
  if (state === "ahead")
    return (
      <div role="alert" className="bg-bg/90 rounded-[20px] border-[1.5px] border-warn px-5 py-4 max-w-[440px] space-y-2.5 rise">
        <p className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[14px] font-semibold tracking-[0.12em] uppercase text-warn">{t("dr.waterAhead")}</span>
          <span className="font-mono text-[13px] text-muted truncate">{result.street ?? t("dr.nearby")}</span>
        </p>
        <p className="flex items-baseline gap-3.5 font-mono">
          <span className="text-[48px] sm:text-[64px] font-semibold leading-none text-warn tabular-nums">{depth}</span>
          <span className="text-[18px] text-text">{t("dr.limit", { n: limit })}</span>
        </p>
        <DepthBar high={high} limit={limit} color="var(--warn)" />
        <p className="text-[16px] font-medium text-text">{t("dr.under")}</p>
        {filed}
      </div>
    );
  return (
    <div role="alert" className="mx-auto bg-bg/90 rounded-3xl border-2 border-danger px-6 py-5 w-full max-w-[520px] flex flex-col items-center gap-3 text-center rise">
      <p className="text-[44px] sm:text-[60px] font-bold leading-none tracking-tight text-danger">{t("dr.turn")}</p>
      <p className="font-mono text-[20px] sm:text-[26px] font-semibold text-text">
        {t("dr.aheadLimit", { d: depth, n: limit })}
        {result.street && <span className="block text-[14px] font-medium text-muted">{result.street}</span>}
      </p>
      <DepthBar high={high} limit={limit} color="var(--danger)" />
      <p className="text-[17px] font-medium text-text">{result.over_limit ? t("dr.over", { v: vehicleLabel, n: limit, next }) : `${t("d.unknown")}. ${next}`}</p>
      {filed}
    </div>
  );
}

export default function Drive() {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const speaking = useSpeaking();
  const t = useT();
  const lang = useLang();
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState("sedan");
  const [dest, setDest] = useState("");
  const [mode, setMode] = useState<Mode>("camera");
  const [demoSrc, setDemoSrc] = useState<string | null>(null);
  const [demoUrl, setDemoUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [pos, setPos] = useState<Point | null>(null);
  const [result, setResult] = useState<DashcamResponse | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [routing, setRouting] = useState(false);
  const [segments, setSegments] = useState<Segments | null>(null);
  const [flash, setFlash] = useState({ ids: [] as string[], key: 0 });
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const inFlight = useRef(false);
  const announced = useRef(new Map<string, number>());
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    api.config().then(
      (c) => {
        setConfig(c);
        if (c.vehicles.length && !c.vehicles.some((v) => v.id === "sedan")) setVehicle(c.vehicles[0].id);
      },
      (e: Error) => setLoadError(e.message),
    );
    return () => {
      stopSpeaking();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  // Demo replays Harvey footage, so it runs at the replay time (session-only reports). The camera files live reports.
  const replayT = mode === "demo" && config ? config.replay.default_t || config.replay.start : null;

  const loadSegments = useCallback(() => {
    api.segments(replayT ?? new Date().toISOString()).then(setSegments, () => {});
  }, [replayT]);

  const reroute = useCallback(
    async (from: Point) => {
      setRouting(true);
      try {
        const r = await api.route({ from, to: parsePoint(dest), vehicle, t: replayT ?? new Date().toISOString() });
        setRoute(r);
        if (r.avoided.length) setFlash({ ids: r.avoided.map((a) => a.edge_id), key: Date.now() });
      } catch (e) {
        setError(t("dr.rerouteFailed", { e: (e as Error).message }));
      } finally {
        setRouting(false);
      }
    },
    [dest, vehicle, replayT, t],
  );

  // The frame loop reads the latest state through a ref so the interval never restarts mid-drive.
  const live = useRef({ pos, vehicle, dest, replayT, reroute, loadSegments, lang });
  useEffect(() => {
    live.current = { pos, vehicle, dest, replayT, reroute, loadSegments, lang };
  });

  const handle = (r: DashcamResponse) => {
    if (!r.water) return;
    const { pos, dest, reroute, loadSegments, lang } = live.current;
    if (r.filed) loadSegments();
    const key = r.street ?? r.edge_id ?? r.speak ?? "";
    const now = Date.now();
    if (now - (announced.current.get(key) ?? -Infinity) < REPEAT_MS) return;
    announced.current.set(key, now);
    if (r.speak) speak(r.speak, lang);
    if (r.over_limit && dest.trim() && pos) reroute(pos);
  };

  const tick = async () => {
    const v = video.current;
    const { pos, vehicle, replayT } = live.current;
    if (inFlight.current || !v || !pos || v.readyState < 2 || !v.videoWidth) return;
    inFlight.current = true;
    try {
      const c = (canvas.current ??= document.createElement("canvas"));
      const k = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      let blob: Blob | null;
      try {
        blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.7));
      } catch {
        setError(t("dr.noCapture"));
        return;
      }
      if (!blob) return;
      const form = new FormData();
      form.append("frame", blob, "frame.jpg");
      form.append("lat", String(pos.lat));
      form.append("lon", String(pos.lon));
      form.append("vehicle", vehicle);
      if (replayT) form.append("t", replayT);
      const r = await api.dashcam(form);
      setOffline(null);
      setError(null);
      setResult(r);
      handle(r);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 503) {
        setOffline(err.message);
        setResult(null); // an old reading must not linger as if it were current
      } else setError(err.message);
    } finally {
      inFlight.current = false;
    }
  };
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tickRef.current(), CADENCE_MS);
    return () => clearInterval(id);
  }, [running]);

  // Camera and GPS, only while driving in camera mode.
  useEffect(() => {
    if (!running || mode !== "camera") return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(
      (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
      },
      (e: Error) => setCamError(t("dr.camUnavail", { e: e.message })),
    );
    const watch = navigator.geolocation?.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => setCamError(t("dr.locUnavail", { e: e.message })),
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
    const v = video.current;
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (v) v.srcObject = null;
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a language switch must not restart the camera
  }, [running, mode]);

  // Keep the screen on while driving, where the browser supports it.
  useEffect(() => {
    if (!running || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState === "visible") navigator.wakeLock.request("screen").then((l) => (lock = l), () => {});
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      lock?.release().catch(() => {});
    };
  }, [running]);

  const start = () => {
    setCamError(null);
    setError(null);
    setResult(null);
    setOffline(null);
    setRoute(null);
    announced.current.clear();
    if (mode === "camera") {
      if (!navigator.mediaDevices?.getUserMedia) return setCamError(t("dr.needHttps"));
      if (!navigator.geolocation) return setCamError(t("dr.noGeo"));
    } else setPos(null);
    loadSegments();
    setRunning(true);
  };

  const stop = () => {
    setRunning(false);
    stopSpeaking();
  };

  const chooseFile = (f: File | undefined) => {
    if (!f) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(f);
    setDemoSrc(objectUrl.current);
  };

  if (loadError)
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <p className="font-display text-[28px] text-text">{t("unreachable")}</p>
          <p className="text-sm text-muted font-mono">{loadError}</p>
        </div>
      </div>
    );

  const current = config?.vehicles.find((v) => v.id === vehicle);
  const showMap = running && config && (mode === "demo" || route);
  const vName = current ? vehicleName(t, lang, current) : "";
  const waiting = t(!pos ? (mode === "demo" ? "dr.clickMap" : "dr.waitLoc") : "dr.watching");

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0">
      <section className="relative flex-1 min-h-0 bg-black overflow-hidden" aria-label={t("nav.drive")}>
        <video
          ref={video}
          src={mode === "demo" ? (demoSrc ?? undefined) : undefined}
          crossOrigin={mode === "demo" ? "anonymous" : undefined}
          autoPlay
          muted
          loop={mode === "demo"}
          playsInline
          onError={() => mode === "demo" && demoSrc && setError(t("dr.badVideo"))}
          className={`absolute inset-0 w-full h-full object-cover ${running ? "" : "opacity-30"}`}
        />

        {!running ? (
          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-md mx-auto px-4 py-6 space-y-5">
              <div>
                <p className="eyebrow">{t("nav.drive")}</p>
                <h1 className="font-display text-[40px] leading-none text-text mt-1">{t("dr.title")}</h1>
                <p className="text-[14px] text-muted mt-2">{t("dr.intro", { brand: BRAND })}</p>
              </div>
              <p role="note" className="rounded-xl border border-warn/50 bg-warn-soft text-warn text-[15px] leading-snug p-4 font-medium">
                {t("dr.notice", { brand: BRAND })}
              </p>

              {config && (
                <div>
                  <p className="eyebrow mb-2">{t("veh.your")}</p>
                  <VehiclePicker vehicles={config.vehicles.filter((v) => !v.responder_only)} value={vehicle} onChange={setVehicle} />
                </div>
              )}

              <label className="block">
                <span className="eyebrow">{t("dr.dest")}</span>
                <input
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder={t("dr.destPh")}
                  className="mt-1.5 w-full rounded-lg border border-line bg-panel-2 px-3 py-3 text-[15px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
                />
                <span className="block text-[12px] text-muted mt-1">{t("dr.destHelp")}</span>
              </label>

              <div>
                <p className="eyebrow mb-2">{t("source")}</p>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("dr.videoSource")}>
                  {(
                    [
                      ["camera", t("dr.camera")],
                      ["demo", t("dr.demo")],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      role="radio"
                      aria-checked={mode === k}
                      onClick={() => setMode(k)}
                      className={`rounded-lg border py-3 text-[14px] font-medium transition-colors ${mode === k ? "border-accent bg-accent-soft text-text" : "border-line bg-panel-2 text-muted hover:text-text"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {mode === "demo" && (
                  <div className="mt-3 space-y-2 rounded-lg border border-line bg-panel/80 p-3">
                    <p className="text-[12.5px] text-muted">{t("dr.demoHelp")}</p>
                    <input
                      type="file"
                      accept="video/*"
                      aria-label={t("dr.chooseFile")}
                      onChange={(e) => chooseFile(e.target.files?.[0])}
                      className="block w-full text-[13px] text-muted file:mr-3 file:rounded-md file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-text"
                    />
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (demoUrl.trim()) setDemoSrc(demoUrl.trim());
                      }}
                    >
                      <input
                        value={demoUrl}
                        onChange={(e) => setDemoUrl(e.target.value)}
                        placeholder={t("dr.urlPh")}
                        aria-label={t("dr.url")}
                        className="flex-1 min-w-0 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
                      />
                      <button type="submit" className="rounded-lg border border-line px-3 text-[13px] text-text hover:border-accent">
                        {t("dr.load")}
                      </button>
                    </form>
                  </div>
                )}
              </div>

              {camError && <p className="text-[14px] text-danger">{camError}</p>}
              {error && <p className="text-[14px] text-danger">{error}</p>}
              <button
                onClick={start}
                disabled={!config || (mode === "demo" && !demoSrc)}
                className="w-full rounded-xl bg-accent text-accent-ink text-[17px] font-medium py-4 disabled:opacity-40 hover:brightness-110 transition"
              >
                {t(mode === "demo" && !demoSrc ? "dr.chooseToStart" : "dr.start")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* DOM order is the stacking order: rain on the glass, then the coral frame, then the plates. */}
            <div className="drive-rain" aria-hidden />
            {result && hudState(result) === "turn" && <div className="hud-turn" aria-hidden />}
            <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
              <span className="bg-bg/90 rounded-full border border-line px-3 min-h-11 text-[13px] text-text flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full live-dot ${offline ? "bg-warn text-warn" : "bg-accent text-accent"}`} />
                <span className="font-mono uppercase tracking-wider text-[11px]">{mode === "demo" ? t("dr.demoTag") : t("live")}</span>
                <span className="text-muted hidden sm:inline">{t("dr.cadence", { v: vName })}</span>
              </span>
              <div className="flex gap-2">
                {speaking && (
                  <button onClick={stopSpeaking} className="bg-bg/90 rounded-full border border-line px-4 min-h-11 text-[14px] text-text">
                    {t("dr.quiet")}
                  </button>
                )}
                <button onClick={stop} className="rounded-full bg-danger text-bg px-5 min-h-11 text-[15px] font-semibold">
                  {t("dr.stop")}
                </button>
              </div>
            </div>

            <div className="absolute inset-x-3 bottom-3 space-y-2" aria-live="polite">
              {offline && (
                <div role="alert" className="rounded-2xl border-2 border-warn bg-bg/90 p-4">
                  <p className="text-[22px] sm:text-[26px] font-medium text-warn leading-tight">{t("dr.offline")}</p>
                  <p className="text-[14px] text-text mt-1">{t("dr.offlineNote", { brand: BRAND })}</p>
                </div>
              )}
              {camError && <p className="bg-bg/90 backdrop-blur rounded-lg border border-danger/60 px-3 py-2 text-[14px] text-danger">{camError}</p>}
              {error && <p className="bg-bg/90 backdrop-blur rounded-lg border border-danger/60 px-3 py-2 text-[14px] text-danger">{error}</p>}
              {route && !route.found && <p className="bg-bg/90 backdrop-blur rounded-lg border border-danger/60 px-3 py-2 text-[15px] text-text">{routerText(lang, route.reason)}</p>}
              {route?.found && (
                <p className="bg-bg/90 backdrop-blur rounded-lg border border-accent/60 px-3 py-2 text-[15px] text-text">
                  {t("dr.newRoute", { d: fmtDistance(route.distance_m), n: route.avoided.length, streets: t(route.avoided.length === 1 ? "rt.street" : "rt.streets") })}
                </p>
              )}
              {result && current ? (
                <ResultCard
                  result={result}
                  vehicleLabel={vehicleName(t, lang, current, true)}
                  limit={current.limit_cm}
                  next={t(routing ? "dr.rerouting" : route?.found ? "dr.takeNew" : "dr.turnAround")}
                />
              ) : (
                !offline && (
                  <div className="bg-bg/90 rounded-[20px] border border-line p-5 max-w-[440px]">
                    <p className="font-display text-[30px] sm:text-[40px] leading-none text-text">{waiting}</p>
                  </div>
                )
              )}
            </div>
          </>
        )}
      </section>

      {showMap && (
        <aside className="relative h-[34dvh] md:h-auto md:w-[400px] shrink-0 border-t md:border-t-0 md:border-l border-line">
          <FloodMap
            config={config}
            theme={theme}
            reduced={reduced}
            segments={segments}
            alerts={null}
            route={route?.found ? route.geometry : null}
            endpoints={{ from: pos, to: route?.found ? route.to : null }}
            flash={flash}
            selectedId={null}
            picking={mode === "demo"}
            onSegment={() => {}}
            onPick={setPos}
          />
          {mode === "demo" && (
            <p className="absolute top-2 left-2 right-12 glass rounded-md border border-line px-2 py-1 text-[12px] text-text pointer-events-none">
              {t("dr.clickMap")}
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
