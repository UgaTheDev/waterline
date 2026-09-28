# Deploying Waterline's backend to an always-on Nebius CPU VM

Goal: the FastAPI backend stays up unattended through judging (Dec 1-15), serving the
committed replay cache. No GPU here — `DEPTH_PROVIDER=tokenfactory` is pay-per-token;
Cosmos (self-hosted) is only spun up for the benchmark, then stopped (see root README).

## 1. Create the VM — **Kush, in the Nebius console**
- Nebius AI Cloud > Compute > new VM. Ubuntu 22.04 or 24.04, smallest CPU shape that
  gives 2 vCPU / 4 GB (e.g. their `cpu-e2` or equivalent small preset — pick whatever's
  cheapest that meets that spec).
- Attach a public IP. Note it down.
- Add your SSH key to the VM at creation (console has a field for it).

## 2. Get a deploy credential — **Kush**
Either:
- GitHub PAT (fine-grained, read-only, this repo only), used as `https://<token>@github.com/<you>/waterline.git`, or
- a deploy key: `ssh-keygen -t ed25519 -f deploy_key -N ""`, add `deploy_key.pub` to the
  repo's Settings > Deploy keys (read-only), keep `deploy_key` private, and load it into
  an `ssh-agent` on the VM (or `scp` it to `/root/.ssh/id_ed25519` on the VM, `chmod 600`).

Never put the token/key in a file this repo tracks.

## 3. Run the setup script — on the VM, as root/sudo
```bash
ssh ubuntu@<vm-ip>
sudo -i
curl -fsSL https://raw.githubusercontent.com/<you>/waterline/main/deploy/vm-setup.sh -o vm-setup.sh
# or: scp deploy/vm-setup.sh from your machine if the repo isn't public yet
chmod +x vm-setup.sh
./vm-setup.sh 'https://<token>@github.com/<you>/waterline.git'   # no domain yet -> plain HTTP
```
This installs Docker, clones the repo to `/srv/waterline/repo`, builds the image, and
runs it with `--restart unless-stopped`, bound to `127.0.0.1:8000` (Caddy/whatever
proxies to it, never exposed directly), plus a `ufw` firewall allowing only 22/80/443.

Before or after this, put real secrets in `/srv/waterline/env/.env` (mode 600, created
for you) — copy from `.env.example` and fill in `TF_KEY`, `TAVILY_KEY`, etc. The app runs
fine with an empty file (agent offline, uploads just queue), so this isn't blocking.

## 4. Point a domain — **Kush** (only if you want HTTPS via Caddy from the start)
Vercel serves the frontend over HTTPS, so the browser will block calls to a plain-HTTP
backend (mixed content). You need either:
- a real domain/subdomain, A record -> the VM's public IP, then:
  `./vm-setup.sh '' api.yourdomain.com` (re-run; Caddy gets automatic Let's Encrypt HTTPS), or
- no DNS at all: an sslip.io hostname, e.g. IP `203.0.113.10` -> `203-0-113-10.sslip.io`,
  which resolves without any DNS setup you control:
  `./vm-setup.sh '' 203-0-113-10.sslip.io`

Without either, the script proxies plain port 80 -> 8000 and the frontend cannot use it.

## 5. Point Vercel at it — **Kush**
Vercel project settings > Environment Variables:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com     # or https://203-0-113-10.sslip.io
```
Redeploy the Vercel project (or it auto-redeploys on the env var save, depending on
settings). Set `ALLOWED_ORIGINS` in the backend's `.env` on the VM to match the deployed
frontend:
```
ALLOWED_ORIGINS=https://waterline-black-beta.vercel.app
```
then `docker restart waterline` (env changes require a restart; `docker run --env-file`
only reads the file at container start).

## Updating (new commits merged to main)
```bash
ssh ubuntu@<vm-ip>
sudo /srv/waterline/repo/deploy/vm-setup.sh 'https://<token>@github.com/<you>/waterline.git'
```
Re-running is safe: it `git pull`s, rebuilds the image, and replaces the container
(`docker rm -f` + `docker run`). The data volume (`/srv/waterline/data`) is untouched.

## Logs
```bash
docker logs -f waterline          # follow
docker logs --since 1h waterline  # recent
```

## Backups of `uploads.db`
Live uploads (and the dedup/rate-limit-adjacent queue state) live in
`/srv/waterline/data/uploads.db` on the host, outside the image. It's small (SQLite,
no committed media). Back it up with a cron entry on the VM:
```bash
# /etc/cron.d/waterline-backup
0 * * * * root sqlite3 /srv/waterline/data/uploads.db ".backup /srv/waterline/backups/uploads-$(date +\%Y\%m\%dT\%H\%M).db" && find /srv/waterline/backups -mtime +14 -delete
```
(`.backup` is safe against a live SQLite connection; a plain `cp` is not.) This isn't
wired up by `vm-setup.sh` — add it by hand if you want it; losing this file during
judging only loses the live-upload queue, not the replay demo, which is the cache
committed to `data/cache/` and rebuilt from the repo on every deploy.

## Uptime probe every 30 minutes (not built here — just the suggestion)
`scripts/probe.py` hits `/health`, `/config` and `/segments` on a base URL and checks the
response shapes (not just the HTTP status), exiting nonzero on any failure — catches a
container that answers but is serving something broken, not just a dead port. A suggested
`.github/workflows/uptime.yml` (Kush: add this yourself; not created here per the task scope):
```yaml
name: uptime
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch: {}
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.13" }
      - run: pip install httpx
      - run: python -m scripts.probe https://api.yourdomain.com --json
      - if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner, repo: context.repo.repo,
              title: `Waterline uptime probe failed (${new Date().toISOString()})`,
              body: "scripts/probe.py against production returned a nonzero exit. Check `docker logs waterline` on the VM.",
              labels: ["ops"],
            });
```
Keep the 30-minute cadence light: it's three cheap GETs, well under any rate limit.

## Monthly cost estimate — **UNVERIFIED, not fetched from Nebius pricing**
Rough order of magnitude for a small always-on CPU VM (2 vCPU / 4 GB) run 24/7 for ~2.5
months (Sep 27 build through mid-Dec judging): likely somewhere in the **$15-40/month**
range based on comparable small-instance CPU pricing elsewhere, but this number was not
checked against Nebius's actual price list. Kush: confirm in the Nebius console before
relying on it, and check whether hackathon free credits (STATUS.md mentions Token
Factory free-credit steps) cover AI Cloud CPU VMs too, not just Token Factory calls.

## Why one uvicorn worker
`backend/app.py` keeps rate-limit counters and in-flight dedup state as plain Python
objects (`defaultdict`/`deque` at module scope) shared within a process. Two `--workers`
would give each worker its own copy, so a client could get 2x the intended rate limit
and duplicate uploads could dedup only within one worker. At 2 vCPU / 4 GB with a ~710 MB
peak RSS (graph + DEM loaded), one worker has headroom; add a second only after moving
that state to something shared (e.g. SQLite, which `store.py` already uses for
persistence) — it is not a memory-constrained decision, it's a correctness one.

## Client IPs and rate limits
Per-visitor rate limits key on the client IP. The container trusts `X-Forwarded-For` only from the Docker bridge network
(`FORWARDED_ALLOW_IPS=172.16.0.0/12` in the Dockerfile). That's safe because the API port is published on 127.0.0.1 only,
so Caddy is the only thing that can reach it, and Caddy overwrites any client-sent `X-Forwarded-For`. Don't publish port
8000 on a public interface: that would let anyone spoof their IP. Check it with `docker logs waterline`: the access log
should show real client IPs, not 172.17.0.1.
