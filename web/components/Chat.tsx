"use client";
import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage, type ChatResponse, type Evidence, type Point, type RouteResponse } from "@/lib/api";
import { range } from "@/lib/depth";
import { lowerName, useLang, useT, type Key, type T } from "@/lib/i18n";
import { recognitionCtor, speak, speechLang, stopSpeaking, useCanListen, useSpeaking, type Recognition } from "@/lib/speech";
import { useReducedMotion } from "@/lib/theme";
import RouteSummary, { type Selection } from "./Route";

type Msg = ChatMessage & { sources?: ChatResponse["sources"]; route?: RouteResponse | null; steps?: string[]; fresh?: boolean; filed?: Evidence[] };

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
  const speaking = useSpeaking();
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");

  useEffect(() => () => {
    rec.current?.abort();
    stopSpeaking();
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }, [messages, busy, reduced]);

  // Replies are spoken only for questions asked by voice; typed questions stay silent.
  const send = async (text: string, voice = false) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages.map((m) => ({ ...m, fresh: false })), { role: "user", content }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const res = await api.chat({ messages: next.map(({ role, content }) => ({ role, content })), vehicle, t, location });
      setMessages([...next, { role: "assistant", content: res.reply, sources: res.sources, route: res.route, steps: stepsFor(res, vLower, t_), fresh: !reduced, filed: res.filed }]);
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
  const startListening = () => {
    const Ctor = recognitionCtor();
    if (!Ctor || busy || rec.current) return;
    stopSpeaking();
    const r = new Ctor();
    r.lang = speechLang(lang);
    r.interimResults = true;
    r.continuous = true;
    heard.current = "";
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
      if (heard.current.trim()) send(heard.current, true);
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
      {messages.length === 0 && (
        <div className="space-y-3 rise">
          <p className="font-display text-[24px] leading-tight text-text">{t_("chat.title")}</p>
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
              <p className="max-w-[88%] rounded-2xl rounded-br-md bg-accent text-accent-ink px-3.5 py-2 text-[13.5px]">{m.content}</p>
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
              <p className="text-[14px] leading-relaxed text-text whitespace-pre-wrap">{m.fresh ? (
                  <>
                    <span className="sr-only">{m.content}</span>
                    <span aria-hidden>
                      <Typing text={m.content} onDone={settle(i)} />
                    </span>
                  </>
                ) : (
                  m.content
                )}</p>
              {!m.fresh && m.route && (
                <div className="rounded-xl border border-line bg-panel-2/40 p-3 fade">
                  <RouteSummary route={m.route} onEvidence={onEvidence} />
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

      <form
        className="flex gap-2 sticky bottom-0 bg-panel pt-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        {canListen && (
          <button
            type="button"
            disabled={busy}
            aria-label={listening ? t_("chat.listeningAria") : t_("chat.hold")}
            aria-pressed={listening}
            title={t_("chat.hold")}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startListening();
            }}
            onPointerUp={stopListening}
            onPointerCancel={stopListening}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                startListening();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") stopListening();
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-11 shrink-0 rounded-lg border flex items-center justify-center touch-none select-none transition-colors disabled:opacity-40 ${
              listening ? "border-danger bg-danger-soft text-danger" : "border-line text-muted hover:text-text hover:border-line-strong"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden className={listening ? "animate-pulse" : ""}>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={listening ? t_("chat.listening") : t_("chat.ph")}
          aria-label={t_("chat.aria")}
          className="flex-1 min-w-0 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[14px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
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
            <button type="button" onClick={stopSpeaking} className="shrink-0 min-h-6 rounded-full border border-line px-2.5 py-1 text-muted hover:text-text">
              {t_("chat.stop")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
