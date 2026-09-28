"""Nemotron (Nebius Token Factory) agent. Read-only tools; road status always comes from the router."""
import json, re, unicodedata
from openai import OpenAI, BadRequestError
from . import events, profiles as P
from .alerts import local_reports
from .geocode import geocode

SYSTEM = """You help drivers in {city} avoid flooded streets during {event}.
Use the tools; never guess road conditions. Rules you must follow:
- Never say a road or route is "safe". Say "no deep water reported" and remind that unreported streets are unknown, not dry.
- For every street the route avoids, name it and give the reported depth, the evidence time and the reference object.
- If no route exists, say so plainly and advise not to drive: "Turn Around, Don't Drown."
- A street with basis "inferred" was estimated from nearby reports and terrain, not reported: say "estimated", never "reported".
- Cite local news only as unverified context. Be brief: at most 6 sentences.
- If the user describes water they see ("up to my knees at Main and 5th"), call file_report once with the place and
  what the water reached, then thank them and remind them not to walk or drive into it."""

# Appended only for lang=es, so the English prompt stays byte-identical.
SYSTEM_ES = """
- The user reads Spanish: answer in Spanish (usted). Never call a road "seguro"/"segura", "seco" or "despejado".
  Say "No se reporta agua profunda" and "Sin reportes no significa seco". The slogan is "¡Dé la vuelta, no se ahogue!"."""

