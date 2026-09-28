"""Load test: N concurrent simulated judges, each walking config -> segments (6 times across the
replay window) -> one route -> one chat (expects the "assistant offline" reply when no Token
Factory key is configured). Reports p50/p95 latency and error counts per endpoint.

    python -m scripts.loadtest http://127.0.0.1:8793 --n 20
"""
import argparse, asyncio, time
from datetime import datetime

import httpx


def _parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


async def _timed(results, name, coro):
    t0 = time.perf_counter()
    try:
        r = await coro
        r.raise_for_status()
        results[name].append((time.perf_counter() - t0, None))
        return r
    except Exception as e:
        results[name].append((time.perf_counter() - t0, str(e)))
        return None


async def one_judge(base, client, results):
    cfg_r = await _timed(results, "config", client.get(f"{base}/config"))
    if not cfg_r:
        return
    cfg = cfg_r.json()
    t0, t1 = _parse(cfg["replay"]["start"]), _parse(cfg["replay"]["end"])
    step = (t1 - t0) / 5
    times = [(t0 + step * i).isoformat().replace("+00:00", "Z") for i in range(6)]
    for t in times:
        await _timed(results, "segments", client.get(f"{base}/segments", params={"t": t}))

    lon, lat = cfg["center"]
    body = {"from": {"lat": lat - 0.01, "lon": lon - 0.01}, "to": {"lat": lat + 0.01, "lon": lon + 0.01},
            "vehicle": "sedan", "t": cfg["replay"]["default_t"]}
    await _timed(results, "route", client.post(f"{base}/route", json=body))

    chat_body = {"messages": [{"role": "user", "content": "any water reported nearby?"}], "vehicle": "sedan",
                 "t": cfg["replay"]["default_t"], "location": None}
    chat_r = await _timed(results, "chat", client.post(f"{base}/chat", json=chat_body))
    if chat_r and "offline" not in chat_r.json().get("reply", "").lower():
        results["chat"].append((0.0, f"unexpected reply (expected 'assistant offline'): {chat_r.json()['reply'][:80]!r}"))


async def run(base, n):
    results = {k: [] for k in ("config", "segments", "route", "chat")}
    async with httpx.AsyncClient(timeout=30) as client:
        await asyncio.gather(*(one_judge(base, client, results) for _ in range(n)))
    return results


def report(n, results):
    print(f"--- {n} concurrent clients ---")
    for name, rows in results.items():
        lat = sorted(t for t, err in rows if err is None)
        errs = [err for _, err in rows if err]
        if lat:
            p50 = lat[len(lat) // 2]
            p95 = lat[min(len(lat) - 1, int(len(lat) * 0.95))]
            print(f"  {name:9s} n={len(rows):3d}  p50={p50 * 1000:6.0f}ms  p95={p95 * 1000:6.0f}ms  errors={len(errs)}")
        else:
            print(f"  {name:9s} n={len(rows):3d}  (no successes)  errors={len(errs)}")
        for e in errs[:5]:
            print(f"      ! {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base_url")
    ap.add_argument("--n", type=int, default=20)
    args = ap.parse_args()
    results = asyncio.run(run(args.base_url.rstrip("/"), args.n))
    report(args.n, results)


if __name__ == "__main__":
    main()
