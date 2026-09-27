# AGENTS.md — Alora Home Health Platform

This repo is built by several AI agents taking turns (Claude Code, Devin, others) plus a human owner.
No agent remembers the previous session. **The repo is the only memory.** Follow the protocol below
exactly so the next agent can continue where you stopped.

## 1. Start-of-session protocol (do this first, every time)

1. Read, in order:
   1. [docs/STATUS.md](docs/STATUS.md) — where the project is right now, what's in progress, what's next.
   2. [docs/ROADMAP.md](docs/ROADMAP.md) — the task list. Pick the task named in STATUS "Next up", or the
      first unchecked task in the current phase whose owner is `agent` and whose dependencies are done.
   3. [docs/DECISIONS.md](docs/DECISIONS.md) — decisions that override or refine the design doc.
   4. The sections of [docs/DESIGN.md](docs/DESIGN.md) relevant to your task (don't read all 1,700 lines).
2. Run `git status` and `git log --oneline -15`. If there are uncommitted changes you didn't make, a previous
   session stopped mid-task — read STATUS "In progress" and continue it rather than starting over.
3. If STATUS says a task is `in progress` with a branch name, check out that branch.

## 2. While working

- Work on **one task ID at a time** (e.g. `P1-04`). Branch name: `task/P1-04-short-name`.
- **Commit and push after every working step** (not just at the end of a task), with the task ID in the
  message: `P1-04: add patient CRUD endpoints`. The owner's AI usage can run out at any moment; anything not
  pushed is invisible to the next agent. If you've made progress, update STATUS "In progress" in the same
  commit so the next agent knows the exact next step.
- If you make a choice the design doc doesn't cover, or you deviate from it, add an entry to
  `docs/DECISIONS.md`. If you hit something that needs the human, add it to `docs/OPEN_QUESTIONS.md`
  and move on to something unblocked.
- Never put real PHI (patient names, SSNs, DOBs, addresses) anywhere in the repo — seeds and tests use
  obviously fake data. Never commit `.env` or any secret.

## 3. End-of-session protocol (do this before you stop, even if the task is unfinished)

1. Make sure the code builds and tests you touched pass. If not, say so in STATUS — do not hide it.
   Never commit on top of a failing test run without saying so in the commit message. If a DB-backed e2e
   test fails intermittently, rerun it with `logger: ['error']` to capture the real cause before "fixing" it.
2. Update [docs/STATUS.md](docs/STATUS.md):
   - "Current state", "In progress" (task ID, branch, what's done, what's left, exact next step), "Next up".
   - Add one line to the top of the "Session log" (date, agent, task, outcome).
3. Tick finished tasks in [docs/ROADMAP.md](docs/ROADMAP.md) (`- [x]`).
4. Commit everything (including the doc updates) and push the branch.
5. If the task is complete and tests pass, open a PR to `main` (or merge if the owner has said to).

If you're running low on context or usage, **stop feature work and do step 3 immediately**. An unfinished
task with a good handoff note is worth more than a finished one nobody can find.

## 4. Who does what

| Owner tag in ROADMAP | Meaning |
|---|---|
| `agent` | Any coding agent (Claude Code, Devin, ...) can do it. |
| `human` | Needs the owner: accounts, API keys, BAAs, payments, legal/compliance calls. |
| `base44` | Built in the Base44 web builder by the owner, not in this repo. The repo only holds its docs/spec in `docs/base44-portal/`. |

## 5. Architecture (summary — details in docs/DESIGN.md)

- Modular monolith (NestJS) — each domain is a NestJS module in `apps/api/src/modules/`
- Shared types/constants in `packages/shared/`
- Admin dashboard: `apps/web/` (Next.js App Router) — self-hosted, full Socket.IO real-time
- Patient portal: **Base44 project** (hosted on base44.com, consumes NestJS Portal API via OpenAPI integration)
- Mobile app: `apps/mobile/` (React Native + Expo Router)
- PostgreSQL + Prisma, Redis + BullMQ, Socket.IO, S3, Twilio, SendGrid

### API-first
- NestJS generates OpenAPI/Swagger at `/api/v1/docs`
- Next.js dashboard and mobile app consume the API; Base44 portal imports the `/portal/*` subset
- No business logic in any frontend

## 6. Conventions

- All API routes prefixed with `/api/v1`
- Responses: `{ success: true, data, meta? }`; errors: `{ success: false, error: { code, message, details? } }`
- DTOs with class-validator for all request validation
- Prisma for all database access (raw SQL only for materialized views / partitioning)
- HIPAA audit middleware logs every PHI access to `audit_logs`
- PHI fields (SSN, 2FA secrets, etc.) encrypted before storage with `PhiCryptoService` + a `PhiContext` label (DECISIONS D-017)
- JWT access tokens: 15-min TTL. Refresh tokens: 7-day TTL, rotated, stored hashed
- BullMQ for async jobs (claims, notifications, reports)
- Socket.IO for real-time (Next.js dashboard + mobile app)
- All timestamps stored as UTC, converted to agency timezone on display
- Tests colocated: `*.spec.ts` next to source files (Vitest); API e2e tests in `apps/api/test/*.e2e-spec.ts`
- ES modules: relative imports end in `.js` (see DECISIONS D-009)
- Every query on tenant data is scoped by `agency_id` — no exceptions

### Common layer (apps/api/src/common, config) — use these, don't reinvent them
- Env vars: add each one to `EnvironmentVariables` in `src/config/env.validation.ts` (validated at startup)
  and to `.env.example`. Inject `ConfigService<EnvironmentVariables, true>` and call
  `config.get('NAME', { infer: true })`. Don't read `process.env` directly. Don't inject via a type alias
  (Nest DI needs the real class).
- Controllers return plain data; `ResponseEnvelopeInterceptor` wraps it. For lists, accept
  `@Query() query: PaginationQueryDto` and return `Paginated.of(items, total, query)`.
- Throw Nest `HttpException`s (`NotFoundException` etc.); `AllExceptionsFilter` formats them. Prisma
  unique/not-found/FK errors are mapped automatically. Never put PHI in exception messages.
- Every request has `req.correlationId` (also the `X-Request-Id` response header) — include it in logs.

### Auth (apps/api/src/modules/auth) — DECISIONS D-020
- Every route requires `Authorization: Bearer <access token>` by default. Mark genuinely public routes with
  `@Public()` (from `common/decorators`). Get the caller with `@CurrentUser() user: AuthUser`
  (`{ userId, agencyId }`) and **always scope queries by `user.agencyId`**.
- PHI access is audited **automatically** for every route with `@Permissions` (D-023). Use
  `@Audit({ action: 'DISCHARGE_PATIENT' })` to name business actions; record other security events with
  `AuditService.record({...})` — IDs and reasons only, never PHI.
- Tests: `test/auth.e2e-spec.ts` shows how to create users and log in; override `ThrottlerStorage` so tests
  aren't rate-limited.

### RBAC — DECISIONS D-022
- Permission strings are `resource:action` (e.g. `patients:read`), catalogue in `@alora/shared`
  `PERMISSION_CATALOGUE`; the API tables in DESIGN.md write them the other way round — translate.
- Put `@Permissions('patients:read')` on every route touching PHI/agency data (needs ALL listed).
- Built-in roles and their grants live in `ROLE_DEFAULT_PERMISSIONS` and are synced to the DB on boot —
  change them in code, never in the database.
- Permissions say *whether* a role may do something; filtering *which records* (assigned patients, own
  visits, own agency) is each service's job.

### Web dashboard (apps/web) — DECISIONS D-034
- Next.js 16 differs from older versions: read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` first.
- Call the API with `useAuth().request(path)` (adds the token, renews once on 401). Never store tokens anywhere.
- Gate UI with `useAuth().can('patients:read')` — cosmetic only; the API enforces permissions.
- Pages under `src/app/(app)/` are signed-in only (AppShell guard).

### File naming
- NestJS: `kebab-case` (`care-plans.service.ts`); DTOs: `*.dto.ts`
- React: `PascalCase` components (`CalendarView.tsx`)
- Shared types: `*.types.ts`

## 7. Commands

Run from the repo root.

```bash
npm install                              # install all workspaces
# Dev DB/Redis: Neon + Upstash via the root .env (D-018). Docker alternative (not on owner's laptop):
docker compose up -d postgres redis      # PostgreSQL 17 + Redis 7
npm run build                            # turbo: build everything (shared builds before api)
npm run typecheck                        # turbo: tsc --noEmit everywhere
npm run lint                             # turbo: oxlint
npm run test                             # turbo: unit tests (Vitest)
npm run test:e2e -w @alora/api           # API e2e tests (DB tests use DATABASE_URL from .env; skip if unset)
npm run start:dev -w @alora/api          # API on http://localhost:3001/api/v1 (health: /api/v1/health)
npm run generate -w @alora/api           # regenerate Prisma client (turbo does this before build/test)
npm run db:deploy -w @alora/api          # apply migrations to DATABASE_URL
npm run openapi -w @alora/api            # after build: regenerate docs/api/openapi.json + portal spec (CI checks)
npm run db:seed -w @alora/api            # after build: wipe + rebuild the FAKE demo agency, prints logins (D-033)
npm run dev -w @alora/web                # dashboard on http://localhost:3000 (API must be running; CORS_ORIGINS)
npm run test:e2e -w @alora/web           # Playwright browser tests (API + dashboard running, demo seed loaded)
npm run db:migrate -w @alora/api -- --name <name>   # create a migration (needs a database, see D-014)
docker compose up -d --build             # whole stack incl. API container
```

Adding a dependency to one app: `npm install <pkg> -w @alora/api` (never `cd` into the app and run npm
there — it would create a second lockfile).

`packages/shared` compiles to `dist/`; the API imports the built output. If the API can't find a new export
from `@alora/shared`, run `npm run build` first.

## 8. Environment notes

- **Checking CI without a GitHub login**: the repo is public, so
  `curl -s "https://api.github.com/repos/ay4real5/Kayyo-alora_health-/actions/runs?per_page=5"` works, and a
  failed job's annotations (the Docker job posts its container log there) are at
  `.../check-runs/<job id>/annotations`. Full logs need a login. **Unauthenticated calls are limited to 60 per
  hour** — poll once a minute at most, never in a tight loop.

- On the owner's laptop run full checks as `npx turbo run build typecheck lint test --concurrency=2` — the default
  parallelism (Next.js build workers + API lint/tests at once) runs out of memory and fails spuriously.
- Owner's machine: Windows 11, **5.7 GB RAM — do not start Docker Desktop there** (DECISIONS D-011). Docker
  checks run in GitHub Actions. Scripts must work in Git Bash and PowerShell; avoid bash-only npm scripts.
- Node version: see `.nvmrc` and DECISIONS D-001.
