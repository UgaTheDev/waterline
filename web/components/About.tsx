"use client";
import { BRAND } from "@/lib/brand";
import Link from "next/link";
import EvalStats from "@/components/EvalStats";
import { SimulationGallery } from "@/components/Simulation";
import { useLang } from "@/lib/i18n";

// The long prose lives here as one block per language (same shape), rather than as dozens of i18n keys.
const COPY = {
  en: {
    eyebrow: "How it works",
    h1: "How deep is the water on that street, ",
    h1em: "right now?",
    lead: `More than half of flood deaths happen in vehicles. People drive into water because nothing tells them how deep it is, and river gauges don't sit on streets. ${BRAND} turns ordinary photos of flooded roads into street-level depth, and plans routes around it for the vehicle you drive.`,
    nws: "National Weather Service",
    slogan1: "Turn Around,",
    slogan2: "Don't Drown.",
    sloganEn: "",
    inch: "in",
    thresholds: [
      { cm: 15, inch: 6, text: "Reaches the bottom of most cars. Enough to stall an engine or lose control." },
      { cm: 30, inch: 12, text: "Moving water this deep floats many vehicles." },
      { cm: 60, inch: 24, text: "Rushing water sweeps away most vehicles, including SUVs and pickups." },
    ],
    stepsTitle: "From a photo to a route",
    steps: [
      { k: "Ingest", title: "Photos and video come in", text: "From people on the street. For the demo, public-domain and CC BY imagery from Hurricane Harvey, replayed in time order." },
      {
        k: "Nemotron Nano 2 VL · Nebius",
        title: "The model reads the waterline",
        text: "NVIDIA Nemotron Nano 2 VL on Nebius Token Factory (benchmarked against Cosmos Reason 2 self-hosted on Nebius AI Cloud; we ship whichever misses fewer dangerous roads) finds objects of known height in the frame (curb, tire, door sill, hydrant) and returns a depth range with a confidence. If it can't read the depth, it says so, and that is never treated as zero.",
      },
      { k: "Fusion", title: "Reports land on streets", text: "Each estimate snaps to the nearest road within 30 m. Reports fade over time. A street with no reports stays uncoloured: unknown, never dry." },
      {
        k: "Routing",
        title: "Routes respect your vehicle",
        text: "Routing uses the upper bound of every estimate. It blocks any street above your vehicle's limit, and any water of unknown depth. Unreported streets inside an NWS warning cost ten times more.",
      },
      {
        k: "Nemotron · Nebius Token Factory",
        title: "An agent explains the route",
        text: "An NVIDIA Nemotron agent on Nebius Token Factory plans trips and cites the photo, depth and time behind every avoided street. Tavily brings in local reports; flood warnings come from the NWS.",
      },
    ],
    fillTitle: "How the map fills in",
    fill: ["Reports are sparse, and a street nobody photographed is not a dry street. So next to ", "observed", " streets, the map draws ", "inferred", " ones: depth carried over from nearby reports and adjusted for ground elevation (USGS 3DEP)."],
    observedKey: "observed: a photo, dashcam or voice report",
    inferredKey: "inferred from nearby reports + terrain",
    inferRules: [
      ["Additive only", "An inferred street only ever adds water. It is never 0 cm, never dry, and never lowers a real report."],
      ["Always labeled", "Inferred streets are dashed and dimmer than observed ones, and their report card says which reports they came from."],
      ["Uncertainty grows", "The further a street is from the reports behind it, the wider its range. Inferred streets are shown, never used for routing."],
    ],
    riskTitle: "Flood risk",
    risk: "We built a “flood risk next hour” layer from Harvey rainfall, low ground that holds water, and height above the nearest bayou, then tested it on streets it had never seen. It didn't beat a terrain-only baseline: the rain data is about 12 km coarse, and Harvey's worst street flooding came days after the rain, from reservoir releases. So it's switched off. A risk layer that isn't better than a guess would send people the wrong way, and we'd rather tell you that than show you a pretty haze.",
    voiceTitle: "Voice & drive mode",
    voice: "Ask the agent out loud, or tell it what you see (“water's up to my knees at Main and 5th”) and it files a low-confidence voice report. Drive mode reads a dashcam frame every few seconds; when it sees water ahead it files a report, speaks the depth against your vehicle's limit, and reroutes. Dashcam frames are never stored, and silence never means the road is clear.",
    simTitle: "Simulations",
    sim: "To show what a depth means, NVIDIA Cosmos Transfer renders a street at a given depth. These clips are generated, labeled on every frame, and never used as evidence or for routing.",
    evalTitle: "How well it works",
    eval: "We score the depth model on public-domain and CC BY flood photos labelled in depth bands, from four US flood events. The number that matters most is the dangerous-road miss rate, and we never trade it for a better average error.",
    creditsTitle: "Data and credits",
    credits: [
      ["Flood imagery", "USGS, NOAA, NWS and FEMA (US federal works, public domain); Wikimedia Commons under their stated CC licences. Credited on every report."],
      ["High-water marks", "USGS Short-Term Network, public domain."],
      ["Flood warnings", "National Weather Service; archived Harvey polygons via the Iowa Environmental Mesonet."],
      ["Map", "OpenFreeMap tiles, map data © OpenStreetMap contributors (ODbL). Geocoding by Nominatim."],
      ["Safety thresholds", "NWS “Turn Around, Don't Drown” and FEMA guidance."],
    ],
    respTitle: "For responders",
    resp: "Responder mode needs a token. It lists photos the depth model flagged for a possible person in the water or an occupied vehicle, for a person to review, and routes a high-water rescue truck (90 cm). Flags never appear on the public map. Flags come from an AI model and can be wrong both ways. Never assume no one needs help.",
    respLink: "Open responder mode →",
    discEyebrow: "Disclaimer",
    discTitle: "This tool never tells you a road is safe.",
    disc: "It shows only where water has been reported and how deep it appeared. “No deep water reported” means nobody has reported deep water, not that the road is clear. Water rises fast, currents are invisible, and roads can wash out underneath. Follow local officials, and never drive into flooded roads.",
    back: "Back to the map →",
  },
  es: {
    eyebrow: "Cómo funciona",
    h1: "¿Qué tan profunda está el agua en esa calle ",
    h1em: "ahora mismo?",
    lead: `Más de la mitad de las muertes por inundación ocurren en vehículos. La gente maneja hacia el agua porque nada le dice qué tan profunda es, y los medidores de los ríos no están en las calles. ${BRAND} convierte fotos comunes de calles inundadas en profundidad a nivel de calle, y planea rutas alrededor del agua para el vehículo que usted maneja.`,
    nws: "Servicio Nacional de Meteorología (NWS)",
    slogan1: "¡Dé la vuelta,",
    slogan2: "no se ahogue!",
    sloganEn: "Turn Around, Don't Drown.",
    inch: "pulg",
    thresholds: [
      { cm: 15, inch: 6, text: "Llega a la parte de abajo de la mayoría de los autos. Basta para apagar el motor o perder el control." },
      { cm: 30, inch: 12, text: "El agua en movimiento a esta profundidad hace flotar a muchos vehículos." },
      { cm: 60, inch: 24, text: "El agua con corriente arrastra a la mayoría de los vehículos, incluso SUV y camionetas." },
    ],
    stepsTitle: "De una foto a una ruta",
    steps: [
      { k: "Entrada", title: "Llegan fotos y videos", text: "De personas en la calle. Para la demostración, imágenes de dominio público y CC BY del huracán Harvey, repetidas en orden cronológico." },
      {
        k: "Nemotron Nano 2 VL · Nebius",
        title: "El modelo lee la línea del agua",
        text: "NVIDIA Nemotron Nano 2 VL en Nebius Token Factory (comparado con Cosmos Reason 2 alojado en Nebius AI Cloud; usamos el que falla menos en calles peligrosas) encuentra objetos de altura conocida en la imagen (banqueta, llanta, estribo de la puerta, hidrante) y devuelve un rango de profundidad con un nivel de confianza. Si no puede leer la profundidad, lo dice, y eso nunca se toma como cero.",
      },
      {
        k: "Fusión",
        title: "Los reportes se asignan a las calles",
        text: "Cada estimación se asigna a la calle más cercana a menos de 30 m. Los reportes pierden peso con el tiempo. Una calle sin reportes queda sin color: desconocida, nunca seca.",
      },
      {
        k: "Rutas",
        title: "Las rutas respetan su vehículo",
        text: "Las rutas usan el límite superior de cada estimación. Bloquean toda calle por encima del límite de su vehículo y toda agua de profundidad desconocida. Las calles sin reportes dentro de un aviso del NWS cuestan diez veces más.",
      },
      {
        k: "Nemotron · Nebius Token Factory",
        title: "Un agente explica la ruta",
        text: "Un agente NVIDIA Nemotron en Nebius Token Factory planea viajes y cita la foto, la profundidad y la hora detrás de cada calle evitada. Tavily trae reportes locales; los avisos de inundación vienen del NWS.",
      },
    ],
    fillTitle: "Cómo se llena el mapa",
    fill: ["Los reportes son escasos, y una calle que nadie fotografió no es una calle seca. Por eso, junto a las calles ", "observadas", ", el mapa dibuja calles ", "inferidas", ": profundidad tomada de reportes cercanos y ajustada según la elevación del terreno (USGS 3DEP)."],
    observedKey: "observada: un reporte de foto, cámara del auto o voz",
    inferredKey: "inferida de reportes cercanos + terreno",
    inferRules: [
      ["Solo suma", "Una calle inferida solo agrega agua. Nunca es 0 cm, nunca es seca y nunca rebaja un reporte real."],
      ["Siempre marcada", "Las calles inferidas se dibujan con guiones y más tenues que las observadas, y su tarjeta dice de qué reportes vienen."],
      ["La incertidumbre crece", "Mientras más lejos está una calle de sus reportes, más amplio es su rango. Las calles inferidas se muestran, pero nunca deciden una ruta."],
    ],
    riskTitle: "Riesgo de inundación",
    risk: "Construimos una capa de “riesgo de inundación en la próxima hora” con la lluvia de Harvey, el terreno bajo que retiene agua y la altura sobre el bayou más cercano, y la probamos en calles que nunca había visto. No superó a una referencia basada solo en el terreno: los datos de lluvia tienen una resolución de unos 12 km, y las peores inundaciones de calles en Harvey llegaron días después de la lluvia, por las descargas de las presas. Por eso está apagada. Una capa de riesgo que no es mejor que adivinar mandaría a la gente por el camino equivocado, y preferimos decírselo antes que mostrarle una neblina bonita.",
    voiceTitle: "Voz y modo manejo",
    voice: "Pregúntele al agente en voz alta, o dígale lo que ve (“el agua me llega a las rodillas en Main y 5th”) y registrará un reporte de voz de confianza baja. El modo manejo lee una imagen de la cámara cada pocos segundos; cuando ve agua adelante registra un reporte, dice la profundidad comparada con el límite de su vehículo y cambia la ruta. Las imágenes de la cámara nunca se guardan, y el silencio nunca significa que la calle esté libre de agua.",
    simTitle: "Simulaciones",
    sim: "Para mostrar lo que significa una profundidad, NVIDIA Cosmos Transfer genera una calle a esa profundidad. Estos clips son generados, llevan una etiqueta en cada cuadro y nunca se usan como evidencia ni para las rutas.",
    evalTitle: "Qué tan bien funciona",
    eval: "Calificamos el modelo de profundidad con fotos de inundaciones de dominio público y CC BY, etiquetadas por rangos de profundidad, de cuatro eventos en EE. UU. El número que más importa es la tasa de fallos en calles peligrosas, y nunca la cambiamos por un mejor error promedio.",
    creditsTitle: "Datos y créditos",
    credits: [
      ["Imágenes de inundación", "USGS, NOAA, NWS y FEMA (obras federales de EE. UU., dominio público); Wikimedia Commons bajo sus licencias CC indicadas. Con crédito en cada reporte."],
      ["Marcas de agua", "Red de corto plazo (Short-Term Network) del USGS, dominio público."],
      ["Avisos de inundación", "Servicio Nacional de Meteorología; polígonos archivados de Harvey vía el Iowa Environmental Mesonet."],
      ["Mapa", "Mosaicos de OpenFreeMap, datos del mapa © colaboradores de OpenStreetMap (ODbL). Geocodificación por Nominatim."],
      ["Umbrales de seguridad", "NWS “¡Dé la vuelta, no se ahogue!” (Turn Around, Don't Drown) y guías de FEMA."],
    ],
    respTitle: "Para rescatistas",
    resp: "El modo rescatista necesita un token. Muestra las fotos que el modelo de profundidad marcó por una posible persona en el agua o un vehículo ocupado, para que una persona las revise, y planea rutas para un camión de rescate para agua alta (90 cm). Las alertas nunca aparecen en el mapa público. Las alertas vienen de un modelo de IA y pueden fallar en ambos sentidos. Nunca suponga que nadie necesita ayuda.",
    respLink: "Abrir el modo rescatista →",
    discEyebrow: "Aviso",
    discTitle: "Esta herramienta nunca le dirá que una calle no tiene peligro.",
    disc: "Solo muestra dónde se ha reportado agua y qué tan profunda se veía. “No se reporta agua profunda” significa que nadie ha reportado agua profunda, no que la calle esté libre de agua. El agua sube rápido, las corrientes no se ven y las calles pueden deslavarse por debajo. Siga a las autoridades locales y nunca maneje por calles inundadas.",
    back: "Volver al mapa →",
  },
};

