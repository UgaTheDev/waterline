"use client";
import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage, type ChatResponse, type Point, type RouteResponse } from "@/lib/api";
import { useReducedMotion } from "@/lib/theme";
import RouteSummary, { type Selection } from "./Route";

type Msg = ChatMessage & { sources?: ChatResponse["sources"]; route?: RouteResponse | null; steps?: string[]; fresh?: boolean };

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
const WAIT_STEPS = ["Checking street reports", "Checking NWS flood warnings", "Planning around deep water", "Writing the answer"];

function Waiting() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((x) => Math.min(WAIT_STEPS.length, x + 1)), 1100);
    return () => clearInterval(id);
  }, []);
  return (
    <li className="flex flex-wrap gap-1.5" aria-label="The agent is working">
      {WAIT_STEPS.slice(0, n).map((s, i) => (
        <span key={s} className="rise font-mono text-[10.5px] rounded-full border border-line bg-panel-2 px-2 py-0.5 flex items-center gap-1.5">
          {i === n - 1 ? <span className="w-1.5 h-1.5 rounded-full bg-accent text-accent live-dot" /> : <span className="text-faint">·</span>}
          <span className={i === n - 1 ? "shimmer-text" : "text-faint"}>{s}…</span>
        </span>
      ))}
    </li>
  );
}

// Steps are derived from what the answer actually contains, not invented progress.
function stepsFor(res: ChatResponse, vehicle: string) {
  const s: string[] = [];
  if (res.route) s.push(res.route.found ? `Planned a ${vehicle} route` : `No ${vehicle} route found`);
  if (res.route?.avoided.length) s.push(`Avoided ${res.route.avoided.length} streets`);
  if (res.sources.length) s.push(`${res.sources.length} sources`);
  return s;
}

export default function Chat(props: {
  vehicle: string;
  vehicleLabel: string;
  t: string;
  location: Point | null;
  onRoute: (r: RouteResponse) => void;
  onEvidence: (s: Selection) => void;
}) {
  const { vehicle, vehicleLabel, t, location, onRoute, onEvidence } = props;
  const reduced = useReducedMotion();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }, [messages, busy, reduced]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages.map((m) => ({ ...m, fresh: false })), { role: "user", content }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const res = await api.chat({ messages: next.map(({ role, content }) => ({ role, content })), vehicle, t, location });
      setMessages([...next, { role: "assistant", content: res.reply, sources: res.sources, route: res.route, steps: stepsFor(res, vehicleLabel.toLowerCase()), fresh: !reduced }]);
      if (res.route) onRoute(res.route);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const settle = (i: number) => () => setMessages((ms) => (ms[i]?.fresh ? ms.map((m, j) => (j === i ? { ...m, fresh: false } : m)) : ms));

  return (
    <div className="space-y-4">
      {messages.length === 0 && (
        <div className="space-y-3 rise">
          <p className="font-display text-[24px] leading-tight text-text">Ask before you drive.</p>
          <p className="text-[13px] text-muted">The agent checks street reports and flood warnings, plans around deep water, and shows the photo behind every blocked street.</p>
          <div className="space-y-1.5">
            {[`Can I drive from Studemont St to downtown in my ${vehicleLabel.toLowerCase()}?`, "Which streets near Buffalo Bayou have water reported?"].map((s) => (
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
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about a street or a trip"
          aria-label="Message the flood agent"
          className="flex-1 min-w-0 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[14px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="w-11 rounded-lg bg-accent text-accent-ink disabled:opacity-40 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </div>
  );
}
