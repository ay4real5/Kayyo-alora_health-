# Project status

> Every agent updates this file at the end of every session. Keep it short and current — it's a handoff
> note, not a history book. History goes in the session log at the bottom (newest first, one line each).

## Current state

Phase 0 done. P1-01 nearly done on branch `task/P1-01-scaffold-api`: `packages/shared` (roles, permissions,
API types) and `apps/api` (NestJS 12, `/api/v1/health`) exist. Build, typecheck, lint, unit and e2e tests all
pass, and the API was run and answered on port 3001.

## In progress

**P1-01** on branch `task/P1-01-scaffold-api`.
- Done: shared package, API scaffold, health endpoint + tests, `docker/Dockerfile.api`, `api` service in
  docker-compose, DECISIONS D-009/D-010, AGENTS.md §7 commands.
- Left: confirm the Docker image builds. Local Docker crashed the laptop (5.7 GB RAM), so this is now
  checked by CI (P1-02, `.github/workflows/ci.yml`, pushed on this branch). Next step: look at the CI run
  for this branch on GitHub → Actions. If both jobs are green, tick P1-01 + P1-02 and merge to main.

## Next up

Finish P1-01 (Docker image check), then **P1-02** CI. See [ROADMAP.md](ROADMAP.md).

## Blockers / waiting on human

- Q-007 development database (Docker can't run on the laptop) — needed before P1-03
- Q-002 Base44 portal auth design — must be settled before P3-14/P3-16, not before Phase 1

## Session log

| Date | Agent | Task | Outcome |
|---|---|---|---|
| 2026-09-27 | Claude Code | P1-02 | CI workflow added (tests + Docker image in the cloud); Docker Desktop stopped on laptop. |
| 2026-09-27 | Claude Code | P1-01 | API + shared scaffolded, all tests pass; Docker image build unverified (local Docker crashed). |
| 2026-09-27 | Claude Code | P0-03 | Repo made private by owner; initial setup pushed to main. |
| 2026-09-27 | Claude Code | P0-01, P0-02 | Repo cloned, design doc imported, handoff system + root config created. |
