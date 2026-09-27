"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, parsePoint, type ApiError, type Config, type DashcamResponse, type Point, type RouteResponse, type Segments } from "@/lib/api";
import { PALETTE, bandFor, describe, fmtDistance, range } from "@/lib/depth";
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
const NOTICE = "Mount your phone before driving. Don't interact with Waterline while the car is moving. Frames are analysed and never stored.";

type Mode = "camera" | "demo";

function ResultCard({ result, vehicleLabel, limit, next }: { result: DashcamResponse; vehicleLabel: string; limit: number; next: string }) {
  const theme = useTheme();
  if (!result.water)
    return (
      <div className="bg-bg/90 backdrop-blur rounded-2xl border border-line p-5">
        <p className="font-display text-[34px] sm:text-[44px] leading-none text-text">No water detected in view</p>
        <p className="text-[15px] text-muted mt-2">That does not mean the road ahead is dry. If water covers the road, turn around.</p>
      </div>
    );
  const high = result.evidence?.high_cm ?? null;
  const state = high === null ? "reported_unknown" : "reported";
  const color = PALETTE[theme][bandFor(state, high)];
  return (
    <div className="bg-bg/90 backdrop-blur rounded-2xl border-2 p-5 rise" style={{ borderColor: color }}>
      <p className="eyebrow">Water ahead</p>
      <p className="font-display text-[36px] sm:text-[48px] leading-none text-text mt-1">{result.street ?? "Nearby road"}</p>
      <p className="font-mono text-[40px] sm:text-[56px] leading-none tabular-nums mt-3" style={{ color }}>
        {range(result.evidence?.low_cm ?? null, high)}
      </p>
      <p className="text-[18px] mt-2 font-medium" style={{ color }}>
        {describe(state, high)}
      </p>
      {result.over_limit && (
        <p className="text-[17px] text-text mt-2">
          Over your {vehicleLabel.toLowerCase()}&apos;s {limit} cm limit. {next}
        </p>
      )}
      <p className="font-mono text-[11px] text-faint mt-3">
        {result.filed ? "Filed as a dashcam report · frame not stored" : "Not filed: already reported on this drive, or no road within 30 m"}
      </p>
    </div>
  );
}

