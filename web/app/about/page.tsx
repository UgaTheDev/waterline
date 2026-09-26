import { BRAND } from "@/lib/brand";
import type { Metadata } from "next";
import Link from "next/link";
import EvalStats from "@/components/EvalStats";

export const metadata: Metadata = { title: `How it works · ${BRAND}` };

const thresholds = [
  { cm: 15, inch: 6, text: "Reaches the bottom of most cars. Enough to stall an engine or lose control." },
  { cm: 30, inch: 12, text: "Moving water this deep floats many vehicles." },
  { cm: 60, inch: 24, text: "Rushing water sweeps away most vehicles, including SUVs and pickups." },
];

const steps = [
  { k: "Ingest", title: "Photos and video come in", text: "From people on the street. For the demo, public-domain and CC BY imagery from Hurricane Harvey, replayed in time order." },
  {
    k: "Cosmos Reason 2 · Nebius AI Cloud",
    title: "The model reads the waterline",
    text: "NVIDIA Cosmos Reason 2, self-hosted on Nebius AI Cloud, finds objects of known height in the frame (curb, tire, door sill, hydrant) and returns a depth range with a confidence. If it can't read the depth, it says so, and that is never treated as zero.",
  },
  { k: "Fusion", title: "Reports land on streets", text: "Each estimate snaps to the nearest road within 30 m. Reports fade over time. A street with no reports stays uncoloured: unknown, never dry." },
  { k: "Routing", title: "Routes respect your vehicle", text: "Routing uses the upper bound of every estimate. It blocks any street above your vehicle's limit, and any water of unknown depth. Unreported streets inside an NWS warning cost ten times more." },
  {
    k: "Nemotron · Nebius Token Factory",
    title: "An agent explains the route",
    text: "An NVIDIA Nemotron agent on Nebius Token Factory plans trips and cites the photo, depth and time behind every avoided street. Tavily brings in local reports; flood warnings come from the NWS.",
  },
];

const credits = [
  ["Flood imagery", "USGS, NOAA, NWS and FEMA (US federal works, public domain); Wikimedia Commons under their stated CC licences. Credited on every report."],
  ["High-water marks", "USGS Short-Term Network, public domain."],
  ["Flood warnings", "National Weather Service; archived Harvey polygons via the Iowa Environmental Mesonet."],
  ["Map", "OpenFreeMap tiles, map data © OpenStreetMap contributors (ODbL). Geocoding by Nominatim."],
  ["Safety thresholds", "NWS “Turn Around, Don't Drown” and FEMA guidance."],
];

export default function About() {
  return (
    <main className="flex-1 w-full">
      <section className="max-w-4xl mx-auto px-5 pt-14 md:pt-20 pb-12">
        <p className="eyebrow rise">How it works</p>
        <h1 className="rise font-display text-[46px] md:text-[76px] leading-[0.98] tracking-tight text-text mt-4" style={{ animationDelay: "80ms" }}>
          How deep is the water on that street, <em className="text-accent">right now?</em>
        </h1>
        <p className="rise text-[16px] md:text-[18px] text-muted leading-relaxed mt-6 max-w-2xl" style={{ animationDelay: "180ms" }}>
          More than half of flood deaths happen in vehicles. People drive into water because nothing tells them how deep it is, and river gauges don&apos;t
          sit on streets. {BRAND} turns ordinary photos of flooded roads into street-level depth, and plans routes around it for the vehicle you drive.
        </p>
      </section>

      <section className="border-y border-line bg-panel">
        <div className="max-w-4xl mx-auto px-5 py-12 grid md:grid-cols-[1fr_1.4fr] gap-8 items-start">
          <div>
            <p className="eyebrow">National Weather Service</p>
            <p className="font-display text-[44px] leading-none text-text mt-2">
              Turn Around,
              <br />
              <em className="text-danger">Don&apos;t Drown.</em>
            </p>
          </div>
          <ol className="relative">
            {thresholds.map((t) => (
              <li key={t.cm} className="grid grid-cols-[88px_1fr] gap-4 py-4 border-b border-line last:border-0">
                <span>
                  <span className="block font-mono text-[28px] leading-none text-text tabular-nums">{t.cm}</span>
                  <span className="font-mono text-[11px] text-faint">cm · {t.inch} in</span>
                </span>
                <span className="text-[14px] text-muted leading-relaxed self-center">{t.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-5 py-16">
        <h2 className="font-display text-[36px] text-text">From a photo to a route</h2>
        <ol className="mt-8 relative border-l border-line-strong ml-2">
          {steps.map((s, i) => (
            <li key={s.title} className="relative pl-8 pb-9 last:pb-0">
              <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-accent bg-bg" aria-hidden />
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent">
                0{i + 1} · {s.k}
              </p>
              <p className="text-[18px] text-text mt-1">{s.title}</p>
              <p className="text-[14px] text-muted leading-relaxed mt-1 max-w-2xl">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-16">
        <h2 className="font-display text-[36px] text-text">How well it works</h2>
        <p className="text-[14px] text-muted mt-2 mb-6 max-w-2xl">
          We score the depth model on public-domain photos with measured depths. The number that matters most is the dangerous-road miss rate, and we never
          trade it for a better average error.
        </p>
        <EvalStats />
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-16">
        <h2 className="font-display text-[36px] text-text">Data and credits</h2>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {credits.map(([k, v]) => (
            <div key={k} className="grid md:grid-cols-[200px_1fr] gap-1 md:gap-6 py-3.5">
              <dt className="eyebrow md:pt-0.5">{k}</dt>
              <dd className="text-[14px] text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-20">
        <div className="rounded-2xl border border-danger/40 bg-danger-soft p-6 md:p-8">
          <p className="eyebrow text-danger!">Disclaimer</p>
          <p className="font-display text-[28px] md:text-[34px] leading-tight text-text mt-2">This tool never tells you a road is safe.</p>
          <p className="text-[14px] text-muted leading-relaxed mt-3 max-w-2xl">
            It shows only where water has been reported and how deep it appeared. &ldquo;No deep water reported&rdquo; means nobody has reported deep water, not
            that the road is clear. Water rises fast, currents are invisible, and roads can wash out underneath. Follow local officials, and never drive into
            flooded roads.
          </p>
          <Link href="/" className="inline-block mt-5 text-[14px] text-accent hover:underline">
            Back to the map →
          </Link>
        </div>
      </section>
    </main>
  );
}
