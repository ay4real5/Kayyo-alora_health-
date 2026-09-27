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
- Commit early and often with the task ID in the message: `P1-04: add patient CRUD endpoints`.
  Small commits mean a session that dies mid-task loses little.
- If you make a choice the design doc doesn't cover, or you deviate from it, add an entry to
  `docs/DECISIONS.md`. If you hit something that needs the human, add it to `docs/OPEN_QUESTIONS.md`
  and move on to something unblocked.
- Never put real PHI (patient names, SSNs, DOBs, addresses) anywhere in the repo — seeds and tests use
  obviously fake data. Never commit `.env` or any secret.

## 3. End-of-session protocol (do this before you stop, even if the task is unfinished)

1. Make sure the code builds and tests you touched pass. If not, say so in STATUS — do not hide it.
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
- PHI fields (SSN, etc.) encrypted with AES-256-GCM before storage
- JWT access tokens: 15-min TTL. Refresh tokens: 7-day TTL, rotated, stored hashed
- BullMQ for async jobs (claims, notifications, reports)
- Socket.IO for real-time (Next.js dashboard + mobile app)
- All timestamps stored as UTC, converted to agency timezone on display
- Tests colocated: `*.spec.ts` next to source files (Vitest); API e2e tests in `apps/api/test/*.e2e-spec.ts`
- ES modules: relative imports end in `.js` (see DECISIONS D-009)
- Every query on tenant data is scoped by `agency_id` — no exceptions

### RBAC
- Permission strings are `resource:action` (e.g. `patients:read`, `billing:submit`). See DECISIONS D-004;
  the API tables in DESIGN.md write them the other way round (`read:patients`) — translate.
- `@Permissions('patients:read')` decorator on controller methods
- `RbacGuard` checks user → roles → role_permissions

### File naming
- NestJS: `kebab-case` (`care-plans.service.ts`); DTOs: `*.dto.ts`
- React: `PascalCase` components (`CalendarView.tsx`)
- Shared types: `*.types.ts`

## 7. Commands

Run from the repo root.

```bash
npm install                              # install all workspaces
docker compose up -d postgres redis      # PostgreSQL 16 + Redis 7 for local dev
npm run build                            # turbo: build everything (shared builds before api)
npm run typecheck                        # turbo: tsc --noEmit everywhere
npm run lint                             # turbo: oxlint
npm run test                             # turbo: unit tests (Vitest)
npm run test:e2e -w @alora/api           # API e2e tests
npm run start:dev -w @alora/api          # API on http://localhost:3001/api/v1 (health: /api/v1/health)
docker compose up -d --build             # whole stack incl. API container
```

Adding a dependency to one app: `npm install <pkg> -w @alora/api` (never `cd` into the app and run npm
there — it would create a second lockfile).

`packages/shared` compiles to `dist/`; the API imports the built output. If the API can't find a new export
from `@alora/shared`, run `npm run build` first.

## 8. Environment notes

- Owner's machine: Windows 11. Scripts must work in Git Bash and PowerShell; avoid bash-only npm scripts.
- Node version: see `.nvmrc` and DECISIONS D-001.
