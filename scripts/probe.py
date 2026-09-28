"""Uptime probe: hits /health, /config and /segments on a base URL and checks the response
shapes. Exits nonzero if any check fails. Meant to run on a schedule against production
(see deploy/README.md for a suggested GitHub Actions cron).

    python -m scripts.probe https://api.example.com [--json]
"""
import argparse, json, sys
import httpx

TIMEOUT = 10


def check_health(base):
    b = httpx.get(f"{base}/health", timeout=TIMEOUT).raise_for_status().json()
    assert isinstance(b.get("ok"), bool), "missing/bad 'ok'"
    return b


def check_config(base):
    b = httpx.get(f"{base}/config", timeout=TIMEOUT).raise_for_status().json()
    for k in ("city", "event", "bbox", "center", "replay", "vehicles"):
        assert k in b, f"missing '{k}'"
    assert b["replay"].get("default_t"), "replay.default_t missing"
    return b


def check_segments(base, cfg):
    b = httpx.get(f"{base}/segments", params={"t": cfg["replay"]["default_t"]}, timeout=TIMEOUT).raise_for_status().json()
    assert b.get("type") == "FeatureCollection", "not a FeatureCollection"
    assert isinstance(b.get("features"), list), "features is not a list"
    return b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base_url")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    checks, ok, cfg = {}, True, None
    for name, fn in (("health", lambda: check_health(base)), ("config", lambda: check_config(base))):
        try:
            r = fn()
            checks[name] = "ok"
            if name == "config":
                cfg = r
        except Exception as e:
            checks[name] = f"error: {e}"
            ok = False
    try:
        if cfg is None:
            raise RuntimeError("skipped: config check failed")
        check_segments(base, cfg)
        checks["segments"] = "ok"
    except Exception as e:
        checks["segments"] = f"error: {e}"
        ok = False

    out = {"ok": ok, "checks": checks}
    if args.json:
        print(json.dumps(out))
    else:
        for k, v in checks.items():
            print(f"{k}: {v}")
        print("OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
