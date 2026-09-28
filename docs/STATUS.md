# Project status

> Every agent updates this file at the end of every session. Keep it short and current — it's a handoff
> note, not a history book. History goes in the session log at the bottom (newest first, one line each).

## Current state

**Phase 1 is complete** on `main` (P1-01 … P1-22), except P1-11c (mandatory 2FA — waits on the owner, Q-008).
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
  `AuditService`. e2e suite (136 tests, ~9 min against Neon) passes against Neon and CI Postgres. Details: DECISIONS D-020.
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
- Patients (P1-12): admit/list/search/get/update/discharge/readmit, diagnoses, allergies; encrypted SSN
  (last 4 only); field staff see only patients they have visits with. Details: DECISIONS D-027.
- Physicians directory (P1-12b): CRUD without delete, NPI check digit, unique NPI per agency. D-028.
- Staff (P1-13): profiles (pay/SSN only for payroll + self), credentials with computed expiry state and an
  expiring list, weekly availability, time off with approval; "self" rules for caregivers. D-029.
- Scheduling (P1-14): visits book/list/get/reschedule/reassign/cancel, calendar, conflict detector (blocking vs
  warning, audited override), agency-timezone "today"; caregivers see only their own visits. D-030.
- Recurring visits (P1-15): weekly/biweekly series, 28-day rolling window (manual `generate` until the P2-02 job),
  conflicting dates skipped + reported, edits rebuild future occurrences only. D-031.
- Notifications (P1-16): in-app inbox + `notify()` wired to visit and time-off events; PHI-free texts. D-032.
- Demo data (P1-17): `npm run db:seed -w @alora/api` rebuilds a FAKE demo agency; logins in README (D-033).
  The Neon dev DB currently holds it.
- Web dashboard (P1-18): Next.js 16 app in `apps/web` — login with 2FA/backup codes, change-password, httpOnly
  refresh cookie + in-memory access token, cross-tab-safe renewal, 15-min idle logout, permission-filtered shell,
  dashboard cards; placeholder pages for patients/staff/schedule/users/physicians. 4 Playwright browser tests pass
  locally (not in CI yet — P1-22). Auth rate limits relaxed for shared office IPs. D-034.
- Web patients (P1-19): list/search, detail, admit/edit, discharge/readmit, diagnoses, allergies. Web "today" uses
  the agency timezone (`useAgencyToday`); API future-date checks tolerate UTC+14. 6 Playwright tests (re-seed first). D-035.
- Web staff/users/physicians (P1-20) + `GET /roles`, `GET /staff/candidates`. All API "today" defaults now use the
  agency timezone (`AgencyClockService`). 10 Playwright tests. D-036.
- Web scheduling (P1-21): week calendar, book with live conflict check + audited override, recurring booking report,
  reschedule/reassign/cancel. 13 Playwright tests. D-037.
- CI (P1-22) now also runs the 13 browser tests: Postgres + migrations + API + dashboard + Playwright, seeded demo data.
- Dev environment: Neon (`alora` DB) + Upstash via git-ignored root `.env` (D-018). Other machines need the
  owner to supply `.env`.
- CI (GitHub Actions) — build/typecheck/lint/unit tests, applies migrations to a real Postgres, fails on
  schema/migration drift, runs DB e2e tests, builds the Docker image and health-checks it. All green.
- Docker does not run on the owner's laptop (D-011); CI covers the image.

## In progress

Nothing.

## Next up

**Phase 2 — EVV & mobile.** Start with **P2-01** EVV module: GPS clock-in/out (`POST /evv/clock-in`, `/evv/clock-out`),
geofence check (haversine vs `patients.geo_fence_radius_meters`, needs patient lat/long — add geocoding later, accept
coordinates set manually for now), EVV records with the 21st Century Cures Act six data points, visit status
scheduled → in_progress → completed, exceptions + supervisor verification. Then P2-04 visit documentation, P2-05
open shifts, P2-02 real-time + background jobs, P2-06+ mobile app. Human-only tasks (P2-11 Twilio/Firebase) are skipped
until the owner acts. The owner asked for autonomous work: go straight on, check in ~every 4 hours.

## Blockers / waiting on human

- Q-008 which roles must use 2FA (blocks P1-11c only)
- Q-002 Base44 portal auth design — must be settled before P3-14/P3-16, not before Phase 1

## Session log

| Date | Agent | Task | Outcome |
|---|---|---|---|
| 2026-09-28 | Claude Code | P1-22 | Browser tests in CI (green), README refresh. Phase 1 complete. |
| 2026-09-28 | Claude Code | P1-21 | Scheduling calendar screens; CI green, merged. |
| 2026-09-28 | Claude Code | P1-20 | Staff/users/physicians screens; agency clock; CI green, merged. |
| 2026-09-28 | Claude Code | P1-19 | Patient screens + timezone bug fix; CI green, merged. |
| 2026-09-27 | Claude Code | P1-18 | Web dashboard foundation + browser tests; rate-limit fix; CI green, merged. |
| 2026-09-27 | Claude Code | P1-17 | Demo seed + test; CI green, merged. Phase 1 API complete. |
| 2026-09-27 | Claude Code | P1-16 | In-app notifications; CI green, merged. |
| 2026-09-27 | Claude Code | P1-15 | Recurring visits; CI green, merged. |
| 2026-09-27 | Claude Code | P1-14 | Scheduling + conflict detection; CI green, merged. |
| 2026-09-27 | Claude Code | P1-13 | Staff module (profiles, credentials, availability, time off); CI green, merged. |
| 2026-09-27 | Claude Code | P1-12b | Physicians directory; DB pool/transaction limits for Neon flakiness; CI green, merged. |
| 2026-09-27 | Claude Code | P1-12 | Patients module (first PHI module); CI green, merged. |
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
