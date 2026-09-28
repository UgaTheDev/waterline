"use client";
import { useEffect, useState } from "react";
import { api, type EvalResult } from "@/lib/api";
import { useT } from "@/lib/i18n";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function EvalStats() {
  const [res, setRes] = useState<EvalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  useEffect(() => {
    api.eval().then(setRes, (e: Error) => setError(e.message));
  }, []);

  const pending = !res || !("miss_rate" in res) || res.n === 0;
  const stats =
    res && "miss_rate" in res && res.n > 0
      ? [
          { label: t("eval.miss"), value: pct(res.miss_rate), note: t("eval.missNote"), lead: true },
          { label: t("eval.cov"), value: pct(res.coverage), note: t("eval.covNote") },
          { label: t("eval.mae"), value: `${res.mae_cm.toFixed(1)} cm`, note: t("eval.maeNote") },
          { label: t("eval.abstain"), value: pct(res.abstain_rate), note: t("eval.abstainNote") },
          ...(res.false_block_rate !== undefined ? [{ label: t("eval.fb"), value: pct(res.false_block_rate), note: t("eval.fbNote") }] : []),
        ]
      : [];

  if (error || pending)
    return (
      <div className="rounded-2xl border border-dashed border-line-strong bg-panel p-6">
        <p className="eyebrow">{t("eval.title")}</p>
        <p className="font-display text-[28px] text-text mt-1">{t(error ? "eval.unavailable" : res ? "eval.pending" : "loading")}</p>
        <p className="text-[13px] text-muted mt-1 max-w-lg">
          {error
            ? t("eval.noResponse", { e: error })
            : t("eval.pendingNote")}
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
          <p className="eyebrow px-5 pt-4">{t("eval.byRef")}</p>
          <table className="w-full mt-2 text-[13px]">
            <thead>
              <tr className="text-left">
                <th className="eyebrow font-normal px-5 py-2">{t("eval.ref")}</th>
                <th className="eyebrow font-normal px-5 py-2 text-right">{t("eval.photos")}</th>
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
          {res.n_dangerous !== undefined && t("eval.dangerous", { n: res.n_dangerous })}
          {res.misses !== undefined && t("eval.missed", { n: res.misses })} · {t("eval.split", { s: res.split })}
          {res.model && ` · ${res.model}`}
          {res.prompt_version && t("eval.prompt", { p: res.prompt_version })}
          {res.note ? ` · ${res.note}` : ""}
        </p>
      )}
    </div>
  );
}
