# Project status

> Every agent updates this file at the end of every session. Keep it short and current — it's a handoff
> note, not a history book. History goes in the session log at the bottom (newest first, one line each).

## Current state

On `main`: P1-01 to P1-11b done.
- `packages/shared` — roles, permission catalogue, API response types.
- `apps/api` — NestJS 12, `/api/v1/health`; Prisma 7 schema for 22 core tables + initial migration;
  `DatabaseModule` wired in; 5 migrations applied to the Neon dev DB. The API refuses to boot on an
  unmigrated database (boot-time RBAC sync).
- Common layer (P1-04): validated env config, `{success,data}` envelope + pagination, error filter
  (hides internals, maps Prisma errors), strict ValidationPipe, X-Request-Id, helmet, exact-origin CORS.
  Conventions in AGENTS.md §6 "Common layer".
- PHI encryption (P1-05): `PhiCryptoService` (AES-256-GCM, key rotation, column-bound context) — D-017.
- Auth (P1-06): login (Argon2id, lockout, uniform errors), refresh rotation with theft detection + idle
  timeout, logout, `/auth/me`, change-password; global JWT guard (`@Public()` to opt out), rate limits,
  `AuditService`. e2e suite (76 tests, ~3 min against Neon) passes against Neon and CI Postgres. Details: DECISIONS D-020.
- 2FA (P1-07, P1-11b): TOTP setup/enable/disable, two-step login with challenge token, replay protection,
  10 one-time recovery codes. Mandatory 2FA per role waits on Q-008. Details: DECISIONS D-021, D-026.
- RBAC (P1-08): 56 permissions + 11 built-in roles synced from code on every boot; `@Permissions()` +
  global `RbacGuard`; own-agency role scoping; 30 s cache. Details: DECISIONS D-022.
- Audit (P1-09): automatic audit_logs row for every permissioned request (success/failure, no PHI),
  ACCESS_DENIED, no-store cache headers. Details: DECISIONS D-023.
- API docs (P1-10): `/api/v1/docs` (off in prod); committed `docs/api/openapi.json` and the Base44 portal
  spec, kept fresh by CI. Details: DECISIONS D-024.
- Users (P1-11): admin user management with no-escalation rules, deactivate/unlock/reset-2FA, activity.
  Details: DECISIONS D-025.
- Dev environment: Neon (`alora` DB) + Upstash via git-ignored root `.env` (D-018). Other machines need the
  owner to supply `.env`.
- CI (GitHub Actions) — build/typecheck/lint/unit tests, applies migrations to a real Postgres, fails on
  schema/migration drift, runs DB e2e tests, builds the Docker image and health-checks it. All green.
- Docker does not run on the owner's laptop (D-011); CI covers the image.

## In progress

Nothing.

## Next up

**P1-12** — Patients module, the first PHI module: list/search, admit, get, update, discharge, readmit;
diagnoses (ICD-10), allergies, authorizations; SSN encrypted with `PhiContext.PatientSsn` and only the last 4
returned; record-level access — agency-wide roles (admin, supervisor, office, billing) see all agency patients,
field roles see only patients they have visits with (visits come in P1-14, so until then field roles see none).

## Blockers / waiting on human

- Q-008 which roles must use 2FA (blocks P1-11c only)
- Q-002 Base44 portal auth design — must be settled before P3-14/P3-16, not before Phase 1

## Session log

| Date | Agent | Task | Outcome |
|---|---|---|---|
| 2026-09-27 | Claude Code | P1-11b | 2FA recovery codes; CI green, merged. |
| 2026-09-27 | Claude Code | P1-11 | Users module + no-escalation rules; CI green, merged. |
| 2026-09-27 | Claude Code | P1-10 | OpenAPI docs + committed specs with CI freshness check; CI green, merged. |
| 2026-09-27 | Claude Code | P1-09 | Audit interceptor + denied-access logging + no-store; CI green, merged. |
| 2026-09-27 | Claude Code | P1-08 | RBAC (roles/permissions sync, guard), CI green, merged. |
| 2026-09-27 | Claude Code | P1-07 | 2FA (TOTP), CI green, merged. |
| 2026-09-27 | Claude Code | P1-06 | Auth module + Neon/Upstash dev env; e2e green locally and in CI; merged. |
| 2026-09-27 | Claude Code | P1-05 | PHI encryption service + key rotation, CI green, merged. |
| 2026-09-27 | Claude Code | P1-04 | Common layer done, CI green, merged. Also overrode Prisma CLI's vulnerable deps (D-015). |
| 2026-09-27 | Claude Code | P1-03 | Prisma schema (22 tables) + migration; CI migrates real Postgres + drift check, green; merged. |
| 2026-09-27 | Claude Code | P1-01, P1-02 | CI green on GitHub (checks + Docker image); merged to main. Repo public for build phase. |
| 2026-09-27 | Claude Code | P1-02 | CI workflow added (tests + Docker image in the cloud); Docker Desktop stopped on laptop. |
| 2026-09-27 | Claude Code | P1-01 | API + shared scaffolded, all tests pass; Docker image build unverified (local Docker crashed). |
| 2026-09-27 | Claude Code | P0-03 | Repo made private by owner; initial setup pushed to main. |
| 2026-09-27 | Claude Code | P0-01, P0-02 | Repo cloned, design doc imported, handoff system + root config created. |
