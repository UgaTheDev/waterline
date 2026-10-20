"""Smoke-test every external service the moment keys land.   .venv/bin/python -m scripts.check_keys

Reads .env (never prints a key). Checks, each independently:
  1. Token Factory: lists models, confirms DEPTH_MODEL and NEMOTRON_MODEL ids exist (suggests near matches if not)
  2. Depth: one real call on a replay photo -> parsed depth, latency, token usage
  3. Agent: one /chat route question -> reply, whether it used tools, latency
  4. Tavily: one local_reports search
  5. Hugging Face: token valid + access granted to the gated Cosmos models
Writes eval/results/keys_check.json (no secrets). Exit 1 if a configured service fails.
"""
import json, os, pathlib, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
os.environ.setdefault("WATERLINE_LOAD_ENV", "1")  # backend/profiles.py reads .env (shell values win)
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "check.db"))  # never touch real uploads

import httpx  # noqa: E402
from backend import profiles as P  # noqa: E402

UA = {"User-Agent": "WaterlineFloodDemo/1.0 (https://github.com/UgaTheDev/waterline)"}
out, failed = {}, []


def check(name, fn):
    t0 = time.time()
    try:
        r = fn()
        out[name] = {"ok": True, "seconds": round(time.time() - t0, 2), **(r or {})}
        print(f"  OK   {name}: {json.dumps(r)[:300]}")
    except Skip as s:
        out[name] = {"ok": None, "skipped": str(s)}
        print(f"  --   {name}: skipped ({s})")
    except Exception as e:
        out[name] = {"ok": False, "error": f"{e.__class__.__name__}: {str(e)[:300]}"}
        failed.append(name)
        print(f"  FAIL {name}: {out[name]['error']}")


class Skip(Exception):
    pass


def need(var):
    if not os.getenv(var):
        raise Skip(f"{var} not set in .env")


def tf_models():
    need("TF_KEY")
    r = httpx.get(P.TF_URL.rstrip("/") + "/models", headers={"Authorization": f"Bearer {P.TF_KEY}"}, timeout=30)
    r.raise_for_status()
    ids = sorted(m["id"] for m in r.json().get("data", []))
    nv = [i for i in ids if "nemotron" in i.lower() or "nvidia" in i.lower() or "cosmos" in i.lower()]
    res = {"n_models": len(ids), "nvidia_models": nv, "depth_model_found": P.DEPTH_MODEL in ids, "agent_model_found": P.NEMOTRON_MODEL in ids}
    if not res["depth_model_found"]:
        res["depth_model_candidates"] = [i for i in nv if "vl" in i.lower() or "nano" in i.lower()]
    if not res["agent_model_found"]:
        res["agent_model_candidates"] = [i for i in nv if "vl" not in i.lower()]
    if not (res["depth_model_found"] and res["agent_model_found"]):
        raise RuntimeError(f"model id not found; set DEPTH_MODEL / NEMOTRON_MODEL in .env from: {res}")
    return res


def depth_call():
    need("TF_KEY") if P.DEPTH_PROVIDER != "cosmos" else need("COSMOS_URL")
    import base64
    from backend import depth
    photos = sorted((ROOT / "data/raw/replay").glob("*.jpg")) or sorted((ROOT / "data/raw/eval_pool").glob("*.jpg"))
    if not photos:
        raise Skip("no local photo in data/raw/replay or data/raw/eval_pool")
    img = depth.prepare_image(photos[0].read_bytes())
    url = f"data:image/jpeg;base64,{base64.b64encode(img).decode()}"
    t0 = time.time()
    r = depth.client().chat.completions.create(model=depth.model(), temperature=0.2, max_tokens=1200, messages=[
        {"role": "user", "content": [{"type": "image_url", "image_url": {"url": url}}, {"type": "text", "text": depth.PROMPT}]}])
    dt = time.time() - t0
    parsed = depth.finalize(depth.parse(r.choices[0].message.content or ""))
    u = r.usage
    return {"model": depth.model(), "photo": photos[0].name, "latency_s": round(dt, 2), "parsed": parsed,
            "tokens_in": getattr(u, "prompt_tokens", None), "tokens_out": getattr(u, "completion_tokens", None)}


def agent_call():
    need("TF_KEY")
    from fastapi.testclient import TestClient
    from backend.app import app
    r = TestClient(app).post("/chat", json={"messages": [{"role": "user", "content":
        "Can I drive from Rice University to Minute Maid Park in my sedan?"}], "vehicle": "sedan", "t": P.REPLAY["default_t"]})
    r.raise_for_status()
    d = r.json()
    if "offline" in d["reply"]:
        raise RuntimeError("agent reported offline")
    return {"model": P.NEMOTRON_MODEL, "used_route_tool": d.get("route") is not None, "reply": d["reply"][:240]}


def tavily_call():
    need("TAVILY_KEY")
    from backend.alerts import local_reports
    r = local_reports("Buffalo Bayou")
    if "error" in r:
        raise RuntimeError(r["error"])
    return {"results": len(r.get("results", []))}


def hf_access():
    need("HF_TOKEN")
    h = {**UA, "Authorization": f"Bearer {os.environ['HF_TOKEN']}"}
    who = httpx.get("https://huggingface.co/api/whoami-v2", headers=h, timeout=20)
    who.raise_for_status()
    access = {}
    for m in ("nvidia/Cosmos-Reason2-8B", "nvidia/Cosmos-Transfer2.5-2B"):
        r = httpx.head(f"https://huggingface.co/{m}/resolve/main/config.json", headers=h, timeout=20, follow_redirects=True)
        access[m] = "granted" if r.status_code == 200 else f"HTTP {r.status_code} (accept the license on the model page)"
    if any(v != "granted" for v in access.values()):
        raise RuntimeError(f"gated model access missing: {access}")
    return {"user": who.json().get("name"), "access": access}


if __name__ == "__main__":
    print("Waterline key check")
    for name, fn in [("token_factory_models", tf_models), ("depth_call", depth_call), ("agent_call", agent_call),
                     ("tavily", tavily_call), ("huggingface", hf_access)]:
        check(name, fn)
    dst = ROOT / "eval/results/keys_check.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, indent=1, default=str))
    print(f"-> {dst.relative_to(ROOT)}")
    sys.exit(1 if failed else 0)