export default function About() {
  const c = COPY[useLang()];
  return (
    <main className="flex-1 w-full">
      <section className="max-w-4xl mx-auto px-5 pt-14 md:pt-20 pb-12">
        <p className="eyebrow rise">{c.eyebrow}</p>
        <h1 className="rise font-display text-[46px] md:text-[76px] leading-[0.98] tracking-tight text-text mt-4" style={{ animationDelay: "80ms" }}>
          {c.h1}
          <em className="text-accent">{c.h1em}</em>
        </h1>
        <p className="rise text-[16px] md:text-[18px] text-muted leading-relaxed mt-6 max-w-2xl" style={{ animationDelay: "180ms" }}>
          {c.lead}
        </p>
      </section>

      <section className="border-y border-line bg-panel">
        <div className="max-w-4xl mx-auto px-5 py-12 grid md:grid-cols-[1fr_1.4fr] gap-8 items-start">
          <div>
            <p className="eyebrow">{c.nws}</p>
            <p className="font-display text-[44px] leading-none text-text mt-2">
              {c.slogan1}
              <br />
              <em className="text-danger">{c.slogan2}</em>
            </p>
            {c.sloganEn && <p className="font-mono text-[11px] text-faint mt-2">{c.sloganEn}</p>}
          </div>
          <ol className="relative">
            {c.thresholds.map((t) => (
              <li key={t.cm} className="grid grid-cols-[88px_1fr] gap-4 py-4 border-b border-line last:border-0">
                <span>
                  <span className="block font-mono text-[28px] leading-none text-text tabular-nums">{t.cm}</span>
                  <span className="font-mono text-[11px] text-faint">
                    cm · {t.inch} {c.inch}
                  </span>
                </span>
                <span className="text-[14px] text-muted leading-relaxed self-center">{t.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-5 py-16">
        <h2 className="font-display text-[36px] text-text">{c.stepsTitle}</h2>
        <ol className="mt-8 relative border-l border-line-strong ml-2">
          {c.steps.map((s, i) => (
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

      <section className="border-y border-line bg-panel">
        <div className="max-w-4xl mx-auto px-5 py-14">
          <h2 className="font-display text-[36px] text-text">{c.fillTitle}</h2>
          <p className="text-[14px] text-muted mt-2 max-w-2xl leading-relaxed">
            {c.fill[0]}
            <span className="text-text">{c.fill[1]}</span>
            {c.fill[2]}
            <span className="text-text">{c.fill[3]}</span>
            {c.fill[4]}
          </p>
          <div className="mt-6 flex flex-wrap gap-6 font-mono text-[11.5px] text-muted">
            <span className="flex items-center gap-2.5">
              <span className="inline-block w-8 h-[5px] rounded-full" style={{ background: "var(--danger)" }} aria-hidden /> {c.observedKey}
            </span>
            <span className="flex items-center gap-2.5">
              <span className="inline-block w-8 h-[5px] rounded-full opacity-60" style={{ background: "repeating-linear-gradient(90deg, var(--danger) 0 5px, transparent 5px 8px)" }} aria-hidden />{" "}
              {c.inferredKey}
            </span>
          </div>
          <ul className="mt-6 grid md:grid-cols-3 gap-3">
            {c.inferRules.map(([k, v]) => (
              <li key={k} className="rounded-xl border border-line bg-bg/40 p-4">
                <p className="text-[15px] text-text">{k}</p>
                <p className="text-[13px] text-muted mt-1 leading-relaxed">{v}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-5 py-16 grid md:grid-cols-2 gap-10">
        <div>
          <h2 className="font-display text-[32px] text-text">{c.riskTitle}</h2>
          <p className="text-[14px] text-muted mt-2 leading-relaxed">{c.risk}</p>
        </div>
        <div>
          <h2 className="font-display text-[32px] text-text">{c.voiceTitle}</h2>
          <p className="text-[14px] text-muted mt-2 leading-relaxed">{c.voice}</p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-16">
        <h2 className="font-display text-[36px] text-text">{c.simTitle}</h2>
        <p className="text-[14px] text-muted mt-2 mb-6 max-w-2xl leading-relaxed">{c.sim}</p>
        <SimulationGallery />
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-16">
        <h2 className="font-display text-[36px] text-text">{c.evalTitle}</h2>
        <p className="text-[14px] text-muted mt-2 mb-6 max-w-2xl">{c.eval}</p>
        <EvalStats />
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-16">
        <h2 className="font-display text-[36px] text-text">{c.creditsTitle}</h2>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {c.credits.map(([k, v]) => (
            <div key={k} className="grid md:grid-cols-[200px_1fr] gap-1 md:gap-6 py-3.5">
              <dt className="eyebrow md:pt-0.5">{k}</dt>
              <dd className="text-[14px] text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-16">
        <h2 className="font-display text-[36px] text-text">{c.respTitle}</h2>
        <p className="text-[14px] text-muted mt-2 max-w-2xl leading-relaxed">{c.resp}</p>
        <Link href="/responder" className="inline-block mt-4 text-[14px] text-accent hover:underline">
          {c.respLink}
        </Link>
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-20">
        <div className="rounded-2xl border border-danger/40 bg-danger-soft p-6 md:p-8">
          <p className="eyebrow text-danger!">{c.discEyebrow}</p>
          <p className="font-display text-[28px] md:text-[34px] leading-tight text-text mt-2">{c.discTitle}</p>
          <p className="text-[14px] text-muted leading-relaxed mt-3 max-w-2xl">{c.disc}</p>
          <Link href="/" className="inline-block mt-5 text-[14px] text-accent hover:underline">
            {c.back}
          </Link>
        </div>
      </section>
    </main>
  );
}
