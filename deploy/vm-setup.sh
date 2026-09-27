#!/usr/bin/env bash
# Idempotent setup for a fresh Ubuntu 22.04/24.04 Nebius AI Cloud VM (2 vCPU / 4 GB is enough).
# Installs Docker, clones/pulls the (private) repo, builds the image, and runs it with
# --restart unless-stopped so it survives reboots. Safe to re-run to deploy an update.
#
# Usage:
#   ./vm-setup.sh <git-clone-url> [domain]
#
# Auth for the private repo: pass it embedded in the clone URL yourself, e.g.
#   https://<token>@github.com/<you>/waterline.git      (a GitHub PAT with repo:read)
#   git@github.com:<you>/waterline.git                  (deploy key already loaded in this
#                                                          shell's ssh-agent, or placed at
#                                                          /root/.ssh/id_ed25519 beforehand)
# Never pass the token as a bare argument that ends up in shell history in plaintext logs
# you don't control; an env var (GIT_CLONE_URL) works too and is not printed by this script.
#
# domain (optional): if given, Caddy fronts the app with automatic HTTPS on that domain.
# If omitted, plain HTTP on port 80 is proxied to the container on 8000. The Vercel
# frontend is served over HTTPS, so calling a plain-HTTP backend from it is mixed content
# and the browser will block it — you need at least an sslip.io-style hostname
# (e.g. 203-0-113-10.sslip.io resolves to 203.0.113.10 with no DNS setup) to get a
# certificate. See deploy/README.md.
set -euo pipefail

CLONE_URL="${1:-${GIT_CLONE_URL:-}}"
DOMAIN="${2:-${DOMAIN:-}}"
REPO_DIR=/srv/waterline/repo
ENV_DIR=/srv/waterline/env
DATA_DIR=/srv/waterline/data
IMAGE_TAG=waterline:latest
CONTAINER_NAME=waterline

if [ -z "$CLONE_URL" ]; then
  read -rp "Git clone URL (with token or using an ssh-agent deploy key): " CLONE_URL
fi

echo "==> Installing Docker (skipped if already present)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Creating /srv/waterline layout"
mkdir -p "$REPO_DIR" "$ENV_DIR" "$DATA_DIR"
chmod 700 "$ENV_DIR"

echo "==> Fetching repo"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull --ff-only
else
  git clone "$CLONE_URL" "$REPO_DIR"
fi

if [ ! -f "$ENV_DIR/.env" ]; then
  echo "!! $ENV_DIR/.env does not exist yet."
  echo "   Copy backend/.env.example there, fill in real keys, then re-run this script."
  echo "   The app runs with an empty/missing .env too (agent offline, uploads queue),"
  echo "   so this is not fatal, just less useful."
fi
touch "$ENV_DIR/.env"
chmod 600 "$ENV_DIR/.env"

echo "==> Building image"
docker build -t "$IMAGE_TAG" "$REPO_DIR"

echo "==> (Re)starting container"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_DIR/.env" \
  -v "$DATA_DIR:/app/data" \
  -p 127.0.0.1:8000:8000 \
  "$IMAGE_TAG"

echo "==> Firewall (ufw): allow only 22/80/443"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw --force enable
else
  echo "ufw not found; install it (apt-get install -y ufw) if this image doesn't ship it."
fi

echo "==> Reverse proxy"
if [ -n "$DOMAIN" ]; then
  echo "Domain given ($DOMAIN): installing Caddy for automatic HTTPS."
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:8000
}
EOF
  systemctl restart caddy
  echo "HTTPS should be live at https://$DOMAIN once DNS points here (Kush: add the A record)."
else
  echo "No domain given: proxying plain HTTP 80 -> 8000 with a minimal Caddyfile (no TLS)."
  echo "The Vercel frontend needs HTTPS to call this (mixed content is blocked by the browser)."
  echo "Get a domain, or use an sslip.io hostname: http://<public-ip-with-dashes>.sslip.io"
  echo "e.g. IP 203.0.113.10 -> 203-0-113-10.sslip.io, then re-run: ./vm-setup.sh '' 203-0-113-10.sslip.io"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y caddy || true
  fi
  cat > /etc/caddy/Caddyfile <<'EOF'
:80 {
  reverse_proxy 127.0.0.1:8000
}
EOF
  systemctl restart caddy 2>/dev/null || echo "Caddy not installed; falling back is left to you (e.g. nginx or iptables DNAT)."
fi

echo "==> Warming the cache (loads the road graph so the first real request isn't slow)"
bash "$REPO_DIR/deploy/warm.sh" || true

echo "Done. Container: docker logs -f $CONTAINER_NAME"
