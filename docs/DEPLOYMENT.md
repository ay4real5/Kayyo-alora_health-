# Deploying Kayo Health (production)

**Chosen host: Azure — follow [DEPLOYMENT-AZURE.md](DEPLOYMENT-AZURE.md)** (D-081). This page explains the general
shape and the rules any host must keep.

How the pieces fit (DECISIONS D-070). The hosting provider is still open (Q-006 / P4-11): whatever it is, it must be
HIPAA-eligible and sign a BAA covering the servers, the database and backups **before any real patient data goes in**.

```
browser ──HTTPS──▶ nginx ──▶ web  (Next.js dashboard + patient portal, :3000)
                        └──▶ api  (NestJS, /api/v1 incl. Socket.IO at /api/v1/socket.io, :3001) ──▶ PostgreSQL
                     migrate (one-shot: prisma migrate deploy) ─────────────────────────────────────▶ PostgreSQL
mobile app ──HTTPS──▶ nginx ──▶ api
```

| Image | Dockerfile | Notes |
|---|---|---|
| `alora-api` | `docker/Dockerfile.api` | Stateless. Documents are stored encrypted in the database (D-056), so no volumes. |
| `alora-web` | `docker/Dockerfile.web` | The API address is **compiled in** — build argument `NEXT_PUBLIC_API_URL` (one image per environment). |
| `alora-migrate` | `docker/Dockerfile.migrate` | Applies migrations and exits. The API refuses to start on an unmigrated database. |

## Before the first deploy (owner)

1. Hosting account + signed BAA (Q-006, P4-11). Managed PostgreSQL 17 in the same region as the API, TLS on,
   automated backups + point-in-time recovery, backups encrypted and covered by the BAA.
2. A domain and a TLS certificate for it (e.g. Let's Encrypt / certbot, or the host's load balancer).
3. **New secrets for everything** (P4-12, D-019) — nothing from development: `JWT_SECRET`, `PHI_ENCRYPTION_KEY`
   (keep a backup of this key in a secrets manager: without it, SSNs, 2FA secrets and documents can't be read),
   database password.
4. Make the GitHub repository private (P4-12).

## Deploy with Docker Compose (single server)

```bash
cp .env.production.example .env.production       # fill in; never commit
mkdir certs && cp /path/to/fullchain.pem /path/to/privkey.pem certs/
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Order is enforced by the compose file: `migrate` runs to completion → `api` starts (healthy at `/api/v1/health`) →
`nginx` starts. To update: `git pull` and run the same command — migrations run again first.

On a container platform (ECS, Cloud Run, Azure Container Apps, …) build the three images and push them to the
host's **private** registry (a workflow for that is added once the host is chosen and the owner approves where images
are published), run `alora-migrate` as a one-off task before rolling out `alora-api`, and put the platform's load
balancer where nginx is — with the same rules (below).

## Rules any production setup must keep

- **No query strings in logs** (search terms and ids can be PHI, D-035): the nginx config logs `$uri`, not
  `$request`, no referrer, and only critical errors. A cloud load balancer's access logs must be configured the
  same way (or off).
- **`TRUST_PROXY_HOPS`** = number of proxies in front of the API (1 behind this nginx). Without it every user shares
  the proxy's IP and one rate-limit bucket. The proxy must *replace* `X-Forwarded-For`, not append to it.
- **One API container** for now: Socket.IO and rate limits live in memory. Running several needs a Redis adapter and
  a shared rate-limit store first (an agent task — ask for it before scaling out).
- `APP_ENV=production` (Swagger off, `RATE_LIMITS_DISABLED` refused); `CORS_ORIGINS` = the dashboard origin only.
- Uploads: nginx allows 12 MB (documents max 10 MB, 835 files max 6 MB).
- Keep the database and the API in the same region (the load test showed latency is dominated by distance, D-068).

## After deploying

- Email (D-078): in Amazon SES verify your domain (DKIM), ask AWS to move the account **out of the SES sandbox**
  (otherwise it only sends to verified addresses), give the API's role `ses:SendEmail`, then set
  `EMAIL_PROVIDER=ses`, `EMAIL_FROM`, `AWS_REGION`.

- Telephony EVV (optional, D-073): in Twilio, set the check-in number's **Voice → A call comes in** webhook to
  `https://DOMAIN/api/v1/ivr/voice` (HTTP POST), and set `TWILIO_AUTH_TOKEN` + `TWILIO_WEBHOOK_BASE_URL=https://DOMAIN`.
  Give each caregiver a phone check-in code (Staff → edit) and make sure patients' home phone numbers are filled in.

- `https://DOMAIN/api/v1/health` → `{"success":true,...}`; the dashboard loads at `https://DOMAIN/login`.
- Create the first agency admin (the demo seed is for development only — never run `db:seed` against production).
- Mobile app: build with the production API URL (`EXPO_PUBLIC_API_URL`) and publish through the stores.
