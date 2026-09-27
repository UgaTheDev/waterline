# Waterline backend, packaged for an always-on Nebius CPU VM (2 vCPU / 4 GB).
# Single worker: process holds in-memory rate-limit and dedup state (backend/app.py),
# so a second worker would split that state across processes and let both
# through a limit meant to be shared. Peak RSS measured ~710 MB with the road
# graph + DEM loaded (backend/app.py roads()); one worker leaves headroom on 4 GB,
# two would not without moving that state out of process memory first.
FROM python:3.13-slim

RUN groupadd -r waterline && useradd -r -g waterline -m -d /home/waterline waterline

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Runtime code + the committed replay/graph/DEM cache. Not copied: data/raw
# (license-uncleared media, gitignored anyway), .env (secrets), web/ (deployed
# separately to Vercel), eval/ (offline scoring, not needed to serve traffic).
COPY backend/ backend/
COPY data/cache/ data/cache/

# data/uploads.db and data/uploads/ are runtime state (live upload queue), not
# part of the image; mount a volume at /app/data so they persist across restarts.
RUN mkdir -p /app/data && chown -R waterline:waterline /app
VOLUME ["/app/data"]

USER waterline
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

# Rate limits key on the client IP. Caddy on the host reaches this container through the Docker bridge (the port is
# published on 127.0.0.1 only), so trust X-Forwarded-For from the bridge network and nothing else. Caddy overwrites any
# client-sent X-Forwarded-For by default, so it can't be spoofed through the proxy.
ENV FORWARDED_ALLOW_IPS=172.16.0.0/12
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
