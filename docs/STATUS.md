# Project status

> Every agent updates this file at the end of every session. Keep it short and current — it's a handoff
> note, not a history book. History goes in the session log at the bottom (newest first, one line each).

## Current state

Phase 0 done. P1-01 and P1-02 merged to `main`: `packages/shared` (roles, permissions, API types),
`apps/api` (NestJS 12, `/api/v1/health`), and CI on GitHub Actions (tests + Docker image build and health
check) — green on GitHub. Docker does not run on the owner's laptop (D-011); CI covers it.

## In progress

Nothing.

## Next up

**P1-03** — Prisma schema for the core tables + first migration. Needs a development database first
(OPEN_QUESTIONS Q-007). Until the owner picks one, the schema can still be written and validated
(`prisma validate` / `prisma generate` need no database); migrations can be checked in CI with a Postgres
service container.

## Blockers / waiting on human

- Q-007 development database (Docker can't run on the laptop) — needed before P1-03
- Q-002 Base44 portal auth design — must be settled before P3-14/P3-16, not before Phase 1

## Session log

| Date | Agent | Task | Outcome |
|---|---|---|---|
| 2026-09-27 | Claude Code | P1-01, P1-02 | CI green on GitHub (checks + Docker image); merged to main. Repo public for build phase. |
| 2026-09-27 | Claude Code | P1-02 | CI workflow added (tests + Docker image in the cloud); Docker Desktop stopped on laptop. |
| 2026-09-27 | Claude Code | P1-01 | API + shared scaffolded, all tests pass; Docker image build unverified (local Docker crashed). |
| 2026-09-27 | Claude Code | P0-03 | Repo made private by owner; initial setup pushed to main. |
| 2026-09-27 | Claude Code | P0-01, P0-02 | Repo cloned, design doc imported, handoff system + root config created. |
