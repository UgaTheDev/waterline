"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, parsePoint, USE_MOCK, type ApiError, type Config, type QueueItem, type ResponderFlag, type RouteResponse, type Segments } from "@/lib/api";
import { fmtTime } from "@/lib/depth";
import { useLang, useT, vehicleName, type Key } from "@/lib/i18n";
import { MOCK_TOKEN } from "@/lib/mock";
import { useReducedMotion, useTheme } from "@/lib/theme";
import EvidenceCard, { EvidenceItem } from "./EvidenceCard";
import RouteSummary, { type Selection } from "./Route";
import { VehiclePicker } from "./Vehicles";

const FloodMap = dynamic(() => import("./FloodMap"), { ssr: false, loading: () => <div className="absolute inset-0 bg-bg" /> });

// The token lives in sessionStorage (gone when the tab closes) and is only ever sent as the X-Responder-Token header.
const KEY = "waterline-responder-token";
const listeners = new Set<() => void>();
const readToken = () => {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};
function saveToken(t: string) {
  try {
    if (t) sessionStorage.setItem(KEY, t);
    else sessionStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
}
const useToken = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readToken,
    () => "",
  );

const FLAG: Record<ResponderFlag, Key> = { person_in_water: "rs.person", occupied_vehicle: "rs.occupied" };
const DONE: Record<string, Key> = { reviewed: "rs.reviewed", seen: "rs.seenTag", dismissed: "rs.dismissedTag" };
// The disclaimer is i18n key "rs.disclaimer": "Flags come from an AI model and can be wrong both ways. Never assume no one needs help."

function TokenForm({ error }: { error: string | null }) {
  const [value, setValue] = useState("");
  const t = useT();
  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        saveToken(value.trim());
      }}
    >
      <label className="block">
        <span className="eyebrow">{t("rs.token")}</span>
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[14px] text-text font-mono focus:outline-none focus:border-accent"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-2.5 text-[13px] text-text">
          <strong className="text-danger">{error}</strong>
        </p>
      )}
      <button type="submit" disabled={!value.trim()} className="rounded-lg bg-accent text-accent-ink text-[14px] font-medium px-5 py-2.5 disabled:opacity-50">
        {t("rs.open")}
      </button>
      <p className="text-[12px] text-muted">{t("rs.tokenNote")}</p>
      {USE_MOCK && <p className="font-mono text-[11px] text-warn">{t("rs.mock", { tok: MOCK_TOKEN })}</p>}
    </form>
  );
}

// Flagged media is token-guarded, so it is fetched with the header and shown from a blob URL.
function FlaggedImage({ token, obsId }: { token: string; obsId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const t = useT();
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    api.responderMedia(token, obsId).then(
      (b) => {
        if (!live) return;
        u = URL.createObjectURL(b);
        setUrl(u);
      },
      (e: Error) => live && setFailed(e.message),
    );
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [token, obsId]);
  if (failed) return <p className="rounded-md border border-dashed border-line-strong p-3 font-mono text-[11px] text-muted">{failed}</p>;
  if (!url) return <div className="aspect-video rounded-md border border-line bg-panel-2 animate-pulse" />;
  // eslint-disable-next-line @next/next/no-img-element -- a blob URL from an authenticated fetch
  return <img src={url} alt={t("rs.flaggedAlt")} className="w-full max-h-60 object-cover rounded-md border border-line bg-panel-2" />;
}

