# Project status

> Every agent updates this file at the end of every session. Keep it short and current — it's a handoff
> note, not a history book. History goes in the session log at the bottom (newest first, one line each).

## Current state

On `main`: P1-01, P1-02, P1-03 done.
- `packages/shared` — roles, permission catalogue, API response types.
- `apps/api` — NestJS 12, `/api/v1/health`; Prisma 7 schema for 22 core tables + initial migration;
  `PrismaService`/`DatabaseModule` (not yet imported by AppModule — P1-06 does that).
- CI (GitHub Actions) — build/typecheck/lint/unit tests, applies migrations to a real Postgres, fails on
  schema/migration drift, runs DB e2e tests, builds the Docker image and health-checks it. All green.
- Docker does not run on the owner's laptop (D-011). Locally, DB tests skip when `DATABASE_URL` is unset.

## In progress

Nothing.

## Next up

**P1-04** — common layer: response-envelope interceptor, exception filter, validation pipe,
correlation-id middleware, config module with env validation (replace the raw `process.env` reads in
`main.ts` and `prisma.service.ts`). Needs no database. Then P1-05 (PHI encryption util), also DB-free.
P1-06 (auth) onward needs a dev database for local runs — see Q-007 — though CI can cover it.

## Blockers / waiting on human

- Q-007 development database (Docker can't run on the laptop) — needed before P1-03
- Q-002 Base44 portal auth design — must be settled before P3-14/P3-16, not before Phase 1

## Session log

| Date | Agent | Task | Outcome |
|---|---|---|---|
| 2026-09-27 | Claude Code | P1-03 | Prisma schema (22 tables) + migration; CI migrates real Postgres + drift check, green; merged. |
| 2026-09-27 | Claude Code | P1-01, P1-02 | CI green on GitHub (checks + Docker image); merged to main. Repo public for build phase. |
| 2026-09-27 | Claude Code | P1-02 | CI workflow added (tests + Docker image in the cloud); Docker Desktop stopped on laptop. |
| 2026-09-27 | Claude Code | P1-01 | API + shared scaffolded, all tests pass; Docker image build unverified (local Docker crashed). |
| 2026-09-27 | Claude Code | P0-03 | Repo made private by owner; initial setup pushed to main. |
| 2026-09-27 | Claude Code | P0-01, P0-02 | Repo cloned, design doc imported, handoff system + root config created. |
