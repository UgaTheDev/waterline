"use client";
import Link from "next/link";
import type { Vehicle } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { useT, type Key } from "@/lib/i18n";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mark } from "./Header";
import VehicleGauge, { VEHICLES, useRising } from "./VehicleGauge";

const KEY = "waterline-intro-seen";
const seen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(KEY, "1");
  } catch {}
};

// A real photo already in the repo (Hurricane Harvey, Houston, 2017), credited. Nothing is drawn on it.
const PHOTO = {
  src: "/mock/harvey-62096633.jpg",
  credit: "Chabad Lubavitch, CC BY 2.0, via Wikimedia Commons",
  url: "https://commons.wikimedia.org/wiki/File:Harvey_flooding_(36527844190).jpg",
};

// The gauge note for a depth (handoff 01). "no water" rather than "dry": this is a calculator, not a road state.
const note = (d: number): Key =>
  d === 0 ? "hero2.nNone" : d < 15 ? "hero2.nBelowCurb" : d <= 20 ? "hero2.nJustCurb" : d < 30 ? "hero2.nBelowSill" : d <= 45 ? "hero2.nOverSill" : "hero2.nOverTruck";

export default function Hero({ vehicles = VEHICLES }: { vehicles?: Vehicle[] }) {
  const alreadySeen = useSyncExternalStore(() => () => {}, seen, () => true);
  const [closed, setClosed] = useState(false);
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const [depth, setDepth] = useState(18);
  const shown = useRising(depth, 120);
  const open = !alreadySeen && !closed;
  const dialog = useRef<HTMLDivElement>(null);
  const fleet = vehicles.filter((v) => !v.responder_only).slice(0, 3);

  const close = useCallback(() => {
    markSeen();
    setLeaving(true);
    setTimeout(() => setClosed(true), 450);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      // Full-screen intro: keep Tab cycling inside it rather than leaking into the page underneath.
      if (e.key !== "Tab") return;
      const focusable = dialog.current?.querySelectorAll<HTMLElement>("button, a[href], input");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hero-title"
      className={`fixed inset-0 z-50 overflow-y-auto bg-bg transition-opacity duration-500 ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      <div className="max-w-xl mx-auto min-h-full flex flex-col">
        <div className="hero-photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static file in /public, shown as is */}
          <img src={PHOTO.src} alt={t("hero2.photoAlt")} className="absolute inset-0 w-full h-full object-cover" />
          <div className="hero-scrim" aria-hidden />
          <header className="absolute inset-x-0 top-0 pt-4 px-[22px] flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-display text-[24px] font-medium text-[#e6edf3]">
              <span className="text-[#a5f3fc]">
                <Mark size={20} />
              </span>
              {BRAND}
            </span>
            <Link href="/upload" onClick={markSeen} className="rounded-full border border-[rgba(230,237,243,.35)] px-3.5 py-2 text-[13px] font-medium text-[#e6edf3] hover:bg-white/10">
              {t("nav.report")}
            </Link>
          </header>
          <a
            href={PHOTO.url}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-[64px] left-[22px] right-[22px] w-fit font-mono text-[10.5px] tracking-[.06em] px-2 py-1 rounded bg-[rgba(7,11,16,.8)] border border-[rgba(230,237,243,.3)] text-[#e6edf3] hover:underline"
          >
            {t("hero2.credit", { c: PHOTO.credit })}
          </a>

          <div className="hero-glass absolute inset-x-4 bottom-4 rounded-2xl p-3 pb-2.5">
            <div className="flex justify-between items-baseline gap-2 mb-2">
              <span className="font-mono text-[10.5px] tracking-[.1em] uppercase text-[#a5f3fc]">{t("hero2.gauge")}</span>
              <span className="font-mono text-[15px] font-semibold text-[#e6edf3] tabular-nums">
                {Math.round(shown)} cm <span className="font-normal text-[12px] text-[#c4ccd6]">· {t(note(depth))}</span>
              </span>
            </div>
            <VehicleGauge depthCm={shown} vehicles={fleet} tone="hero" k={0.75} crop={130} H={100} ticks={[15, 30, 60]} gap={8 / 0.75} left={22 / 0.75} />
            <label className="mt-2 flex items-center gap-3 font-mono text-[10.5px] text-[#c4ccd6]">
              <span className="shrink-0">{t("hero2.try")}</span>
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                aria-valuetext={`${depth} cm`}
                className="flex-1 accent-[#67e8f9]"
              />
            </label>
            <p className="font-mono text-[10px] text-[#c4ccd6] mt-1">{t("hero2.gaugeNote")}</p>
          </div>
        </div>

        <div className="px-6 pt-6 pb-8 flex flex-col gap-3.5">
          <p className="font-mono text-[11px] tracking-[.14em] uppercase text-accent">{t("hero2.eyebrow")}</p>
          <h1 id="hero-title" className="font-display text-[35px] leading-[1.07] text-text [text-wrap:balance]">
            {t("tagline")}
          </h1>
          <p className="text-[15px] leading-[1.5] text-muted">{t("hero2.body")}</p>
          <div className="flex gap-2.5 mt-1">
            <button onClick={close} autoFocus className="flex-1 h-[52px] rounded-[14px] bg-accent text-accent-ink text-[16px] font-semibold">
              {t("hero2.open")}
            </button>
            <Link href="/about" onClick={markSeen} className="h-[52px] px-4 rounded-[14px] bg-panel border border-line-strong text-text text-[15px] font-medium flex items-center">
              {t("hero2.how")}
            </Link>
          </div>
          <p className="font-mono text-[10.5px] text-faint mt-2">{t("hero.source", { brand: BRAND })}</p>
        </div>
      </div>
    </div>
  );
}
