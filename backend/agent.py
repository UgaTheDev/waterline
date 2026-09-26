"""Nemotron (Nebius Token Factory) agent. Read-only tools; road status always comes from the router."""
import json, re
from openai import OpenAI, BadRequestError
from . import profiles as P
from .alerts import local_reports
from .geocode import geocode

SYSTEM = f"""You help drivers in {P.CITY} avoid flooded streets during {P.EVENT}.
Use the tools; never guess road conditions. Rules you must follow:
- Never say a road or route is "safe". Say "no deep water reported" and remind that unreported streets are unknown, not dry.
- For every street the route avoids, name it and give the reported depth, the evidence time and the reference object.
- If no route exists, say so plainly and advise not to drive: "Turn Around, Don't Drown."
- Cite local news only as unverified context. Be brief: at most 6 sentences."""

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
    {"type": "function", "function": {"name": "local_reports", "description": "Local news / road-closure reports (unverified).",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
]

# "safe" asserted about a road, not negated ("not safe", "unsafe")
UNSAFE_CLAIM = re.compile(r"(?<!un)(?<!not )(?<!never )\bsafe(ly)?\b", re.I)


def violates(text):
    return bool(UNSAFE_CLAIM.search(text or ""))


def _slim(ev):
    return [{k: e.get(k) for k in ("reference", "depth_cm", "high_cm", "time", "credit")} for e in ev[:2]]


class Tools:
    """ctx: route_fn(a, b, vehicle) -> RouteResponse, near_fn(lat, lon) -> list, alerts_fn() -> list, location, vehicle."""

    def __init__(self, ctx):
        self.ctx, self.last_route, self.sources = ctx, None, []

    def _place(self, q):
        if q.strip().lower() in ("here", "my location", "current location"):
            loc = self.ctx["location"]
            return {"lat": loc["lat"], "lon": loc["lon"], "label": "your location"} if loc else None
        return geocode(q)

    def call(self, name, args):
        try:
            if name == "route":
                a, b = self._place(args["origin"]), self._place(args["destination"])
                if not a or not b:
                    return {"error": f"could not find {'origin' if not a else 'destination'} in {P.CITY}"}
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
            if name == "local_reports":
                out = local_reports(args["query"])
                self.sources += [{"title": x["title"], "url": x["url"]} for x in out.get("results", [])]
                return out
        except Exception as e:  # a failing tool is reported to the model, not raised to the user
            return {"error": f"{name} failed: {e.__class__.__name__}"}
        return {"error": f"unknown tool {name}"}


def template(r):
    """Deterministic answer used when the model is unavailable or breaks the wording rules."""
    if not r:
        return "I couldn't plan a route. Tell me where you're starting and where you're going."
    if not r["found"]:
        return f"{r['reason']} Don't drive through flood water. Turn Around, Don't Drown."
    parts = [f"Route found ({r['distance_m'] / 1000:.1f} km). No deep water reported along it."]
    parts += [f"Avoids {a['name']}: {a['reason']}." for a in r["avoided"][:5]]
    if r["unknown_m"]:
        parts.append(f"{r['unknown_m'] / 1000:.1f} km of it has no reports; unknown is not dry. If you see water, turn around.")
    return " ".join(parts + r.get("warnings", []))


def chat(messages, ctx):
    tools = Tools(ctx)
    if not P.TF_KEY:
        return {"reply": "The assistant is offline (no Token Factory key configured). Use the route panel.", "route": None, "sources": []}
    c = OpenAI(base_url=P.TF_URL, api_key=P.TF_KEY, timeout=60, max_retries=1)
    msgs = [{"role": "system", "content": SYSTEM}] + [{"role": m["role"], "content": m["content"][:2000]} for m in messages[-10:] if m["role"] in ("user", "assistant")]
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
        reply = template(tools.last_route)
    return {"reply": reply, "route": tools.last_route, "sources": tools.sources[:5]}
