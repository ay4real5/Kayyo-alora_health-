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
- Left: verify the Docker image builds. On the owner's laptop Docker Desktop crashed mid-pull, then the build
  failed with `exec format error` (corrupted/missing `node:24-alpine` image, not a Dockerfile problem as far
  as known). Next step: build the image in GitHub Actions instead (fold into P1-02), then merge P1-01.

## Next up

Finish P1-01 (Docker image check), then **P1-02** CI. See [ROADMAP.md](ROADMAP.md).

## Blockers / waiting on human

- Q-002 Base44 portal auth design — must be settled before P3-14/P3-16, not before Phase 1

## Session log

| Date | Agent | Task | Outcome |
|---|---|---|---|
| 2026-09-27 | Claude Code | P1-01 | API + shared scaffolded, all tests pass; Docker image build unverified (local Docker crashed). |
| 2026-09-27 | Claude Code | P0-03 | Repo made private by owner; initial setup pushed to main. |
| 2026-09-27 | Claude Code | P0-01, P0-02 | Repo cloned, design doc imported, handoff system + root config created. |
