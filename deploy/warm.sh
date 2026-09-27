#!/usr/bin/env bash
# Warms the backend so a judge's first click isn't the one that pays for loading
# the 24 MB road graph (~4s, backend/app.py roads(), lru_cache(1)). Hits the
# endpoints that touch it, in the order the frontend does on load.
#
# Run after container start (deploy/vm-setup.sh calls this), and optionally on a
# schedule (see the systemd timer below) in case the container restarts overnight.
set -euo pipefail

BASE="${1:-http://127.0.0.1:8000}"
DEFAULT_T="2017-09-01T20:00:00Z"  # backend/profiles.py REPLAY["default_t"]

echo "==> GET /config"
curl -fsS "$BASE/config" >/dev/null

echo "==> GET /segments?t=$DEFAULT_T (loads the road graph)"
curl -fsS "$BASE/segments?t=$DEFAULT_T" >/dev/null

echo "==> GET /health"
curl -fsS "$BASE/health"
echo
echo "Warm."

# --- Optional: run this on a timer instead of (or in addition to) once at start,
# so the graph stays hot after any unattended restart during Dec 1-15 judging.
# On the VM:
#   sudo tee /etc/systemd/system/waterline-warm.service <<'EOF'
#   [Unit]
#   Description=Warm the Waterline road graph cache
#   [Service]
#   Type=oneshot
#   ExecStart=/usr/bin/bash /srv/waterline/repo/deploy/warm.sh
#   EOF
#   sudo tee /etc/systemd/system/waterline-warm.timer <<'EOF'
#   [Unit]
#   Description=Run waterline-warm every 10 minutes
#   [Timer]
#   OnBootSec=30s
#   OnUnitActiveSec=10min
#   [Install]
#   WantedBy=timers.target
#   EOF
#   sudo systemctl enable --now waterline-warm.timer
