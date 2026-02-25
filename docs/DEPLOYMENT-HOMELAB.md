# Deployment Context: HomeLab (clinicalvault.me)

This document captures the current production deployment model for this app.

## Current hosting model

- Platform: self-hosted private server (HomeLab)
- Not using Railway for production deployment.
- App container listens on `127.0.0.1:3000`.

## Source and runtime

- Repo path: `/home/ahmad/apps/obsidian-publisher`
- Git remote: `https://github.com/ahmadhajji/obsidian-publisher.git`
- Tracked branch: `main`
- Container name: `obsidian-publisher`

## Build and run

Deployment uses `docker compose` in the app repo.

- Image built from local `Dockerfile`
- Restart policy: `unless-stopped`
- Env loaded from `.env`
- Persistent mount: `./data:/app/data`

Dockerfile flow:

1. base image `node:22-bookworm-slim`
2. `npm ci --omit=dev`
3. `npm rebuild better-sqlite3 --build-from-source`
4. `npm run build`
5. `npm start`

## Public routing

Two active ingress paths currently exist:

1. `clinicalvault.me`
   - Cloudflare Tunnel (`cloudflared.service`)
   - Tunnel config: `/etc/cloudflared/config.yml`
   - Mapping: `clinicalvault.me -> http://localhost:3000`

2. `obsidian.clinicalvault.me`
   - Caddy reverse proxy to `127.0.0.1:3000`
   - Caddyfile path: `/home/ahmad/apps/homelab-dashboard/Caddyfile`
   - Caddy container: `homelab-caddy` (`network_mode: host`)

## Auto-deploy mechanism

Deployment is managed by systemd timer (not GitHub Actions deploy):

- Service: `/etc/systemd/system/obsidian-auto-deploy.service`
- Timer: `/etc/systemd/system/obsidian-auto-deploy.timer`
- Frequency: ~1 minute (`OnUnitActiveSec=1min`)
- Script: `/home/ahmad/apps/ops/auto-deploy-obsidian-publisher.sh`

Script behavior:

1. `git fetch origin main`
2. Compare local SHA with remote SHA
3. If unchanged: status `no_change`, exit
4. If changed:
   - write status `running`
   - `git pull --rebase --autostash origin main`
   - `docker compose up -d --build`
   - write status `success` (or `failed` in trap)

## Deploy status tracking

- Status file: `/home/ahmad/apps/obsidian-publisher/deploy-status.json`
- Synced by a `deploy-status-sync` container into Caddy-served status location
- Exposed endpoints include `/deploy-status` and `deploy.clinicalvault.me`

## Environment keys in use

Present keys in `.env`:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`
- `ATTACHMENTS_FOLDER_ID`
- `SITE_NAME`
- `PORT`
- `DATABASE_PATH`
- `BASE_URL`

Do not store secret values in docs.

## Engineering implications for upcoming features

- Migrations must be idempotent and startup-safe because deploy checks run every minute.
- Backward-compatible API changes are required to avoid breaking current UI during rolling updates.
- New env vars must be optional with safe defaults to keep current deployment bootable.
- If Cloudflare Tunnel and Caddy overlap is reduced later, keep `BASE_URL` canonical and consistent.