TOOLS = [
    {"type": "function", "function": {"name": "route", "description": "Driving route that avoids water too deep for the vehicle.",
     "parameters": {"type": "object", "properties": {
         "origin": {"type": "string", "description": "place name, address, or 'here' for the user's location"},
         "destination": {"type": "string"}, "vehicle": {"type": "string", "enum": list(P.VEHICLES)}},
         "required": ["origin", "destination"]}}},
    {"type": "function", "function": {"name": "segment_status", "description": "Reported flood depths on streets near a place.",
     "parameters": {"type": "object", "properties": {"place": {"type": "string"}}, "required": ["place"]}}},
    {"type": "function", "function": {"name": "active_alerts", "description": "NWS flood warnings active now.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "file_report", "description": "File the user's own eyewitness flood report.",
     "parameters": {"type": "object", "properties": {
         "place": {"type": "string", "description": "street, intersection or landmark, or 'here'"},
         "reached": {"type": "string", "description": "what the water reached, e.g. ankles, knees, waist, curb, car doors, tire tops"}},
         "required": ["place", "reached"]}}},
    {"type": "function", "function": {"name": "local_reports", "description": "Local news / road-closure reports (unverified).",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
]

# Claims the product must never make about a road: "safe"/"safer"/"safely"/"safest" (also spelled s-a-f-e), and
# affirmative "dry"/"clear"/"passable". Negations ("not safe", "unsafe", "not dry") are fine.
_CONFUSABLE = str.maketrans("аеорсухѕіјԁ", "aeopcyxsijd")  # Cyrillic look-alikes
_INVISIBLE = re.compile(r"[\u00ad\u200b-\u200f\u2060\ufeff]")
UNSAFE_CLAIM = re.compile(r"(?<!un)(?<!not )(?<!never )(?<!isn't )\bs[\W_]{0,2}a[\W_]{0,2}f[\W_]{0,2}e(st|r|ly|ty)?\b"
                          r"|\b(is|are|looks|seems|stays|remains)\s+(dry|passable)\b"
                          r"|\b(road|roads|street|streets|route|way|lane|lanes|highway|freeway|st|ave|blvd|dr)\.?('s)?\s+(is\s+|are\s+|looks\s+)?clear\b"
                          r"|\b(all clear|clear to drive)\b", re.I)
# Spanish: "seguro/segura", "despejado", "transitable", "sin peligro" anywhere, and "está/es seco" after a verb.
# Negations ("no es seguro", "no está seco", "inseguro", "intransitable") are fine.
_ES_NEG = r"(?<!\bno )(?<!\bnunca )(?<!\bni )(?<!\bno es )(?<!\bno son )(?<!\bno está )(?<!\bno esta )(?<!\bno están )(?<!\bno estan )(?<!\bno estoy )(?<!\bno parece )(?<!\bnunca es )"
UNSAFE_CLAIM_ES = re.compile(_ES_NEG + r"\b(segur[oa]s?|despejad[oa]s?|transitables?|sin peligro)\b"
                             r"|(?<!\bno )(?<!\bnunca )\b(es|son|está|esta|están|estan|parece|parecen|sigue|siguen|queda|quedan|luce|lucen)\s+"
                             r"(muy\s+|totalmente\s+|completamente\s+)?(sec[oa]s?|despejad[oa]s?|transitables?|segur[oa]s?)\b", re.I)


# What the water reached -> depth (cm). Deterministic: the model picks the words, never the number.
REACHED_CM = [("ankle", 10), ("curb", 15), ("shin", 30), ("door sill", 30), ("hubcap", 33), ("knee", 50),
              ("tire top", 65), ("tyre top", 65), ("top of the tire", 65), ("thigh", 70), ("hood", 90), ("bonnet", 90),
              ("waist", 100), ("hip", 90), ("chest", 130), ("door", 45), ("tire", 40), ("tyre", 40)]


def reached_cm(text):
    t = (text or "").lower()
    return next((cm for k, cm in REACHED_CM if re.search(rf"\b{k}s?\b", t)), None)


def violates(text):
    t = _INVISIBLE.sub("", unicodedata.normalize("NFKC", text or "")).lower().translate(_CONFUSABLE)
    return bool(UNSAFE_CLAIM.search(t) or UNSAFE_CLAIM_ES.search(t))


def _slim(ev):
    return [{k: e.get(k) for k in ("reference", "depth_cm", "high_cm", "time", "credit")} for e in ev[:2]]


class Tools:
    """ctx: route_fn(a, b, vehicle) -> RouteResponse, near_fn(lat, lon) -> list, alerts_fn() -> list, location, vehicle."""

    MAX_CALLS, MAX_SEARCHES = 6, 2  # per chat request: bounds paid Tavily calls and geocodes

    def __init__(self, ctx):
        self.ctx, self.last_route, self.sources, self.filed = ctx, None, [], []
        self.calls = {"all": 0, "local_reports": 0}

    def _city(self):
        return events.get(self.ctx.get("event"))["city"]

    def _place(self, q):
        if q.strip().lower() in ("here", "my location", "current location"):
            loc = self.ctx["location"]
            return {"lat": loc["lat"], "lon": loc["lon"], "label": "your location"} if loc else None
        return geocode(q, self.ctx.get("event"))

    def call(self, name, args):
        self.calls["all"] += 1
        if self.calls["all"] > self.MAX_CALLS:
            return {"error": "tool budget for this message used up; answer with what you have"}
        if name == "local_reports":
            self.calls["local_reports"] += 1
            if self.calls["local_reports"] > self.MAX_SEARCHES:
                return {"error": "search budget used up"}
        try:
            if name == "route":
                a, b = self._place(args["origin"]), self._place(args["destination"])
                if not a or not b:
                    return {"error": f"could not find {'origin' if not a else 'destination'} in {self._city()}"}
                r = self.ctx["route_fn"]((a["lat"], a["lon"]), (b["lat"], b["lon"]), args.get("vehicle") or self.ctx["vehicle"])
                r.update({"from": a, "to": b})
                self.last_route = r
                return {"found": r["found"], "distance_km": round(r.get("distance_m", 0) / 1000, 1), "warnings": r.get("warnings", []),
                        "streets_with_no_reports_m": r.get("unknown_m"), "reason": r.get("reason"),
                        "avoided": [{"name": x["name"], "reason": x["reason"], "evidence": _slim(x["evidence"])} for x in r["avoided"]]}
            if name == "segment_status":
                p = self._place(args["place"])
                return {"error": "place not found"} if not p else {"place": p["label"], "streets": self.ctx["near_fn"](p["lat"], p["lon"])}
            if name == "active_alerts":
                return {"alerts": [f["properties"] for f in self.ctx["alerts_fn"]()]}
            if name == "file_report":
                if self.filed:
                    return {"error": "one report per message"}
                cm = reached_cm(args.get("reached"))
                if cm is None:
                    return {"error": "ask what the water reached (ankles, knees, waist, curb, car doors)"}
                p = self._place(args["place"])
                if not p:
                    return {"error": f"could not find that place in {self._city()}; ask for a nearby street or intersection"}
                ev = self.ctx["report_fn"](p["lat"], p["lon"], cm, args["reached"][:60])
                if "error" in ev:
                    return ev
                self.filed.append(ev)
                return {"filed": True, "street": ev.get("street"), "depth_cm": cm}
            if name == "local_reports":
                out = local_reports(args["query"], self.ctx.get("event"))
                self.sources += [{"title": x["title"], "url": x["url"]} for x in out.get("results", [])]
                return out
        except Exception as e:  # a failing tool is reported to the model, not raised to the user
            return {"error": f"{name} failed: {e.__class__.__name__}"}
        return {"error": f"unknown tool {name}"}


def template(r, lang="en"):
    """Deterministic answer used when the model is unavailable or breaks the wording rules."""
    if lang == "es":
        return _template_es(r)
    if not r:
        return "I couldn't plan a route. Tell me where you're starting and where you're going."
    if not r["found"]:
        return f"{r['reason']} Don't drive through flood water. Turn Around, Don't Drown."
    parts = [f"Route found ({r['distance_m'] / 1000:.1f} km). No deep water reported along it."]
    parts += [f"Avoids {a['name']}: {a['reason']}." for a in r["avoided"][:5]]
    if r["unknown_m"]:
        parts.append(f"{r['unknown_m'] / 1000:.1f} km of it has no reports; unknown is not dry. If you see water, turn around.")
    return " ".join(parts + r.get("warnings", []))


def _reason_es(a):
    if a.get("state") == "reported_unknown" or a.get("high_cm") is None:
        return "agua reportada, profundidad ilegible"
    return f"reportado hasta {a['high_cm']:.0f} cm, más que el límite de su vehículo"


def _template_es(r):
    # Built from the route's numbers, not by translating the router's English strings.
    if not r:
        return "No pude planear una ruta. Dígame de dónde sale y adónde va."
    if not r["found"]:
        return "Ninguna ruta evita el agua profunda reportada para su vehículo. No maneje por agua de inundación. ¡Dé la vuelta, no se ahogue!"
    parts = [f"Ruta encontrada ({r['distance_m'] / 1000:.1f} km). No se reporta agua profunda en ella."]
    parts += [f"Evita {a['name']}: {_reason_es(a)}." for a in r["avoided"][:5]]
    if r["unknown_m"]:
        parts.append(f"{r['unknown_m'] / 1000:.1f} km no tienen reportes; sin reportes no significa seco. Si ve agua, dé la vuelta.")
    if r.get("warnings"):
        parts.append("Parte de la ruta pasa por calles sin reportes recientes dentro de un aviso de inundación activo.")
    return " ".join(parts)


def to_speech(text, lang="en"):
    """Plain text for text-to-speech: no markdown, units spelled out."""
    cm, km, m = ("centímetros", "kilómetros", "metros") if lang == "es" else ("centimetres", "kilometres", "metres")
    t = re.sub(r"[*_`#>]+", "", text or "")
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"(\d)\s*cm\b", rf"\1 {cm}", t)
    t = re.sub(r"(\d)\s*km\b", rf"\1 {km}", t)
    t = re.sub(r"(\d)\s*m\b", rf"\1 {m}", t)
    return " ".join(t.split())


def chat(messages, ctx):
    tools, E, lang = Tools(ctx), events.get(ctx.get("event")), ctx.get("lang", "en")
    if not P.TF_KEY:
        msg = ("El asistente no está disponible (no hay clave de Token Factory). Use el panel de rutas." if lang == "es" else
               "The assistant is offline (no Token Factory key configured). Use the route panel.")
        return {"reply": msg, "speak": msg, "route": None, "sources": [], "filed": []}
    c = OpenAI(base_url=P.TF_URL, api_key=P.TF_KEY, timeout=60, max_retries=1)
    msgs = [{"role": "system", "content": SYSTEM.format(city=E["city"], event=E["name"]) + (SYSTEM_ES if lang == "es" else "")}] + [{"role": m.get("role"), "content": str(m.get("content", ""))[:2000]} for m in messages[-10:]
                                            if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
    reply = None
    try:
        for _ in range(4):  # at most 4 tool rounds
            r = c.chat.completions.create(model=P.NEMOTRON_MODEL, messages=msgs, tools=TOOLS, temperature=0.2, max_tokens=800)
            m = r.choices[0].message
            if not m.tool_calls:
                reply = m.content
                break
            msgs.append({"role": "assistant", "content": m.content or "", "tool_calls": [tc.model_dump() for tc in m.tool_calls]})
            for tc in m.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                msgs.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(tools.call(tc.function.name, args), default=str)[:6000]})
    except BadRequestError:
        reply = None  # model/endpoint rejected tools: fall through to the template
    reply = re.sub(r"<think>.*?</think>", "", reply or "", flags=re.S).strip()
    if not reply or violates(reply):
        reply = template(tools.last_route, lang)
    return {"reply": reply, "speak": to_speech(reply, lang), "route": tools.last_route, "sources": tools.sources[:5], "filed": tools.filed}
