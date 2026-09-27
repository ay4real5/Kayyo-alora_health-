# Project status

> Every agent updates this file at the end of every session. Keep it short and current — it's a handoff
> note, not a history book. History goes in the session log at the bottom (newest first, one line each).

## Current state

On `main`: P1-01 to P1-04 done.
- `packages/shared` — roles, permission catalogue, API response types.
- `apps/api` — NestJS 12, `/api/v1/health`; Prisma 7 schema for 22 core tables + initial migration;
  `PrismaService`/`DatabaseModule` (not yet imported by AppModule — P1-06 does that).
- Common layer (P1-04): validated env config, `{success,data}` envelope + pagination, error filter
  (hides internals, maps Prisma errors), strict ValidationPipe, X-Request-Id, helmet, exact-origin CORS.
  Conventions in AGENTS.md §6 "Common layer".
- CI (GitHub Actions) — build/typecheck/lint/unit tests, applies migrations to a real Postgres, fails on
  schema/migration drift, runs DB e2e tests, builds the Docker image and health-checks it. All green.
- Docker does not run on the owner's laptop (D-011). Locally, DB tests skip when `DATABASE_URL` is unset.

## In progress

Nothing.

## Next up

**P1-05** — PHI encryption util (AES-256-GCM, key version byte, key from `PHI_ENCRYPTION_KEY`), see
DECISIONS D-006. No database needed. Then P1-06 (auth) — needs a dev database for local runs (Q-007);
CI can cover DB tests meanwhile.

## Blockers / waiting on human

- Q-007 development database (Docker can't run on the laptop) — needed before P1-03
- Q-002 Base44 portal auth design — must be settled before P3-14/P3-16, not before Phase 1

## Session log

| Date | Agent | Task | Outcome |
|---|---|---|---|
| 2026-09-27 | Claude Code | P1-04 | Common layer done, CI green, merged. Also overrode Prisma CLI's vulnerable deps (D-015). |
| 2026-09-27 | Claude Code | P1-03 | Prisma schema (22 tables) + migration; CI migrates real Postgres + drift check, green; merged. |
| 2026-09-27 | Claude Code | P1-01, P1-02 | CI green on GitHub (checks + Docker image); merged to main. Repo public for build phase. |
| 2026-09-27 | Claude Code | P1-02 | CI workflow added (tests + Docker image in the cloud); Docker Desktop stopped on laptop. |
| 2026-09-27 | Claude Code | P1-01 | API + shared scaffolded, all tests pass; Docker image build unverified (local Docker crashed). |
| 2026-09-27 | Claude Code | P0-03 | Repo made private by owner; initial setup pushed to main. |
| 2026-09-27 | Claude Code | P0-01, P0-02 | Repo cloned, design doc imported, handoff system + root config created. |
