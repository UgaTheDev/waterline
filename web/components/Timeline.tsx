"use client";
import { fmtClock, fmtDate, fmtDay, fmtTick } from "@/lib/depth";
import { useLang, useT } from "@/lib/i18n";

export const SPEEDS = [1, 4, 16];
const STEP = 15 * 60_000;

export default function Timeline(props: {
  start: number;
  end: number;
  t: number;
  onScrub: (t: number) => void;
  playing: boolean;
  onPlay: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  hist: number[]; // reports per hour, from start
  live: boolean;
}) {
  const { start, end, t, onScrub, playing, onPlay, speed, onSpeed, hist, live } = props;
  const tr = useT();
  const lang = useLang();
  const frac = (t - start) / (end - start);
  const hours = Math.round((t - start) / 3_600_000);
  const peak = Math.max(1, ...hist);
  const days: number[] = [];
  for (let d = new Date(start).setUTCHours(5, 0, 0, 0); d <= end; d += 86_400_000) if (d >= start) days.push(d); // local midnight (CDT = UTC-5)

  return (
    <div className="glass rounded-xl border border-line shadow-[var(--shadow)] px-3 py-2.5 flex items-center gap-3">
      <button
        onClick={onPlay}
        aria-label={tr(playing ? "tl.pause" : "tl.play")}
        className="w-10 h-10 shrink-0 rounded-full bg-accent text-accent-ink flex items-center justify-center shadow-[0_0_24px_-4px_var(--accent)] hover:scale-105 active:scale-95 transition-transform"
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden><rect x="1.5" y="0" width="3" height="12" rx="1" /><rect x="7.5" y="0" width="3" height="12" rx="1" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden><path d="M2.5 0.8l9 5.2-9 5.2z" /></svg>
        )}
      </button>

      <div className="shrink-0 w-[96px] sm:w-[148px]" aria-live="off">
        <p className="font-mono text-[19px] sm:text-[22px] leading-none text-text tabular-nums">{fmtClock(t)}</p>
        <p className="font-mono text-[10px] sm:text-[10.5px] text-muted mt-1 tracking-wide whitespace-nowrap">
          <span className="uppercase">{fmtDate(t, lang)}</span> · <span className="text-accent">{live ? tr("tl.live") : `T+${hours}h`}</span>
        </p>
      </div>

      <div className="relative flex-1 min-w-0 h-11">
        {/* Report-density sparkline; the played part is lit. */}
        <svg className="absolute inset-x-0 top-0 h-7 w-full" viewBox={`0 0 ${Math.max(1, hist.length)} 10`} preserveAspectRatio="none" aria-hidden>
          {hist.map((n, i) => (
            <rect
              key={i}
              x={i + 0.12}
              width="0.76"
              y={10 - Math.max(0.5, (n / peak) * 10)}
              height={Math.max(0.5, (n / peak) * 10)}
              fill={i / hist.length <= frac ? "var(--accent)" : "var(--line-strong)"}
              opacity={i / hist.length <= frac ? 0.75 : 1}
            />
          ))}
        </svg>
        <div className="absolute inset-x-0 top-7 h-px bg-line-strong" />
        {days.map((d) => (
          <span key={d} className="absolute top-7 font-mono text-[9.5px] text-faint -translate-x-1/2 pt-1 whitespace-nowrap hidden sm:block" style={{ left: `${((d - start) / (end - start)) * 100}%` }}>
            {fmtTick(d, lang)}
          </span>
        ))}
        <input
          type="range"
          className="scrub absolute inset-x-0 top-0 w-full"
          min={start}
          max={end}
          step={STEP}
          value={t}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label={tr("tl.time")}
          aria-valuetext={`${fmtDay(t, lang)} ${fmtClock(t)}`}
        />
      </div>

      <div className="shrink-0 flex flex-col gap-0.5" role="group" aria-label={tr("tl.speed")}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            aria-pressed={speed === s}
            className={`font-mono text-[10px] leading-none px-1.5 py-[3px] rounded ${speed === s ? "bg-panel-2 text-text" : "text-faint hover:text-muted"}`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