function QueueCard({ item, token, done, onReview }: { item: QueueItem; token: string; done?: string; onReview: (a: "seen" | "dismissed") => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const lang = useLang();
  const ev = item.evidence;
  const reviewed = done ?? (item.reviewed ? "reviewed" : null);
  const act = async (a: "seen" | "dismissed") => {
    setBusy(true);
    setError(null);
    try {
      await onReview(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`rise rounded-xl border bg-panel p-4 space-y-3 ${reviewed ? "border-line opacity-70" : "border-danger/50"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-warn-soft border border-warn/50 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-warn">
          {item.label ?? t("rs.needsReview")}
        </span>
        {item.flags.map((f) => (
          <span key={f} className="rounded-full bg-danger-soft border border-danger/50 px-2 py-0.5 text-[11.5px] text-danger font-medium">
            {FLAG[f] ? t(FLAG[f]) : f}
          </span>
        ))}
        {reviewed && <span className="ml-auto font-mono text-[10.5px] uppercase tracking-wider text-muted">{DONE[reviewed] ? t(DONE[reviewed]) : reviewed}</span>}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-[24px] leading-tight text-text">{ev.street ?? t("rs.noStreet")}</p>
        <p className="font-mono text-[11.5px] text-muted shrink-0">{fmtTime(ev.time, true, lang)}</p>
      </div>
      <FlaggedImage token={token} obsId={item.obs_id} />
      <EvidenceItem ev={ev} noPhoto compact />
      {ev.rationale && <p className="text-[13px] text-muted leading-relaxed">{ev.rationale}</p>}
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => act("seen")}
          className="flex-1 rounded-lg bg-accent text-accent-ink text-[13.5px] font-medium py-2.5 disabled:opacity-60"
        >
          {t("rs.seen")}
        </button>
        <button
          disabled={busy}
          onClick={() => act("dismissed")}
          className="flex-1 rounded-lg border border-line-strong text-[13.5px] text-text py-2.5 hover:bg-panel-2 disabled:opacity-60"
        >
          {t("rs.dismiss")}
        </button>
      </div>
    </li>
  );
}

function Queue({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const t = useT();
  useEffect(() => {
    let live = true;
    api.responderQueue(token).then(
      (q) => live && setItems(q),
      (e: ApiError) => {
        if (!live) return;
        if (e.status === 401) onUnauthorized();
        else setError(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, [token, onUnauthorized]);

  if (error) return <p className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-[13px] text-text">{t("rs.queueErr", { e: error })}</p>;
  if (!items) return <p className="shimmer-text font-mono text-sm">{t("rs.queueLoading")}</p>;
  if (!items.length) return <p className="text-[13px] text-muted">{t("rs.queueEmpty")}</p>;
  const sorted = [...items].sort((a, b) => Number(a.reviewed || !!done[a.obs_id]) - Number(b.reviewed || !!done[b.obs_id]) || b.evidence.time.localeCompare(a.evidence.time));
  return (
    <ul className="space-y-3">
      {sorted.map((it) => (
        <QueueCard
          key={it.obs_id}
          item={it}
          token={token}
          done={done[it.obs_id]}
          onReview={async (a) => {
            try {
              await api.responderReview(token, it.obs_id, a);
            } catch (e) {
              if ((e as ApiError).status === 401) return onUnauthorized(); // token revoked mid-session: back to the form
              throw e;
            }
            setDone((d) => ({ ...d, [it.obs_id]: a === "seen" ? "seen" : "dismissed" }));
          }}
        />
      ))}
    </ul>
  );
}

function RescueRouting() {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [config, setConfig] = useState<Config | null>(null);
  const [segments, setSegments] = useState<Segments | null>(null);
  const [vehicle, setVehicle] = useState("rescue");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [flash, setFlash] = useState({ ids: [] as string[], key: 0 });
  const tr = useT(); // `t` is the planning time here
  const lang = useLang();

  // Replay deployments plan at the replay's default time; a live deployment plans now.
  const t = config ? (config.live ? new Date().toISOString() : config.replay.default_t || config.replay.start) : "";
  useEffect(() => {
    api.config().then(
      (c) => {
        setConfig(c);
        if (!c.vehicles.some((v) => v.id === "rescue") && c.vehicles.length) setVehicle(c.vehicles[0].id);
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(() => {
    if (t) api.segments(t).then(setSegments, () => {});
  }, [t]);

  const plan = async (veh: string) => {
    if (!from.trim() || !to.trim()) return setError(tr("rs.needPoints"));
    setBusy(true);
    setError(null);
    try {
      const r = await api.route({ from: parsePoint(from), to: parsePoint(to), vehicle: veh, t });
      setRoute(r);
      if (r.avoided.length) setFlash({ ids: r.avoided.map((a) => a.edge_id), key: Date.now() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!config) return <p className="shimmer-text font-mono text-sm">{error ?? tr("loading")}</p>;
  const current = config.vehicles.find((v) => v.id === vehicle);

  return (
    <div className="space-y-4">
      <div className="relative h-[320px] rounded-xl border border-line overflow-hidden">
        <FloodMap
          config={config}
          theme={theme}
          reduced={reduced}
          segments={segments}
          alerts={null}
          route={route?.found ? route.geometry : null}
          endpoints={route?.found ? { from: route.from, to: route.to } : { from: null, to: null }}
          flash={flash}
          selectedId={selected?.id ?? null}
          picking={false}
          onSegment={(p) => setSelected({ id: p.edge_id, name: p.name, state: p.state, low: p.low_cm, high: p.high_cm, evidence: p.evidence, basis: p.basis })}
          onPick={() => {}}
        />
      </div>
      <VehiclePicker
        vehicles={config.vehicles}
        value={vehicle}
        onChange={(id) => {
          setVehicle(id);
          if (route) plan(id);
        }}
      />
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          plan(vehicle);
        }}
      >
        {(
          [
            [tr("map.start"), from, setFrom, tr("rs.startPh")],
            [tr("map.dest"), to, setTo, tr("rs.destPh")],
          ] as const
        ).map(([label, value, set, ph]) => (
          <label key={label} className="block">
            <span className="sr-only">{label}</span>
            <input
              value={value}
              onChange={(e) => set(e.target.value)}
              placeholder={ph}
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[14px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
            />
          </label>
        ))}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent text-accent-ink text-[14px] font-medium py-3 disabled:opacity-60">
          {busy ? (
            <span className="animate-pulse">{tr("map.planning")}</span>
          ) : (
            tr("rs.routeFor", { v: current ? vehicleName(tr, lang, current, true) : tr("rs.vehicle") })
          )}
        </button>
      </form>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div aria-live="polite">{route && <RouteSummary route={route} onEvidence={setSelected} />}</div>
      {selected && <EvidenceCard key={selected.id ?? selected.name} {...selected} vehicle={current} onClose={() => setSelected(null)} />}
    </div>
  );
}

export default function Responder() {
  const token = useToken();
  const [lastError, setLastError] = useState<string | null>(null);
  const t = useT();
  const unauthorized = useCallback(() => {
    setLastError(t("rs.unauth"));
    saveToken(""); // back to the form, which shows the 401
  }, [t]);

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-5 py-8 md:py-12">
      <p className="eyebrow">{t("rs.mode")}</p>
      <h1 className="font-display text-[40px] md:text-[56px] leading-none text-text mt-2">{t("rs.title")}</h1>
      <p role="note" className="mt-4 max-w-3xl rounded-lg border border-danger/40 bg-danger-soft p-3 text-[14px] text-text">
        <strong className="text-danger">{t("rs.disclaimer")}</strong>
      </p>
      {!token ? (
        <div className="mt-8">
          <TokenForm error={lastError} />
        </div>
      ) : (
        <div className="mt-8 grid md:grid-cols-[1.1fr_1fr] gap-8 items-start">
          <section aria-label={t("rs.flagged")}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="eyebrow">{t("rs.flaggedHead")}</h2>
              <button
                onClick={() => {
                  setLastError(null);
                  saveToken("");
                }}
                className="text-[12px] text-muted hover:text-text underline"
              >
                {t("rs.signOut")}
              </button>
            </div>
            <Queue token={token} onUnauthorized={unauthorized} />
          </section>
          <section aria-label={t("rs.rescue")}>
            <h2 className="eyebrow mb-3">{t("rs.rescue")}</h2>
            <RescueRouting />
          </section>
        </div>
      )}
    </main>
  );
}
