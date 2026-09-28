"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type UploadStatus } from "@/lib/api";
import { EvidenceItem } from "@/components/EvidenceCard";
import { useT, type Key } from "@/lib/i18n";

const POLL_MS = 3000;
const GIVE_UP_MS = 3 * 60_000;
const MAX_BYTES = 15 * 1024 * 1024;

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useT();

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const choose = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg(t("up.noGeo"));
    setGeoMsg(t("up.finding"));
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLon(p.coords.longitude.toFixed(6));
        setGeoMsg(t("up.locSet", { n: Math.round(p.coords.accuracy) }));
      },
      (e) => setGeoMsg(t("up.locFail", { e: e.message })),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const poll = (id: string, started: number) => {
    timer.current = setTimeout(async () => {
      try {
        const s = await api.uploadStatus(id);
        setStatus(s);
        if (s.status !== "queued") return setBusy(false);
      } catch (e) {
        setError((e as Error).message);
      }
      if (Date.now() - started > GIVE_UP_MS) {
        setTimedOut(true);
        return setBusy(false);
      }
      poll(id, started);
    }, POLL_MS);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError(t("up.needFile"));
    if (file.size > MAX_BYTES) return setError(t("up.tooBig"));
    const hasLat = lat.trim() !== "";
    const hasLon = lon.trim() !== "";
    if (hasLat !== hasLon) return setError(t("up.both"));
    if (hasLat && (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180))
      return setError(t("up.badLatLon"));
    setError(null);
    setTimedOut(false);
    setStatus(null);
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    if (hasLat) {
      form.append("lat", lat.trim());
      form.append("lon", lon.trim());
    }
    try {
      const s = await api.upload(form);
      setStatus(s);
      if (s.status === "queued") poll(s.obs_id, Date.now());
      else setBusy(false);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const [drag, setDrag] = useState(false);
  const phase = !status ? null : status.status === "queued" ? (timedOut ? "slow" : "queued") : status.status;

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8 md:py-14 grid md:grid-cols-[1fr_440px] gap-10 md:gap-14">
      <section className="space-y-6 rise">
        <p className="eyebrow">{t("nav.report")}</p>
        <h1 className="font-display text-[42px] md:text-[56px] leading-[1] tracking-tight text-text">
          {t("up.h1a")}
          <em className="text-accent">{t("up.h1b")}</em>
        </h1>
        <p className="text-[15px] text-muted leading-relaxed max-w-md">{t("up.intro")}</p>
        <ol className="space-y-3 max-w-md">
          {(
            [
              ["up.s1", "up.s1b"],
              ["up.s2", "up.s2b"],
              ["up.s3", "up.s3b"],
            ] as [Key, Key][]
          ).map(([h, b], i) => (
            <li key={h} className="flex gap-3">
              <span className="font-mono text-[11px] text-accent mt-0.5">0{i + 1}</span>
              <span>
                <span className="block text-[14px] text-text">{t(h)}</span>
                <span className="block text-[13px] text-muted">{t(b)}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="max-w-md rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[13px] text-text">
          <strong className="text-danger">{t("up.stayOut")}</strong>
          {t("up.stayOutB")}
        </p>
      </section>

      <div className="space-y-4 rise order-first md:order-none" style={{ animationDelay: "120ms" }}>
        <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-[13px] text-text">
          <span className="text-warn mt-px" aria-hidden>◷</span>
          {t("up.cold")}
        </p>

        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-line bg-panel p-5 shadow-[var(--shadow)]">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              choose(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`relative block cursor-pointer rounded-xl border border-dashed overflow-hidden transition-colors ${drag ? "border-accent bg-accent-soft" : "border-line-strong bg-panel-2 hover:border-accent/60"}`}
          >
            <input type="file" accept="image/*,video/mp4" onChange={(e) => choose(e.target.files?.[0] ?? null)} className="sr-only" />
            {preview ? (
              <span className="relative block">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img src={preview} alt={t("up.selected")} className="w-full max-h-64 object-cover" />
                {busy && (
                  <span className="absolute inset-0 bg-bg/30" aria-hidden>
                    <span className="absolute inset-x-0 h-0.5 bg-accent shadow-[0_0_16px_var(--accent)]" style={{ animation: "scan 2.2s ease-in-out infinite" }} />
                  </span>
                )}
              </span>
            ) : (
              <span className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" aria-hidden>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 16l5-5 4 4 3-3 6 6" />
                </svg>
                <span className="text-[14px] text-text">{file ? file.name : t("up.choose")}</span>
                <span className="font-mono text-[11px] text-faint">{t("up.drop")}</span>
              </span>
            )}
          </label>
          {file && preview && <p className="-mt-3 font-mono text-[11px] text-faint truncate">{file.name}</p>}

          <fieldset className="space-y-2.5">
            <legend className="eyebrow mb-2">{t("up.where")}</legend>
            <button type="button" onClick={locate} className="w-full flex items-center justify-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[13.5px] text-text hover:border-accent/60 transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" aria-hidden>
                <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
              {t("up.useLoc")}
            </button>
            {geoMsg && <p className="text-[12px] text-muted">{geoMsg}</p>}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  [t("up.lat"), lat, setLat, "29.7604"],
                  [t("up.lon"), lon, setLon, "-95.3698"],
                ] as const
              ).map(([label, v, set, ph]) => (
                <label key={label} className="block">
                  <span className="eyebrow">{label}</span>
                  <input
                    value={v}
                    onChange={(e) => set(e.target.value)}
                    inputMode="decimal"
                    placeholder={ph}
                    className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[13px] text-text placeholder:text-faint focus:outline-none focus:border-accent"
                  />
                </label>
              ))}
            </div>
            <p className="text-[12px] text-faint">{t("up.optional")}</p>
          </fieldset>

          <p className="text-[12px] text-muted leading-relaxed">
            {t("up.privacy")}
          </p>
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent text-accent-ink text-[14px] font-medium py-3 disabled:opacity-60 hover:brightness-110 transition">
            {busy ? <span className="animate-pulse">{t("up.reading")}</span> : t("up.submit")}
          </button>
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </form>

        {status && (
          <section className="rise rounded-2xl border border-line bg-panel p-5 space-y-3" aria-live="polite">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2 h-2 rounded-full ${phase === "done" ? "bg-accent text-accent" : phase === "rejected" ? "bg-danger text-danger" : "bg-warn text-warn live-dot"}`}
              />
              <p className="eyebrow text-text!">
                {t(phase === "queued" ? "up.processing" : phase === "slow" ? "up.still" : phase === "done" ? "up.done" : "up.notAdded")}
              </p>
            </div>
            {status.message && <p className="text-[13px] text-muted">{status.message}</p>}
            {timedOut && (
              <p className="text-[13px] text-muted">
                {t("up.slow")}
              </p>
            )}
            {status.result && <EvidenceItem ev={status.result} />}
            {phase === "done" && (
              <Link href="/" className="inline-block text-[13px] text-accent hover:underline">
                {t("up.view")}
              </Link>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
