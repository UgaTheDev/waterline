"use client";
import { useEffect, useState } from "react";
import { api, type EvalResult } from "@/lib/api";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function EvalStats() {
  const [res, setRes] = useState<EvalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.eval().then(setRes, (e: Error) => setError(e.message));
  }, []);

  const pending = !res || !("miss_rate" in res) || res.n === 0;
  const stats =
    res && "miss_rate" in res && res.n > 0
      ? [
          { label: "Dangerous-road miss rate", value: pct(res.miss_rate), note: "Photos with water over 15 cm that we would have let a sedan through. Target: 0.", lead: true },
          { label: "Interval coverage", value: pct(res.coverage), note: "How often the measured depth falls inside our low–high range." },
          { label: "Mean absolute error", value: `${res.mae_cm.toFixed(1)} cm`, note: "Average gap between estimate and measured depth." },
          { label: "Abstained", value: pct(res.abstain_rate), note: "No readable reference, so we said depth unknown (and blocked it)." },
          ...(res.false_block_rate !== undefined
            ? [{ label: "False-block rate", value: pct(res.false_block_rate), note: "Shallow water we blocked anyway. The cost of caution." }]
            : []),
        ]
      : [];

  if (error || pending)
    return (
      <div className="rounded-2xl border border-dashed border-line-strong bg-panel p-6">
        <p className="eyebrow">Evaluation</p>
        <p className="font-display text-[28px] text-text mt-1">{error ? "Results unavailable" : res ? "Evaluation pending" : "Loading…"}</p>
        <p className="text-[13px] text-muted mt-1 max-w-lg">
          {error
            ? `The results service didn't respond (${error}).`
            : "Numbers appear here once the held-out test set of USGS high-water-mark photos has been scored. We publish them whatever they say."}
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`rise rounded-2xl border p-5 ${s.lead ? "sm:col-span-2 border-accent/50 bg-accent-soft" : "border-line bg-panel"}`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <p className="eyebrow">{s.label}</p>
            <p className={`font-mono tabular-nums mt-2 text-text ${s.lead ? "text-[48px] leading-none" : "text-[30px] leading-none"}`}>{s.value}</p>
            <p className="text-[12.5px] text-muted mt-2">{s.note}</p>
          </div>
        ))}
      </div>
      {res && "by_reference" in res && Object.keys(res.by_reference ?? {}).length > 0 && (
        <div className="rounded-2xl border border-line bg-panel overflow-hidden">
          <p className="eyebrow px-5 pt-4">Error by reference object</p>
          <table className="w-full mt-2 text-[13px]">
            <thead>
              <tr className="text-left">
                <th className="eyebrow font-normal px-5 py-2">Reference</th>
                <th className="eyebrow font-normal px-5 py-2 text-right">Photos</th>
                <th className="eyebrow font-normal px-5 py-2 text-right">MAE</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(res.by_reference)
                .sort((a, b) => b[1].n - a[1].n)
                .map(([k, v]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="px-5 py-2 text-text">{k}</td>
                    <td className="px-5 py-2 text-right font-mono text-muted tabular-nums">{v.n}</td>
                    <td className="px-5 py-2 text-right font-mono text-text tabular-nums">{v.mae_cm.toFixed(1)} cm</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {res && "split" in res && (
        <p className="font-mono text-[11px] text-faint">
          n = {res.n}
          {res.n_dangerous !== undefined && ` · ${res.n_dangerous} dangerous`}
          {res.misses !== undefined && ` · ${res.misses} missed`} · {res.split} split
          {res.model && ` · ${res.model}`}
          {res.prompt_version && ` · prompt ${res.prompt_version}`}
          {res.note ? ` · ${res.note}` : ""}
        </p>
      )}
    </div>
  );
}