export default function Drive() {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const speaking = useSpeaking();
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
        setError(`Reroute failed: ${(e as Error).message}`);
      } finally {
        setRouting(false);
      }
    },
    [dest, vehicle, replayT],
  );

  // The frame loop reads the latest state through a ref so the interval never restarts mid-drive.
  const live = useRef({ pos, vehicle, dest, replayT, reroute, loadSegments });
  useEffect(() => {
    live.current = { pos, vehicle, dest, replayT, reroute, loadSegments };
  });

  const handle = (r: DashcamResponse) => {
    if (!r.water) return;
    const { pos, dest, reroute, loadSegments } = live.current;
    if (r.filed) loadSegments();
    const key = r.street ?? r.edge_id ?? r.speak ?? "";
    const now = Date.now();
    if (now - (announced.current.get(key) ?? -Infinity) < REPEAT_MS) return;
    announced.current.set(key, now);
    if (r.speak) speak(r.speak);
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
        setError("This video's host doesn't allow frame capture. Download it and choose the file instead.");
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
      (e: Error) => setCamError(`Camera unavailable: ${e.message}`),
    );
    const watch = navigator.geolocation?.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => setCamError(`Location unavailable: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
    const v = video.current;
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (v) v.srcObject = null;
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
    };
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
      if (!navigator.mediaDevices?.getUserMedia) return setCamError("This browser can't open the camera here. It needs HTTPS.");
      if (!navigator.geolocation) return setCamError("This browser can't share your location.");
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
          <p className="font-display text-[28px] text-text">Can&apos;t reach the flood data service</p>
          <p className="text-sm text-muted font-mono">{loadError}</p>
        </div>
      </div>
    );

  const current = config?.vehicles.find((v) => v.id === vehicle);
  const showMap = running && config && (mode === "demo" || route);
  const waiting = !pos ? (mode === "demo" ? "Click the map to set the camera position" : "Waiting for your location…") : "Watching the road…";

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0">
      <section className="relative flex-1 min-h-0 bg-black overflow-hidden" aria-label="Drive mode">
        <video
          ref={video}
          src={mode === "demo" ? (demoSrc ?? undefined) : undefined}
          crossOrigin={mode === "demo" ? "anonymous" : undefined}
          autoPlay
          muted
          loop={mode === "demo"}
          playsInline
          onError={() => mode === "demo" && demoSrc && setError("That video couldn't be played. Try a different file or URL.")}
          className={`absolute inset-0 w-full h-full object-cover ${running ? "" : "opacity-30"}`}
        />

        {!running ? (
          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-md mx-auto px-4 py-6 space-y-5">
              <div>
                <p className="eyebrow">Drive mode</p>
                <h1 className="font-display text-[40px] leading-none text-text mt-1">Eyes on the road.</h1>
                <p className="text-[14px] text-muted mt-2">
                  Waterline reads a frame every 4 seconds, files any flood water it sees, and speaks up when water ahead is over your vehicle&apos;s limit.
                </p>
              </div>
              <p role="note" className="rounded-xl border border-warn/50 bg-warn-soft text-warn text-[15px] leading-snug p-4 font-medium">
                {NOTICE}
              </p>

              {config && (
                <div>
                  <p className="eyebrow mb-2">Your vehicle</p>
                  <VehiclePicker vehicles={config.vehicles.filter((v) => !v.responder_only)} value={vehicle} onChange={setVehicle} />
                </div>
              )}

              <label className="block">
                <span className="eyebrow">Destination (optional)</span>
                <input
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder="Place name, or lat, lon"
                  className="mt-1.5 w-full rounded-lg border border-line bg-panel-2 px-3 py-3 text-[15px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
                />
                <span className="block text-[12px] text-muted mt-1">Set one to be rerouted when water ahead is over your limit.</span>
              </label>

              <div>
                <p className="eyebrow mb-2">Source</p>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Video source">
                  {(
                    [
                      ["camera", "Phone camera"],
                      ["demo", "Demo video"],
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
                    <p className="text-[12.5px] text-muted">Replays dashcam footage instead of the camera, at the replay time. After starting, click the map to set where the camera is.</p>
                    <input
                      type="file"
                      accept="video/*"
                      aria-label="Choose a video file"
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
                        placeholder="or a video URL"
                        aria-label="Video URL"
                        className="flex-1 min-w-0 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
                      />
                      <button type="submit" className="rounded-lg border border-line px-3 text-[13px] text-text hover:border-accent">
                        Load
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
                {mode === "demo" && !demoSrc ? "Choose a video to start" : "Start driving"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
              <span className="glass rounded-full border border-line px-3 py-1.5 text-[13px] text-text flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full live-dot ${offline ? "bg-warn text-warn" : "bg-accent text-accent"}`} />
                <span className="font-mono uppercase tracking-wider text-[11px]">{mode === "demo" ? "Demo" : "Live"}</span>
                <span className="text-muted hidden sm:inline">{current?.label} · frame every 4 s</span>
              </span>
              <div className="flex gap-2">
                {speaking && (
                  <button onClick={stopSpeaking} className="glass rounded-full border border-line px-4 py-2 text-[14px] text-text">
                    ■ Quiet
                  </button>
                )}
                <button onClick={stop} className="rounded-full bg-danger text-white px-5 py-2 text-[15px] font-medium">
                  Stop
                </button>
              </div>
            </div>

            <div className="absolute inset-x-3 bottom-3 space-y-2" aria-live="polite">
              {offline && (
                <div role="alert" className="rounded-2xl border-2 border-warn bg-bg/90 p-4">
                  <p className="text-[22px] sm:text-[26px] font-medium text-warn leading-tight">Depth model offline — no warnings</p>
                  <p className="text-[14px] text-text mt-1">Waterline can&apos;t see water right now. Drive as if every flooded road is deep.</p>
                </div>
              )}
              {camError && <p className="bg-bg/90 backdrop-blur rounded-lg border border-danger/60 px-3 py-2 text-[14px] text-danger">{camError}</p>}
              {error && <p className="bg-bg/90 backdrop-blur rounded-lg border border-danger/60 px-3 py-2 text-[14px] text-danger">{error}</p>}
              {route && !route.found && <p className="bg-bg/90 backdrop-blur rounded-lg border border-danger/60 px-3 py-2 text-[15px] text-text">{route.reason}</p>}
              {route?.found && (
                <p className="bg-bg/90 backdrop-blur rounded-lg border border-accent/60 px-3 py-2 text-[15px] text-text">
                  New route · {fmtDistance(route.distance_m)} · avoids {route.avoided.length} {route.avoided.length === 1 ? "street" : "streets"}
                </p>
              )}
              {result && current ? (
                <ResultCard result={result} vehicleLabel={current.label} limit={current.limit_cm} next={routing ? "Rerouting…" : route?.found ? "Take the new route." : "Turn around."} />
              ) : (
                !offline && (
                  <div className="bg-bg/90 backdrop-blur rounded-2xl border border-line p-5">
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
              Click the map to set the camera position
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
