"use client";
import { useEffect, useRef, useState } from "react";
import { api, mediaUrl, type ChatMessage, type ChatResponse, type Evidence, type Point, type RouteResponse } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { PALETTE, bandFor, fmtTime, range } from "@/lib/depth";
import { lowerName, useLang, useT, type Key, type T } from "@/lib/i18n";
import { recognitionCtor, speak, speechLang, stopSpeaking, useCanListen, useCanSpeak, useSpeaking, type Recognition } from "@/lib/speech";
import { useReducedMotion, useTheme } from "@/lib/theme";
import RouteSummary, { type Selection } from "./Route";

type Msg = ChatMessage & {
  sources?: ChatResponse["sources"];
  route?: RouteResponse | null;
  steps?: string[];
  fresh?: boolean;
  filed?: Evidence[];
  speak?: string;
  voiceMs?: number; // set on questions asked by voice
};

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`;

// Citation chips come only from the agent's tool results: the streets its route avoided and the photos behind them.
function Citations({ route, onEvidence }: { route: RouteResponse; onEvidence: (s: Selection) => void }) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  if (!route.avoided.length) return null;
  const chip = "min-h-11 rounded-lg border border-line bg-panel hover:border-line-strong transition-colors flex items-center gap-2 text-[12.5px] font-medium text-text";
  return (
    <ul className="fade flex flex-wrap gap-2" aria-label={t("chat.cites")}>
      {route.avoided.map((a) => {
        const color = PALETTE[theme][bandFor(a.state, a.high_cm)];
        const open = () => onEvidence({ id: a.edge_id, name: a.name, state: a.state, low: a.evidence[0]?.low_cm ?? null, high: a.high_cm, evidence: a.evidence });
        const photo = a.evidence.find((e) => e.image_url);
        return [
          <li key={a.edge_id}>
            <button onClick={open} disabled={!a.evidence.length} className={`${chip} px-2.5 disabled:cursor-default`}>
              <span className="w-3.5 h-1 rounded-sm shrink-0" style={{ background: color }} aria-hidden />
              {a.name ?? t("unnamed")}
              <span className="font-mono" style={{ color }}>
                {a.high_cm === null ? t("depth.q") : `${Math.round(a.high_cm)} cm`}
              </span>
            </button>
          </li>,
          photo && (
            <li key={`${a.edge_id}-photo`}>
              <button onClick={open} className={`${chip} pl-1 pr-2.5 font-mono text-[12px]`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- report photos come from the API host */}
                <img src={mediaUrl(photo.image_url!)} alt="" className="w-6 h-6 rounded-[5px] object-cover bg-panel-2" />
                {t("chat.photo", { t: fmtTime(photo.time, false, lang) })}
              </button>
            </li>
          ),
        ];
      })}
    </ul>
  );
}

// Reveals text word by word so a long answer reads as it arrives.
function Typing({ text, onDone }: { text: string; onDone: () => void }) {
  const [n, setN] = useState(0);
  const words = text.split(/(\s+)/);
  useEffect(() => {
    if (n >= words.length) return onDone();
    const id = setTimeout(() => setN((x) => x + 2), 28);
    return () => clearTimeout(id);
  }, [n, words.length, onDone]);
  return (
    <>
      {words.slice(0, n).join("")}
      <span className="inline-block w-1.5 h-3.5 -mb-0.5 ml-0.5 bg-accent animate-pulse" aria-hidden />
    </>
  );
}

// Shown while waiting: the agent's tools, in the order it usually calls them.
const WAIT_STEPS: Key[] = ["chat.step1", "chat.step2", "chat.step3", "chat.step4"];

function Waiting() {
  const t = useT();
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((x) => Math.min(WAIT_STEPS.length, x + 1)), 1100);
    return () => clearInterval(id);
  }, []);
  return (
    <li className="flex flex-wrap gap-1.5" aria-label={t("chat.working")}>
      {WAIT_STEPS.slice(0, n).map((s, i) => (
        <span key={s} className="rise font-mono text-[10.5px] rounded-full border border-line bg-panel-2 px-2 py-0.5 flex items-center gap-1.5">
          {i === n - 1 ? <span className="w-1.5 h-1.5 rounded-full bg-accent text-accent live-dot" /> : <span className="text-faint">·</span>}
          <span className={i === n - 1 ? "shimmer-text" : "text-faint"}>{t(s)}…</span>
        </span>
      ))}
    </li>
  );
}

// Steps are derived from what the answer actually contains, not invented progress.
function stepsFor(res: ChatResponse, vehicle: string, t: T) {
  const s: string[] = [];
  if (res.route) s.push(t(res.route.found ? "chat.planned" : "chat.noRoute", { v: vehicle }));
  if (res.route?.avoided.length) s.push(t("chat.avoided", { n: res.route.avoided.length }));
  if (res.sources.length) s.push(t("chat.sources", { n: res.sources.length }));
  return s;
}

export default function Chat(props: {
  vehicle: string;
  vehicleLabel: string;
  t: string;
  location: Point | null;
  onRoute: (r: RouteResponse) => void;
  onEvidence: (s: Selection) => void;
  onFiled?: () => void;
}) {
  const { vehicle, vehicleLabel, t, location, onRoute, onEvidence, onFiled } = props;
  const reduced = useReducedMotion();
  const t_ = useT(); // `t` is the replay time here
  const lang = useLang();
  const vLower = lowerName(lang, vehicleLabel);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const canListen = useCanListen();
  const canSpeak = useCanSpeak();
  const speaking = useSpeaking();
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");
  const started = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    rec.current?.abort();
    stopSpeaking();
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }, [messages, busy, reduced]);

  // Replies are spoken only for questions asked by voice; typed questions stay silent.
  const send = async (text: string, voice = false, voiceMs?: number) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages.map((m) => ({ ...m, fresh: false })), { role: "user", content, voiceMs }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const res = await api.chat({ messages: next.map(({ role, content }) => ({ role, content })), vehicle, t, location });
      setMessages([...next, { role: "assistant", content: res.reply, sources: res.sources, route: res.route, steps: stepsFor(res, vLower, t_), fresh: !reduced, filed: res.filed, speak: res.speak }]);
      if (res.route) onRoute(res.route);
      if (voice && res.speak) speak(res.speak, lang);
      if (res.filed?.length) onFiled?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Push to talk: hold to record, release to send.
  const startListening = (at: number) => {
    const Ctor = recognitionCtor();
    if (!Ctor || busy || rec.current) return;
    stopSpeaking();
    const r = new Ctor();
    r.lang = speechLang(lang);
    r.interimResults = true;
    r.continuous = true;
    heard.current = "";
    started.current = at; // the press event's timeStamp, on the performance.now() clock
    r.onresult = (e) => {
      heard.current = Array.from(e.results, (x) => x[0].transcript).join("");
      setDraft(heard.current);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError(t_("chat.micBlocked"));
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      if (heard.current.trim()) send(heard.current, true, performance.now() - started.current);
    };
    rec.current = r;
    setError(null);
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
    }
  };
  const stopListening = () => rec.current?.stop();

  const settle = (i: number) => () => setMessages((ms) => (ms[i]?.fresh ? ms.map((m, j) => (j === i ? { ...m, fresh: false } : m)) : ms));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[22px] leading-tight text-text">{t_("chat.head", { brand: BRAND })}</h2>
        <span className="min-h-8 rounded-full border border-line px-2.5 flex items-center text-[12px] font-medium text-text">{vehicleLabel}</span>
      </div>
      {messages.length === 0 && (
        <div className="space-y-3 rise">
          <p className="text-[13px] text-muted">{t_("chat.intro")}</p>
          <div className="space-y-1.5">
            {[t_("chat.ex1", { v: vLower }), t_("chat.ex2")].map((s) => (
              <button key={s} onClick={() => send(s)} className="block w-full text-left text-[13px] rounded-lg border border-line bg-panel-2/60 px-3 py-2.5 text-text hover:border-accent/60 transition-colors">
                <span className="text-accent mr-1.5">↳</span>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className="space-y-4" aria-live="polite">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <li key={i} className="flex justify-end rise">
              <div className="max-w-[88%] rounded-[16px_16px_4px_16px] bg-panel-2 border border-line px-3.5 py-3">
                <p className="text-[15px] leading-[1.45] text-text">{m.content}</p>
                {m.voiceMs !== undefined && <p className="font-mono text-[11px] uppercase text-muted mt-1.5">{t_("chat.voice", { s: clock(m.voiceMs) })}</p>}
              </div>
            </li>
          ) : (
            <li key={i} className="space-y-2.5 rise">
              {m.steps && (
                <div className="flex flex-wrap gap-1.5">
                  {m.steps.map((s, k) => (
                    <span key={s} className="rise font-mono text-[10.5px] rounded-full border border-line bg-panel-2 px-2 py-0.5 text-muted" style={{ animationDelay: `${k * 90}ms` }}>
                      <span className="text-accent">✓</span> {s}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[16px] leading-normal text-text whitespace-pre-wrap">{m.fresh ? (
                  <>
                    <span className="sr-only">{m.content}</span>
                    <span aria-hidden>
                      <Typing text={m.content} onDone={settle(i)} />
                    </span>
                  </>
                ) : (
                  m.content
                )}</p>
              {!m.fresh && m.route && <Citations route={m.route} onEvidence={onEvidence} />}
              {!m.fresh && m.route && (
                <div className="rounded-xl border border-line bg-panel-2/40 p-3 fade">
                  <RouteSummary route={m.route} onEvidence={onEvidence} />
                </div>
              )}
              {!m.fresh && (m.route?.found || canSpeak) && (
                <div className="fade flex flex-wrap gap-2">
                  {m.route?.found && (
                    <button onClick={() => onRoute(m.route!)} className="min-h-11 rounded-xl bg-accent text-accent-ink px-4 text-[14px] font-semibold">
                      {t_("chat.openRoute")}
                    </button>
                  )}
                  {canSpeak && (
                    <button onClick={() => speak(m.speak || m.content, lang)} className="min-h-11 rounded-xl border border-line px-3.5 text-[14px] font-medium text-text hover:border-line-strong">
                      {t_("chat.again")}
                    </button>
                  )}
                </div>
              )}
              {m.filed?.map((ev) => (
                <p key={ev.obs_id} className="fade inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border border-accent/50 bg-accent-soft px-3 py-1 text-[12px] text-text mr-1.5">
                  <span className="text-accent" aria-hidden>●</span>
                  {t_("chat.filed")}
                  <span className="font-mono tabular-nums">{range(ev.low_cm, ev.high_cm, t_)}</span>
                  <span className="font-mono text-[10.5px] text-muted">{t_("chat.filedNote")}</span>
                </p>
              ))}
              {!m.fresh && m.sources && m.sources.length > 0 && (
                <ul className="fade space-y-0.5">
                  {m.sources.map((s, k) => (
                    <li key={s.url} className="text-[12px] flex gap-2">
                      <span className="font-mono text-faint">[{k + 1}]</span>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ),
        )}
        {busy && <Waiting />}
      </ul>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div ref={end} />

      {/* Voice-first push-to-talk orb (handoff 06): hold to record, release to send. */}
      {canListen && (
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="relative w-40 h-40 flex items-center justify-center">
            <span className="ptt-ring" aria-hidden />
            <span className="ptt-ring" aria-hidden />
            <button
            type="button"
            disabled={busy}
            aria-label={listening ? t_("chat.listeningAria") : t_("chat.hold")}
            aria-pressed={listening}
            title={t_("chat.hold")}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startListening(e.timeStamp);
            }}
            onPointerUp={stopListening}
            onPointerCancel={stopListening}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                startListening(e.timeStamp);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") stopListening();
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`ptt-orb relative w-32 h-32 rounded-full flex items-center justify-center gap-1 touch-none select-none transition-transform disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${
              listening ? "scale-110" : ""
            }`}
          >
            {[14, 26, 36, 22, 12].map((h, i) => (
              <span key={i} className={`w-1 rounded-sm bg-[#070b10] ${listening ? "animate-pulse" : ""}`} style={{ height: h, animationDelay: `${i * 120}ms` }} aria-hidden />
            ))}
          </button>
          </div>
          <p className="flex items-center gap-4">
            <span className="text-[16px] font-medium text-text" aria-live="polite">
              {listening ? t_("chat.listening") : t_("chat.hold")}
            </span>
            <span className="w-px h-4 bg-line" aria-hidden />
            <button type="button" onClick={() => input.current?.focus()} className="min-h-11 text-[14px] font-medium text-muted hover:text-text">
              {t_("chat.type")}
            </button>
          </p>
        </div>
      )}

      <form
        className="flex gap-2 sticky bottom-0 bg-panel pt-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={listening ? t_("chat.listening") : t_("chat.ph")}
          aria-label={t_("chat.aria")}
          className="flex-1 min-w-0 min-h-11 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[14px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label={t_("chat.send")} className="w-11 rounded-lg bg-accent text-accent-ink disabled:opacity-40 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      {canListen && (
        <p className="flex items-center justify-between gap-3 font-mono text-[10.5px] text-faint -mt-2">
          <span>{t_("chat.voiceNote")}</span>
          {speaking && (
            <button type="button" onClick={stopSpeaking} className="shrink-0 min-h-11 rounded-full border border-line px-3 text-muted hover:text-text">
              {t_("chat.stop")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
