"use client";
import { BRAND } from "@/lib/brand";
import { useT, type Key } from "@/lib/i18n";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Mark } from "./Header";

const KEY = "waterline-intro-seen";
const seen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

// One wave tile, drawn twice side by side so translating by -50% loops seamlessly.
// The bright stroke along the crest is the waterline: the brand motif.
function Wave({ d, opacity, line }: { d: number; opacity: number; line?: boolean }) {
  const crest = "M0 22 C 50 10 100 34 150 22 S 250 10 300 22 S 350 34 400 22";
  return (
    <div className="absolute inset-x-0 top-0 overflow-hidden h-full" aria-hidden>
      <div className="flex w-[200%] h-full" style={{ animation: `wave ${d}s linear infinite` }}>
        {[0, 1].map((k) => (
          <svg key={k} viewBox="0 0 400 200" preserveAspectRatio="none" className="w-1/2 h-full">
            <defs>
              <linearGradient id={`wg-${d}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity={opacity} />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${crest} V 200 H 0 Z`} fill={`url(#wg-${d})`} />
            {line && <path d={crest} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
          </svg>
        ))}
      </div>
    </div>
  );
}

export default function Hero() {
  const alreadySeen = useSyncExternalStore(() => () => {}, seen, () => true);
  const [closed, setClosed] = useState(false);
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const open = !alreadySeen && !closed;

  const close = useCallback(() => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
    setLeaving(true);
    setTimeout(() => setClosed(true), 450);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hero-title"
      className={`fixed inset-0 z-50 overflow-hidden bg-bg transition-opacity duration-500 ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,var(--accent-soft),transparent_60%)]" aria-hidden />
      {/* Rising water, behind the text */}
      <div className="absolute inset-x-0 bottom-0 h-[46%] origin-bottom" style={{ animation: "water-up 3.4s cubic-bezier(0.22,0.8,0.25,1) both" }} aria-hidden>
        <div className="absolute inset-x-0 -top-2 h-full">
          <Wave d={19} opacity={0.1} />
        </div>
        <div className="absolute inset-x-0 top-3 h-full">
          <Wave d={11} opacity={0.2} line />
        </div>
      </div>
      {/* NWS thresholds, marked on the right like a depth gauge */}
      <div className="absolute right-4 sm:right-10 bottom-[8%] hidden sm:flex flex-col gap-7 font-mono text-[10px] text-muted text-right" aria-hidden>
        {(["hero.t60", "hero.t30", "hero.t15"] as Key[]).map((k, i) => [t(k), i] as const).map(([s, i]) => (
          <span key={s} className="rise flex items-center gap-2 justify-end" style={{ animationDelay: `${1.4 + i * 0.3}s` }}>
            {s} <span className="w-8 h-px bg-current" />
          </span>
        ))}
      </div>

      <div className="relative z-10 h-full max-w-3xl mx-auto px-6 flex flex-col justify-center pb-[10vh]">
        <p className="rise eyebrow flex items-center gap-2" style={{ animationDelay: "0.1s" }}>
          <span className="text-accent">
            <Mark size={16} />
          </span>
          {t("hero.eyebrow", { brand: BRAND })}
        </p>
        <h1 id="hero-title" className="rise font-display text-[44px] sm:text-[72px] leading-[0.98] tracking-tight text-text mt-5" style={{ animationDelay: "0.25s" }}>
          {t("hero.h1")}
          <em className="text-accent">{t("hero.h1em")}</em>
        </h1>
        <p className="rise font-display italic text-[22px] sm:text-[28px] text-text/90 mt-5" style={{ animationDelay: "0.45s" }}>
          {t("tagline")}
        </p>
        <p className="rise text-[15px] sm:text-[17px] text-muted max-w-xl mt-4 leading-relaxed" style={{ animationDelay: "0.6s" }}>
          {t("hero.body", { brand: BRAND })}
        </p>
        <div className="rise flex flex-wrap items-center gap-3 mt-9" style={{ animationDelay: "0.85s" }}>
          <button onClick={close} autoFocus className="rounded-full bg-accent text-accent-ink px-6 py-3 text-[15px] font-medium shadow-[0_0_40px_-8px_var(--accent)] hover:scale-[1.03] transition-transform">
            {t("hero.open")}
          </button>
          <button onClick={close} className="text-[13px] text-muted hover:text-text px-2 py-3">
            {t("hero.skip")}
          </button>
        </div>
        <p className="rise font-mono text-[10.5px] text-faint mt-10" style={{ animationDelay: "1s" }}>
          {t("hero.source", { brand: BRAND })}
        </p>
      </div>
    </div>
  );
}
