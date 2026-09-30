# Decisions log

Decisions that refine or override [DESIGN.md](DESIGN.md). **Where they disagree, this file wins.**
Append new entries at the bottom; never rewrite an old one — supersede it with a new entry instead.

Format: `D-NNN — title` · date · who · decision · why.

---

### D-001 — Node and library versions
2026-09-27 · Claude Code
- Use **Node 24 LTS** (pinned in `.nvmrc`), not Node 20. Node 20 reached end-of-life in April 2026, which
  is not acceptable for a HIPAA system that needs security patches.
- The versions in DESIGN.md §2 (NestJS 10, Next.js 14, Prisma 5, Expo 51, RN 0.74) are **minimums**, not
  pins. Scaffold with the current stable release of each, then record the actual major versions here in a
  new entry so later agents don't upgrade/downgrade by accident.

### D-002 — Package manager and build tool
2026-09-27 · Claude Code
npm workspaces + Turborepo, as in the design. Workspaces: `apps/*`, `packages/*`. One lockfile at the root.
Don't introduce pnpm/yarn.

### D-003 — Prisma schema is the source of truth for the database
2026-09-27 · Claude Code
The SQL in DESIGN.md §5 is the logical model. Once `apps/api/prisma/schema.prisma` exists, it is
authoritative. Column/table changes happen via Prisma migrations and are noted here if they depart from §5.

### D-004 — Permission string format
2026-09-27 · Claude Code
Permissions are `resource:action` (`patients:read`, `billing:submit`), matching the `permissions` table
(`resource`, `action`). DESIGN.md §6 writes them as `action:resource` (`read:patients`); translate when
implementing. Roles like `admin`/`self` in those tables mean: `admin` = `agency_admin` or `super_admin`;
`self` = the authenticated user acting on their own record.

### D-005 — Roles: `user_roles` is authoritative
2026-09-27 · Claude Code
The design has both `users.role` and a `user_roles` join table. Permission checks use `user_roles` only.
Drop `users.role` from the Prisma schema to avoid two sources of truth.

### D-006 — PHI field encryption
2026-09-27 · Claude Code
AES-256-**GCM** (authenticated) with a random 12-byte IV per value, stored as `iv || authTag || ciphertext`
in `BYTEA`. Key from `PHI_ENCRYPTION_KEY` (32 bytes, base64). Include a key-version byte prefix so keys can
be rotated later.

### D-007 — Tenant scoping
2026-09-27 · Claude Code
Every query on tenant data filters by the caller's `agency_id`. Child tables without an `agency_id` column
(e.g. `patient_diagnoses`) are scoped through their parent. A test must exist per module proving a user
from agency A cannot read agency B's records.

### D-008 — No wildcard CORS
2026-09-27 · Claude Code
DESIGN.md §16.3 allows `https://*.base44.app`, which would let *any* Base44 app call the API from a browser.
CORS allows exact origins only, from `CORS_ORIGINS`. (If the Base44 portal calls the API server-side, it
needs no CORS entry at all.)

### D-009 — Actual versions at scaffold time (P1-01)
2026-09-27 · Claude Code
- **NestJS 12**, **TypeScript ~6.0** (not 7). TS 7 is the new native compiler; the Nest 12 CLI requires
  `typescript ~6.0` and test tooling doesn't support 7 yet. Revisit when Nest supports TS 7.
- **Vitest 4** instead of Jest, **oxlint** instead of ESLint — these are the Nest 12 defaults, so we keep
  them rather than fight the framework. This replaces "Jest + Supertest" in DESIGN.md §2 (Supertest stays).
- **ES modules** (`"type": "module"`, `nodenext`). Relative imports must end in `.js`
  (e.g. `import { X } from './x.service.js'`), even in `.ts` files.
- **Prisma: use the latest stable 7.x, not 8.x.** At this date npm's `latest` tag for Prisma points to an
  8.0 release candidate. Don't use pre-release versions in this project.
- Removed `@nestjs/mau` (Nest's paid hosting CLI): unused, and it pulled in a vulnerable `undici`.

### D-010 — API app setup lives in `setup-app.ts`
2026-09-27 · Claude Code
Global prefix, pipes, filters, interceptors, CORS, Swagger etc. are applied in `apps/api/src/setup-app.ts`,
which both `main.ts` and the e2e tests call. That way e2e tests exercise the real configuration.

### D-011 — Docker runs in the cloud, not on the owner's laptop
2026-09-27 · Claude Code
The owner's laptop has 5.7 GB RAM; Docker Desktop crashed it. So:
- Docker image builds and container checks run in **GitHub Actions** (`.github/workflows/ci.yml`) on every push.
- Agents working on the owner's laptop must **not start Docker Desktop**. Run the API with `npm run start:dev`.
- Local database/Redis for development: see OPEN_QUESTIONS Q-007 (cloud dev database). Dev data is always
  fake, so a free cloud database is fine for development; production still needs HIPAA hosting (Q-006).
- Agents running in their own cloud VM (e.g. Devin) may use Docker there normally.

### D-012 — Repo is public during the build phase
2026-09-27 · Owner
The owner made the repo public so agents can read CI results and work without GitHub credentials. It will be
made private or moved before real use. Consequences: **never commit secrets, real PHI, or real agency/patient
data** (already a rule), and assume anything pushed can be copied permanently. CI results are readable at
`https://api.github.com/repos/ay4real5/Kayyo-alora_health-/actions/runs` without auth.

### D-013 — Schema departures from DESIGN.md §5 (P1-03)
2026-09-27 · Claude Code
- **Prisma 7 setup**: generator `prisma-client` → `apps/api/src/generated/prisma` (git-ignored, rebuilt by the
  turbo `generate` task). No DB URL in the schema; it's in `apps/api/prisma.config.ts`, which loads the root
  `.env`. Postgres access goes through `@prisma/adapter-pg`.
- `users.role` dropped (D-005). Roles come from `user_roles`.
- `roles.agency_id` is **nullable**: NULL = built-in system role shared by all agencies (`is_system = true`);
  agency-specific custom roles have an agency. Unique on (agency_id, name).
- `patients.authorization_id` dropped — authorizations already point at the patient; a second link would drift.
- Added `documents.deleted_at` — the API spec says "soft-delete document" but the table had no column for it.
- Added unique (agency_id, employee_id) on `staff_profiles` — IVR clock-in identifies caregivers by employee ID.
- `refresh_tokens.token_hash` indexed (looked up on every refresh).
- `audit_logs` has no foreign keys on purpose (entries must outlive the rows they describe).
- Status columns stay `VARCHAR` as in the design; valid values are enforced in DTOs, not DB enums, so
  adding a status never needs a migration.
- Tables not needed until later phases (care plans, assessments, EVV, billing, payroll, messaging…) are added
  by the task that first needs them, each with its own migration.

### D-014 — Migrations workflow
2026-09-27 · Claude Code
- Change `schema.prisma`, then create a migration. With a database: `npm run db:migrate -w @alora/api -- --name <name>`.
  Without one (owner's laptop): write the SQL with
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
  (needs a shadow DB) or, for the very first migration only, `--from-empty`.
- CI applies all migrations to a fresh Postgres and **fails if the migrations don't match `schema.prisma`**.
- Never edit a migration that has been merged to `main`; add a new one.

### D-015 — npm overrides for Prisma CLI's vulnerable dependencies
2026-09-27 · Claude Code
`prisma@7.10.0` (dev tool) pins `mysql2@3.15.3` and `@prisma/config` pins `deepmerge-ts@7.1.5`, both with
high-severity advisories. Root `package.json` `overrides` forces `mysql2 ^3.23.1` and `deepmerge-ts ^8.0.0`.
Verified: `prisma validate/generate/migrate diff` and CI migrations still work. `npm ls` reports them as
"invalid" — expected with overrides. **Remove the overrides when Prisma ships a release with fixed pins.**
Note: npm only applies new overrides on a clean install (delete `node_modules` + `package-lock.json`).

### D-016 — Common layer details (P1-04)
2026-09-27 · Claude Code
- Env validation uses class-validator (as the design's DTOs do), not a second library like zod.
- `DATABASE_URL` is optional outside production so the API (and non-DB tests) can start without a
  database; `PrismaService` throws a clear error if it's used without one. Required when `APP_ENV=production`.
- ValidationPipe: `whitelist` + `forbidNonWhitelisted` + `transform`. Unknown fields are a 400, not silently dropped.
- The design's `common/pipes/validation.pipe.ts` isn't needed — Nest's built-in ValidationPipe is configured in
  `setup-app.ts`.
- Unknown paths *outside* `/api/v1` get Express's default HTML 404 (Nest only handles 404s under the prefix).
  Accepted: production only proxies `/api`. Unknown paths under `/api/v1` get the JSON error format.
- Tests load `reflect-metadata` via Vitest `setupFiles`, as the real app does through Nest.

### D-017 — PHI encryption implementation (P1-05)
2026-09-27 · Claude Code
Implements D-006 in `apps/api/src/common/crypto/`.
- Format: `[version:1][iv:12][tag:16][ciphertext]`, AES-256-GCM, random IV per value.
- Each value is bound to a **context label** (`PhiContext`, e.g. `patients.ssn_encrypted`) as GCM additional
  authenticated data, so ciphertext moved to another column won't decrypt. **Never rename a PhiContext value**
  — existing data becomes unreadable.
- Use `PhiCryptoService.encrypt/decrypt` (injected; `CryptoModule` is global). Don't call node:crypto directly.
- Keys: `PHI_ENCRYPTION_KEY` (current), `PHI_ENCRYPTION_KEY_VERSION`, `PHI_ENCRYPTION_PREVIOUS_KEYS`
  ("1:<b64>,2:<b64>"). Rotation = new key + bumped version + old key moved to PREVIOUS_KEYS; a later job can
  re-encrypt old values (find them with `keyVersionOf`). Required in production; optional in dev (the service
  throws only when PHI is actually encrypted/decrypted without a key).
- Encrypted columns can't be searched. If we ever need "find patient by SSN", add a separate keyed hash
  (HMAC) column — don't decrypt-and-scan.
- Production keys belong in a secrets manager (e.g. AWS KMS/Secrets Manager), not in a `.env` file. Decide
  with hosting (Q-006).

### D-018 — Development environment: Neon + Upstash (dev only, fake data only)
2026-09-27 · Owner + Claude Code
- Postgres: Neon project `neon-camel-clock` (Vercel-managed account), branch `main`, **database `alora`**
  (the project's other database `neondb` belongs to something else — never touch it). Use the **direct**
  host (no `-pooler`) with `sslmode=verify-full`; Prisma migrations need a direct connection.
- Redis: Upstash database `precious-stag-128343`, TLS (`rediss://`).
- Neon runs **Postgres 17**, so CI and docker-compose use 17 too (DESIGN.md said 16).
- Connection strings live only in the git-ignored root `.env`. Agents on another machine (e.g. Devin) must
  get them from the owner — never commit them.
- **Only fake data** goes into these services; they are not HIPAA-covered.

### D-019 — Before go-live: rotate every development credential
2026-09-27 · Owner
Some development credentials were shared in the owner's AI chat during setup (Neon role password, Upstash
token, a Vercel token). The owner chose to continue and rotate later. **Go-live checklist item:** reset the
Neon `neondb_owner` password, reset the Upstash password, revoke Vercel tokens, and generate new
JWT/PHI keys — production uses fresh secrets from a secrets manager, never the dev ones. Tracked as ROADMAP P4-12.

### D-020 — Authentication design (P1-06)
2026-09-27 · Claude Code
- **Passwords: Argon2id** (`@node-rs/argon2`, OWASP defaults m=19 MiB, t=2, p=1), not bcrypt — bcrypt
  silently ignores bytes past 72. PHC strings record parameters, so they can be raised later.
- **Emails are globally unique**, stored lower-cased (migration `users_email_global_unique`). The design's
  login is `{ email, password }` with no agency field, which only works if an email maps to one account.
  Revisit if one person must work for two agencies (Q-003).
- **Access tokens**: HS256 JWT, 15 min, claims `sub` + `agencyId`, issuer `alora-api`, audience `alora`.
  Stateless: after logout/deactivation an access token stays valid until it expires (≤15 min). Accepted.
- **Refresh tokens**: 32 random bytes (not JWTs), stored as SHA-256 only. Rotated on every use; the new
  token keeps the session's absolute expiry (7 days). `revoked_reason` records why each was revoked; only
  presenting a **rotated** token counts as theft → all of that user's sessions are revoked and audited.
  So `JWT_REFRESH_SECRET` from the design is gone.
- **Idle timeout** (HIPAA auto-logoff): a refresh token unused for `SESSION_IDLE_TIMEOUT_MINUTES` (30) is
  refused. Must exceed the access TTL, or active users would be logged out; enforced at startup. Clients
  should also enforce a 15-min idle UI lock (DESIGN.md §7.3).
- **Lockout**: 5 wrong passwords → 30-min lock, all sessions revoked, `ACCOUNT_LOCKED` audited.
  **One error message for every login failure** (unknown email, wrong password, locked, inactive) and a dummy
  hash check for unknown emails, so responses don't reveal which accounts exist.
- **2FA fails closed**: a user with `is_2fa_enabled` cannot log in until P1-07 implements the second step.
- **Password age**: past `PASSWORD_MAX_AGE_DAYS` (90; 0 = off) login still works but returns
  `mustChangePassword: true`; the web/mobile apps must force the change. (NIST 800-63B discourages forced
  rotation; kept because the design asks for it — configurable.)
- **Guards**: `JwtAuthGuard` is global — every route needs a token unless marked `@Public()`.
  `ThrottlerGuard` global at 300 req/min/IP; `/auth/login`, `/refresh`, `/change-password` at 10/min/IP.
  The throttle store is in-memory (per instance) — move to Redis before running more than one API instance.
  Behind a load balancer, set Express `trust proxy` so the real client IP is used (P4-10).
- Logout is `@Public()` and takes the refresh token, so a client with an expired access token can still end
  its session. Forgot/reset-password waits for the email channel (P3-19).
- Web: the design stores the refresh token in an httpOnly cookie. The API returns it in the body; the
  Next.js server layer (P1-18) sets the cookie.

### D-021 — Two-factor authentication (P1-07)
2026-09-27 · Claude Code
- **TOTP (RFC 6238)**: SHA-1, 30 s, 6 digits, ±1 step drift — what every authenticator app supports.
  Implemented on `node:crypto` in `modules/auth/two-factor/totp.ts`, proven against the RFC's test vectors.
- Flow: `POST /auth/2fa/setup` → `{ otpauthUri, secret }` (the client renders the URI as a QR code; the API
  doesn't generate images). `POST /auth/2fa/enable {code}` turns it on. `POST /auth/2fa/disable
  {password, code}` needs both, so a hijacked session alone can't remove 2FA.
- Login for 2FA users: `/auth/login` returns `{ requires2FA: true, twoFactorToken, expiresIn: 300 }` instead of
  tokens. `twoFactorToken` is a JWT with audience `alora-2fa`, so it is never accepted as an access token.
  `POST /auth/2fa/verify {twoFactorToken, code}` returns the normal session.
- **Replay protection**: `users.two_fa_last_used_step` — a code whose time step is ≤ the last accepted one is
  refused, enforced by an atomic conditional update.
- Wrong codes count toward the same 5-attempt lockout as wrong passwords.
- Secret storage: base32 secret encrypted with `PhiContext.UserTwoFaSecret`, stored base64 in
  `users.two_fa_secret`. Requires `PHI_ENCRYPTION_KEY`.
- **Not yet built**: recovery codes, and admin "reset 2FA" for a user who lost their phone. Until then an
  admin fixes it in the database. Add both with the Users module (P1-11). Per-role "2FA required" policy
  (e.g. mandatory for admins/billing) is also a P1-11/P1-08 follow-up.

### D-022 — RBAC implementation (P1-08)
2026-09-27 · Claude Code
- **Code is the source of truth for built-in roles.** `ROLE_DEFAULT_PERMISSIONS` (`@alora/shared`) defines
  what each of the 11 system roles may do, derived from DESIGN.md §7.2. `RbacSyncService` runs on every API
  start: inserts missing permissions from `PERMISSION_CATALOGUE`, creates missing system roles
  (`agency_id` NULL, `is_system`), and sets their grants to exactly the code's list (drift is repaired).
  To change a built-in role, change the code. Agencies needing something different create **custom roles**
  (their own `agency_id`), which the sync never touches. Permissions removed from code are left in the table.
- System-role names are unique through a **partial unique index** (`WHERE agency_id IS NULL`), using
  Prisma's `partialIndexes` preview feature — plain `UNIQUE(agency_id, name)` allows duplicate NULLs.
- `@Permissions('a:b', 'c:d')` = caller needs **all** listed. Routes without it need only a login. Every
  route touching PHI or agency data **must** declare permissions.
- `RbacGuard` is global, registered right after `JwtAuthGuard` in AuthModule (order matters); it refuses
  anonymous callers even on a misconfigured `@Public()` + `@Permissions` route.
- A user's roles count only if they're system roles or custom roles of **the user's own agency**.
- Lookups are cached per user for 30 s per API instance; call `PermissionsService.invalidate()` after role
  changes (P1-11). Across instances, changes take up to 30 s.
- Permissions are coarse ("may read patients at all"). Record-level rules — nurses see only assigned
  patients, caregivers only their own visits — belong in each module's queries (P1-12 onwards).
- Role choices worth reviewing with the owner: LPNs can't write care plans or physician orders; aides can
  write but not sign visit notes; supervisors have no billing access; office staff can create patients.

### D-023 — HIPAA audit trail (P1-09)
2026-09-27 · Claude Code
- **Automatic**: the global `AuditInterceptor` writes one `audit_logs` row for every request by a logged-in
  user to a route with `@Permissions` (or `@Audit`) — on success **and** on failure (e.g. 404). Default action
  `VIEW_/CREATE_/UPDATE_/DELETE_<RESOURCE>` from the HTTP method and the first permission's resource; the
  record id comes from the `:id` route param, or from the response `id` on creates.
- `@Audit({ action, resourceType, idParam })` names things precisely (e.g. `DISCHARGE_PATIENT`).
  `@SkipAudit()` only for routes returning no PHI.
- **Never stored**: request bodies, query-string values, response bodies. Stored: route *pattern*, method,
  outcome, status, duration, query-parameter *names*, list result count, correlation id, IP, user agent.
- `RbacGuard` records `ACCESS_DENIED` with the missing permissions. Auth events (login, lockout, 2FA,
  password change, token theft) are recorded by the auth module (D-020/D-021).
- The audit write is awaited before the response is sent. If it fails, the error is logged loudly but the
  request still succeeds — availability over strictness; revisit if compliance requires fail-closed.
- Every API response carries `Cache-Control: no-store` (+ `Pragma: no-cache`) — no response may be cached.
- Not yet: querying the trail (`/compliance/audit-logs`, P4-05), monthly partitioning + 6-year retention
  (P4-08), and a DB-level guard against UPDATE/DELETE on `audit_logs` (add with P4-08). *Done: D-067.*
- E2E test files now run sequentially with 30 s timeouts — they hit a remote database.

### D-024 — OpenAPI docs and committed spec (P1-10)
2026-09-27 · Claude Code
- Generated by `@nestjs/swagger` with its compiler plugin (nest-cli.json): DTO types and class-validator rules
  become schemas automatically; JSDoc on DTO properties becomes descriptions. Tests (Vitest) don't run the
  plugin, so schemas there are thinner — the committed files are built by `nest build`.
- Interactive docs at `/api/v1/docs` (JSON at `/api/v1/docs-json`). **Off in production by default**
  (`API_DOCS_ENABLED` overrides), so the live system doesn't publish a map of itself.
- Global bearer security; `@Public()` routes get `security: []` (via an `x-public` marker the builder strips).
- **Committed specs**: `docs/api/openapi.json` (whole API — read this instead of running the server) and
  `docs/base44-portal/openapi-portal-spec.json` (`/portal/*` + login, for Base44). Regenerate with
  `npm run build && npm run openapi -w @alora/api`. **CI fails if they're stale.**
- Response bodies aren't described yet (services return plain types). Portal endpoints (P3-14) must declare
  `@ApiOkResponse` DTOs so Base44 gets full response schemas.
- `@scarf/scarf` (download-analytics telemetry pulled in by swagger-ui) has its install script **denied**.

### D-025 — Users module rules (P1-11)
2026-09-27 · Claude Code
- Admin-created users get an admin-chosen starting password (policy-checked) with `password_changed_at`
  NULL, so their first login returns `mustChangePassword: true`. Email invitations wait for P3-19 (email).
- **No privilege escalation**: a caller can only grant roles whose permissions they already hold, and can
  only deactivate / reactivate / unlock / re-role / reset 2FA for users whose access they fully cover.
  Only a `super_admin` can grant `super_admin` or manage one. Access of the target is computed from their
  assigned roles (`PermissionsService.forRoles`), so it works for deactivated accounts too.
- Nobody can change their own roles or deactivate themselves.
- `DELETE /users/:id` **deactivates**; users are never deleted (audit history must stay attributable).
  Deactivation revokes every refresh token immediately; existing access tokens expire within 15 minutes.
- Other agencies' users return 404 (indistinguishable from non-existent). Because emails are globally unique
  (D-020), creating a user whose email exists in another agency returns 409 — a small cross-agency
  existence leak, accepted for now.
- `GET /users/:id/activity` needs `users:read` **and** `audit_logs:read`.

### D-026 — 2FA recovery codes (P1-11b)
2026-09-27 · Claude Code
- 10 codes per user, `XXXX-XXXX-XXXX-XXXX` (16 base32 chars = 80 random bits). Returned **once** by
  `POST /auth/2fa/enable` (now 200 with `{ recoveryCodes }`, was 204) and by
  `POST /auth/2fa/recovery-codes {password, code}`, which replaces the whole set.
- Stored as SHA-256 in `two_fa_recovery_codes`. With 80 bits of entropy a slow hash isn't needed, and a fast
  one allows direct lookup. Input is case/space/dash-insensitive.
- Login: `POST /auth/2fa/verify` takes `code` **or** `recoveryCode` (exactly one). Each code works once (atomic
  conditional update); wrong codes count toward lockout; use is audited with the number remaining.
  `/auth/me` returns `recoveryCodesRemaining`.
- Disabling 2FA or an admin 2FA reset deletes the user's codes.
- Mandatory 2FA per role is not built — waiting on the owner's choice (Q-008, ROADMAP P1-11c).

### D-027 — Patients module (P1-12)
2026-09-27 · Claude Code
- **Record-level access** (`PatientsService.scope`, used by every query): always the caller's agency; with the
  new permission `patients:read_all` (agency/super admin, supervisor, office staff, billing staff) every agency
  patient; otherwise (field staff with only `patients:read`) just patients the caller has **at least one visit
  with**. Out-of-scope patients are 404. Revisit when scheduling lands (P1-14): e.g. whether a caregiver keeps
  access after their last visit, and supervisor-assigned case managers.
- **SSN**: encrypted with `PhiContext.PatientSsn` (digits only); responses carry only `ssnLast4`, and only
  in the detail view. Lists return summaries (no SSN, no contact details).
- Status changes only through actions: `POST /patients` (admit → active), `/discharge`, `/readmit`. PATCH can't
  set status. Statuses: `active`, `discharged` (add more, e.g. `on_hold`, when a workflow needs them).
- MRN optional, unique per agency (migration). Diagnosis codes are shape-checked and normalised (`e119` →
  `E11.9`) but not looked up in the ICD-10 code set yet (billing, P3). One primary diagnosis per patient.
  The design's `patients.primary_diagnosis_code` column is unused — the primary comes from `patient_diagnoses`.
- Dates are `YYYY-MM-DD`; "today" defaults use **UTC**. Switch to the agency's timezone (`agencies.timezone`)
  when scheduling needs it (P1-14).
- Moved out: authorizations → P3-01 (they need payers). New task P1-12b: physicians directory. Medications,
  care plans, assessments, orders → P3-11 as planned.

### D-028 — Physicians directory (P1-12b) and DB connection settings
2026-09-27 · Claude Code
- `/physicians`: list/search (name, practice, exact NPI), create, get, update. **No delete** — physicians are
  referenced by patients, orders and care plans; set `isActive: false` instead.
- NPI is optional but, when given, must pass the CMS check-digit test (`isValidNpi` in `@alora/shared`, Luhn
  over "80840" + 9 digits) and be unique within the agency (migration). Not verified against NPPES yet — add
  an NPPES lookup when billing needs it (P3).
- New permissions `physicians:create/read/update`. Read: every clinical role, office, billing. Write:
  supervisor, office staff, admins.
- Services write **explicit column lists** from DTOs (no object spreading into Prisma), so a future DTO field
  can't silently reach the database.
- Shared DTO helpers live in `common/validators/fields.ts` (phone, state, ZIP, trim transforms) — reuse them.
- Postgres pool: idle connections recycled after 60 s (serverless Postgres like Neon drops idle connections
  when it scales to zero) and a 10 s connect timeout. Added after intermittent e2e failures against Neon.

### D-029 — Staff module (P1-13)
2026-09-27 · Claude Code
- A staff profile belongs to exactly one existing user of the same agency (`POST /staff {userId, …}`); create the
  login in `/users` first. `DELETE /staff/:id` **terminates** (inactive + termination date) — the login account
  is managed separately, profiles are never deleted.
- **"Self" rules**: a staff member may read their own profile (`GET /staff/me` or by id), credentials,
  availability and time off, set their own availability, and request/cancel their own time off — without
  `staff:*` permissions. These routes carry `@Audit` (not `@Permissions`) and the service checks
  "self, or the named permission" (`StaffService.assertSelfOr`).
- **Pay and SSN**: `pay` (rates as decimal strings like `"21.50"`, tax status, `ssnLast4`) appears only for
  `payroll:read` holders and the person themselves. SSN encrypted with `PhiContext.StaffSsn`.
- Credentials: `state` (valid / expiring_soon / expired / no_expiry) is **computed** from expiry date and
  `alertDaysBefore`, never stored. `GET /staff/expiring-credentials?withinDays=30` lists active staff's expired and
  soon-expiring credentials. `PATCH … {verified: true}` records who verified. Document upload waits for P3-12;
  automatic alerts for P4-05 (cron) + notifications.
- Availability: `PUT` replaces the weekly schedule; slots must be start < end and must not overlap per day.
  `effective_date`/`end_date` (dated availability) are not used yet.
- Time off: overlapping pending/approved requests are refused; approve/deny need `time_off:approve` and can't
  be your own; only pending requests can change; the requester can cancel.
- Disciplines: RN, LPN, PT, PTA, OT, COTA, SLP, MSW, HHA, CNA, PCA (`DISCIPLINES` in `@alora/shared`).
- Date/time helpers are shared: `common/utils/dates.ts`, `common/validators/is-date-only.ts`.

### D-030 — Scheduling (P1-14)
2026-09-27 · Claude Code
- Visit date and times are **agency-local wall-clock values** (`DATE` + `TIME`, no timezone). "Today" comes from
  `agencies.timezone` via `todayInTimeZone` (`@alora/shared`). Visits can't cross midnight (end > start).
- Access mirrors patients (D-027): new permission `visits:read_all` (supervisor, office, billing, admins) sees all
  agency visits; otherwise only the caller's own. **Cancelled visits no longer give a caregiver access to the
  patient** (patient scope now requires a non-cancelled visit).
- **Conflict detector** (`ConflictDetectorService`, one place for all rules), used by create, update and
  `GET /schedule/conflicts` (pre-check, writes nothing):
  - blocking: `staff_double_booked` (overlapping scheduled/in-progress/completed visit; back-to-back is fine),
    `staff_time_off` (approved), `staff_inactive` (inactive or terminated by that date), `patient_not_active`.
  - warning: `staff_time_off_pending`, `outside_availability` (only if the caregiver stated any availability),
    `discipline_mismatch` (`VISIT_TYPE_DISCIPLINES`), `staff_credentials_expired` (by the visit date),
    `before_admission`, `in_the_past`.
  - Blocking → `409 { code: 'SCHEDULE_CONFLICT', details: [...] }`. `override: true` books anyway but needs
    `visits:approve` and writes an `OVERRIDE_SCHEDULE_CONFLICT` audit entry. Warnings come back in `warnings`.
- Only `scheduled` visits can be changed or cancelled here; cancel needs a reason. `in_progress`/`completed`
  come from EVV (P2-01); `missed` from the late/no-show job (P2-02).
- Unassigned visits (`staffId` null) are allowed — the basis for open shifts (P2-05).
- The exception filter now forwards `code` and `details` from `new XxxException({ message, code, details })`.
- Not yet: authorization-limit checks (needs P3-01 authorizations), travel time between visits, recurring
  visits (P1-15).

### D-031 — Recurring visits (P1-15)
2026-09-27 · Claude Code
- A `recurrence_rules` row is the pattern (weekly or biweekly on chosen weekdays, fixed times, start date, optional
  end date or max occurrences). Its occurrences are ordinary `visits` (`is_recurring`, `recurrence_rule_id`).
- Dates come from `recurrenceDates` (`@alora/shared`): deterministic, "biweekly" = every other week counted from the
  Sunday-based week of `startDate`, `maxOccurrences` counts from the start date (including skipped dates).
- **Rolling window**: occurrences are created from today (agency timezone) up to 28 days ahead. Nothing extends the
  window automatically yet — `POST /schedule/recurring/:id/generate {until?}` does it on demand; a nightly BullMQ job
  must call the same logic (**add to P2-02**). Max 1 year ahead.
- Every occurrence goes through the conflict detector. **Blocking conflicts skip that date** (reported in
  `generation.skipped`); the rest are booked; warnings are reported per date. Series can't override conflicts —
  book a skipped date individually (with `override` if appropriate).
- Unique `(recurrence_rule_id, scheduled_date)` (migration): generation is idempotent, and a date where one
  occurrence was cancelled is never silently re-booked.
- `PATCH` (staff, visit type, service code, weekdays, times, end date) deletes **future `scheduled`** occurrences and
  regenerates; past, in-progress, completed and cancelled occurrences are untouched. `startDate`, `frequency`
  and `maxOccurrences` can't change — end the series and create a new one.
- `DELETE` ends the series: rule inactive, future scheduled occurrences cancelled ("Recurring schedule ended").
- Editing one occurrence through `/schedule/visits/:id` is allowed; a later rule `PATCH` will replace it if it is
  still a future scheduled occurrence.

### D-032 — In-app notifications (P1-16)
2026-09-27 · Claude Code
- `NotificationsService.notify({ agencyId, userIds, type, title, body, data, actorUserId })` (global module) writes
  `notifications` rows. It never throws — a failed notification must not fail the action that caused it — and never
  notifies the actor about their own action.
- **No PHI in title/body** (DESIGN.md §13.3): dates, times and counts only ("You have a visit on 2026-10-05 at
  09:00. Open the app for details."). `data` carries IDs for deep links only. A test checks the patient's name never
  appears.
- Wired in now: visit assigned / reassigned (old caregiver told `shift_unassigned`, new `shift_assigned`) /
  rescheduled (`shift_updated`, only when date or time changes) / cancelled; recurring series created or changed
  (one notification per series, not per visit); time off approved/denied.
- Inbox: `GET /notifications?unreadOnly=`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`,
  `POST /notifications/mark-all-read`. Every logged-in user has one; others' notifications are 404. Not audited
  (no PHI).
- Channels: only `in_app` so far. Push/SMS (P2-12), email (P3-19), live socket delivery (P2-02) and per-user
  preferences (P4-07) build on the same rows.

### D-033 — Demo seed data (P1-17)
2026-09-27 · Claude Code
- `npm run db:seed -w @alora/api` (after build) wipes and rebuilds **one** demo agency (fixed id
  `00000000-0000-4000-8000-00000000d3a0`, "Demo Home Health (FAKE DATA)", timezone America/Chicago). Other agencies
  are never touched. **Refuses to run when `APP_ENV=production`.**
- Contents: a login per built-in role except portal_user (`<role>@demo.alora.test`, field roles as
  `rn@`, `lpn@`, `pt@`, `ot@`, `slp@`, `msw@`, `hha@`), 15 caregivers with credentials (one expired, some expiring)
  and weekday availability, 5 physicians (check-digit-valid invented NPIs), 30 patients (27 active) with diagnoses and
  allergies, ~2 weeks of weekday visits with no double-booking, 4 recurring aide series, 3 unassigned visits.
- All data is invented; demo SSNs start with 9 (never issued), phones are 555 numbers, emails use `.test`.
- Shared password `Demo-Password-1!` (override with `DEMO_PASSWORD`). Development only — the demo agency must never
  exist in production (it can't be seeded there).
- Deterministic (fixed-seed PRNG) so screenshots and bug reports are reproducible. Visits are inserted directly with a
  slot plan that avoids double-booking (a test checks); recurring series use `recurrenceDates` like the real feature.
- The seed e2e test re-seeds the dev database's demo agency on every run (~40 s against Neon).

### D-034 — Web dashboard foundations (P1-18)
2026-09-27 · Claude Code
- **Next.js 16** (App Router, Turbopack, React 19), Tailwind 4, TanStack Query. Next 16 changed a lot — read
  `apps/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next code (async
  `params`/`cookies`/`headers`, `middleware` → `proxy`, no `next lint`, generated `LayoutProps`/`PageProps` types via
  `next typegen`). UI primitives are small hand-written Tailwind components (`components/ui`), not the shadcn CLI.
- **Session model — no BFF, the browser talks to the API directly** (so audit IPs and rate limits see the real client):
  - access token only in memory (`lib/auth/session.ts`), never in localStorage/sessionStorage/cookies;
  - refresh token in an **httpOnly, SameSite=Strict cookie set by the API**, scoped to `/api/v1/auth`, used only with
    the `X-Auth-Transport: cookie` header (CSRF defence: a custom header forces a CORS preflight, and CORS allows exact
    origins only). Mobile keeps body tokens. Cookie `Secure` everywhere except development/test.
  - renewal a minute before expiry **only if the user was active**, single-flight, and serialised across tabs with the
    **Web Locks API** (two tabs renewing with the same cookie would look like theft and sign the user out everywhere);
  - **HIPAA auto-logoff**: 15 min without keyboard/mouse/touch → logout; warning banner in the last minute.
  - Every logout is a **full page load**, wiping in-memory caches (React Query may hold PHI).
- In production the dashboard and API must be **same-site** (e.g. `app.agency.com` + `api.agency.com`) for the
  SameSite=Strict cookie to be sent; `CORS_ORIGINS` must list the dashboard origin exactly.
- **Rate limits changed** after the browser tests exposed a real problem: an office behind one IP reloading pages would
  hit 10 refreshes/min and be signed out. Now: refresh = global limit only (its token is unguessable); login and 2FA
  verify = 30/min/IP (account lockout stops guessing); account-settings actions = 10/min/IP.
- Security headers via `next.config.ts` (DENY framing, nosniff, no-referrer, HSTS, `Cache-Control: no-store`,
  no `X-Powered-By`). A nonce-based CSP is part of the security pass (P4-09).
- Browser tests: Playwright (`apps/web/e2e`, `npm run test:e2e -w @alora/web`) against a running API + dashboard with
  the demo seed. Run locally for now; wired into CI in P1-22. Dashboard "today" uses the browser's timezone until the
  API exposes the agency timezone.

### D-035 — Patient screens and timezone fixes (P1-19)
2026-09-28 · Claude Code
- Web patients: list (search, status, paging), detail (demographics, SSN last 4, insurance, diagnoses, allergies),
  shared admit/edit form, discharge/readmit. The API's validation messages are shown as-is (one source of rules);
  on edit, clearing a field sends `null`; the SSN is only sent when a new one is typed (placeholder shows last 4).
- Response types for the web live in `apps/web/src/lib/types/*` and are kept in sync with the API by hand until
  response schemas are generated from OpenAPI (add `@ApiOkResponse` DTOs, then generate types — P1-22 or later).
- Search terms stay in component state, never in the browser URL/history. The API still receives them as a query
  parameter (`GET /patients?search=`), so **production proxies/load balancers must not log query strings** (P4-10).
- **Timezone bug found by the browser tests** (after midnight in UTC+1): the web offered the local date, the API
  rejected it as "in the future" (UTC). Fixes: `IsDateOnly({ notInFuture })` now allows up to the latest calendar
  date on Earth (UTC+14); `/auth/me` returns `agencyTimezone`, and the web's `useAgencyToday()` uses it instead of
  the browser clock.
- Browser tests re-seed the demo agency first (`e2e/global-setup.ts`, `SKIP_SEED=1` to skip) so counts are known.

### D-036 — Agency clock; staff/users/physicians screens (P1-20)
2026-09-28 · Claude Code
- **All business "today" values come from `AgencyClockService`** (agency timezone, cached per agency): default
  admission/discharge/readmission dates, employment end, credential expiry state and the expiring list — joining
  scheduling, which already did this. The UTC helper is now `utcTodayString()` and is for tests only. Found by the
  browser tests: a Chicago agency admitted a patient "on the 28th" (UTC default) and couldn't discharge them on the
  agency's 27th.
- New API: `GET /roles` (users:read — built-in + own custom roles, with permissions) and `GET /staff/candidates`
  (staff:create — active users without a staff profile, so office staff can create profiles without users:read).
- Web: Users (list/filters, add with role picker that disables roles you can't grant, user page with role editor,
  deactivate/reactivate/unlock/reset 2FA, activity), Staff (list/filters, add from candidates, profile with pay only
  for payroll/self, edit, end employment, credentials with state badges + verify, weekly availability editor, time off
  request/approve/deny/cancel, credentials-needing-attention page), Physicians (list, add, edit with live NPI check,
  (de)activate).
- React pattern: don't copy server data into state in an effect (lint rule); use a child component keyed by the
  server value (see `RoleEditor`, `AvailabilityForm`).

### D-037 — Scheduling screens (P1-21)
2026-09-28 · Claude Code
- `/schedule`: Monday–Sunday week grid from `GET /schedule/calendar` (agency "today" highlighted), caregiver filter and
  "only unassigned" for `visits:read_all` holders; caregivers automatically see only their own visits. While the next
  week loads, the old week stays dimmed and the count says "loading…" (showing the previous week's count under the new
  dates was a real bug the browser tests caught).
- `/schedule/new`: patient type-ahead, caregiver, type, date/time; **live conflict check** (`GET /schedule/conflicts`,
  debounced) shows blocking (red) and warnings (amber); booking is disabled while blocked unless a `visits:approve`
  holder ticks "Book anyway" (sent as `override`, audited by the API). "Repeat every week" books a recurring series and
  shows the generation report, including skipped dates and why.
- `/schedule/visits/:id`: details, reschedule/reassign (409 conflicts shown with the same list + override for
  supervisors), cancel with a reason. Only `scheduled` visits are editable.
- Browser tests use times inside the demo caregivers' stated hours (08:00–17:00) — outside them the app rightly warns.

### D-038 — EVV: GPS clock-in/out, flags, verification, corrections (P2-01)
2026-09-28 · Claude Code
- **Flag, never block.** Care that happened must be recorded, so being far from the home, off-schedule, or a very
  short visit never refuses a clock event; it adds a flag (`EVV_FLAGS` in `@alora/shared`) and the record ends as
  `exception` instead of `completed` for a supervisor. Refused outright only when it can't be right: not your visit
  (404, not 403 — don't confirm it exists), visit not `scheduled`, already clocked into another visit, device time
  in the future (>5 min) or more than 72 h old (offline sync limit), or more than 12 h from the scheduled window
  (wrong visit). Thresholds live in `EVV_RULES`.
- **Time window** uses the agency timezone (`zonedTimeToUtc`, DST-safe): clock-in flagged before start−2 h or after
  the scheduled end; clock-out flagged after end+2 h; `very_short_visit` under 25% of the scheduled length.
- **Geofence**: haversine distance from `patients.latitude/longitude` vs `geo_fence_radius_meters` (default 200 m).
  Patients get coordinates entered by hand for now (fields on the patient form); address geocoding needs a Google
  Maps key (owner). No coordinates → `no_patient_location` flag. Accuracy is stored for context, not used.
- **Six Cures Act data points**: service type (`service_type`), individual receiving (`patient_id`), date
  (`service_date`), location (GPS + distance), provider (`staff_id`), begin/end times.
- **Races**: clock-in is a guarded `scheduled → in_progress` update plus a unique `visit_id`; clock-out and reviews
  are guarded updates on the expected status — two devices can't both win.
- **Clock routes** use `visits:read` (every field role has it) plus the own-visit check; audited as
  `EVV_CLOCK_IN/OUT` with the EVV record id.
- **Review** (`evv:approve`): verify or reject (note required) only `completed`/`exception` records, not your own
  visit, and not while a correction is pending.
- **No direct edits** (DESIGN's `PATCH /evv/records/:id` is not built). Every time change is an exception
  (`POST /evv/records/:id/exception`, `evv:update`, reason required) decided by **someone else** (`evv:approve`).
  Approving applies the time to the record and visit, adds `manual_correction`, and leaves the record `exception` so
  it's verified with that in view (states count manual edits). A clock-out correction closes a forgotten visit
  (method `manual`). The requester gets an `evv_correction_decided` notification. Caregivers can't file corrections
  themselves yet — the mobile app (P2-07) may add a caregiver "request" later.
- Deferred: live monitor (`/evv/live`, P2-02/P2-03), telephony/IVR (P2-13), aggregator export (Phase 3), signatures
  (P2-08).

### D-039 — Visit documentation: notes, vitals, tasks (P2-04)
2026-09-28 · Claude Code
- Routes under `/schedule/visits/:visitId/{notes,vitals,tasks}` (DESIGN §6.5) in a separate `visit-docs` module.
  **Reading** follows visit access (D-030: `visits:read_all` or your own visit). **Writing** notes, vitals and task
  results is only for the visit's own caregiver, and only once the visit is `in_progress` or `completed` (clock in
  first). Others get 403 (supervisors) or 404 (a visit they can't see).
- **Notes**: `draft` → `signed` (`/sign`, needs `visit_notes:sign` — clinicians) or `submitted` (`/submit` — aides,
  who by design don't sign). Both lock the note; only the author edits/discards a draft; an empty note can't be
  finalised. Changes after locking are **addenda**: a new note with `noteType: 'addendum'` and `amendsNoteId`.
  Added columns beyond the design: `author_id` (the user; `staff_id` is kept too), `amends_note_id`, `submitted_at`.
  `form_data` holds discipline form answers as-is; QA review columns exist for the Phase 3 QA engine.
- **Vitals** are append-only. Plausibility ranges (e.g. HR 20–250, SpO₂ 50–100, temp 85–115 °F / 29–46 °C), BP needs
  both numbers with diastolic < systolic, at least one measurement, `recordedAt` ≤ now+5 min and ≤ 72 h old (offline
  sync). A wrong entry is marked **entered in error** with a reason (by its recorder or a `visits:read_all` holder) and
  stays visible. Abnormal-value alerts are left to clinical configuration later.
- **Tasks**: the office (`visits:update`) adds/removes checklist items on `scheduled`/`in_progress` visits; the
  caregiver (`visit_notes:update`, which aides have — the design's `update:visits` would exclude them) marks each
  done, not done with a reason ("Patient declined"), or back to open. A task the caregiver recorded can't be removed.
  The demo seed gives every assigned aide visit a 5-item checklist. Care-plan-driven tasks come with care plans (Phase 3).

### D-040 — Open shifts and shift swaps (P2-05)
2026-09-28 · Claude Code
- An **open shift always wraps an existing visit** (`open_shifts.visit_id`); date, time, type and patient live on the
  visit, so the design's copied columns (`patient_id`, `visit_type`, times, `required_discipline`) are dropped —
  eligible disciplines come from `VISIT_TYPE_DISCIPLINES`. Required skills wait until staff have skills. Statuses:
  `open | filled | cancelled`; expiry is computed (`expired: true`), not a status. At most one open offer per visit
  and one pending swap per visit (partial unique indexes; the schema text uses Postgres' normalised
  `((status)::text = 'open'::text)` form so the drift check stays clean).
- **Create** (`visits:create`) from a scheduled visit that hasn't started; if a caregiver is on it (call-out), they are
  taken off and notified in the same step. **Broadcast** (`notifications:create`) notifies active caregivers of a
  fitting discipline who have no blocking conflict — the text has date/time/visit type only, no patient or place.
- **Claim** (any field role, `visits:read` + own staff profile): first come, first served. Refused for the wrong
  discipline (403), blocking conflicts or expired credentials (409 `SCHEDULE_CONFLICT`, no self-override), expired
  offers, or a visit that has started. The fill is a guarded update on both the offer and the visit — two claims at
  once: exactly one wins (tested). The offer's creator is notified.
- **Assign** (`visits:assign`) uses the normal conflict rules and override (`VisitsService.checkOrThrow`, now public).
- **Privacy**: before claiming, caregivers see area (city, ZIP) and time, not the patient's name; schedulers
  (`visits:read_all`) see the patient. After claiming, the visit gives normal access.
- **Swaps**: a caregiver asks to hand off their own upcoming visit, to a named active colleague or back to the pool,
  with a reason. A `visits:approve` holder (not the requester) approves or denies; approval re-checks the colleague's
  schedule (override allowed) and moves the visit, or — with no colleague — unassigns it and creates an open shift.
  The requester can withdraw a pending request. The named colleague isn't asked to accept first (the office already
  assigns visits directly); they're notified on approval.
- **Consistency**: directly reassigning a visit fills its open shift; cancelling it cancels the offer; either
  withdraws pending swap requests.
- Broadcasting runs the conflict check once per candidate — fine for agency-sized staff lists; batch it if it gets slow.

### D-041 — Real-time (Socket.IO) and background jobs (P2-02)
2026-09-28 · Claude Code
- **Socket.IO** on the API server at path `/api/v1/socket.io` (one proxy rule for REST + sockets), same exact-origin
  CORS as REST, websocket or polling. Namespaces:
  - `/notifications` — any signed-in user; room `user:{id}`; event `notification:new` (the inbox record, PHI-free).
    The design's `/shifts` namespace is folded into this: shift assigned/changed/cancelled, open shifts and swap
    decisions are already notifications, so mobile gets them live without a second channel.
  - `/live-monitor` — needs `evv:read`; room `agency:{id}`; events `visit:clock-in`, `visit:clock-out`,
    `visit:geofence-violation`, `visit:late`, `visit:noshow`, `visit:missed`. Payloads include staff/patient names
    (supervisors only, over an authenticated connection). The design's `dashboard:update` is replaced by
    `GET /evv/live`: clients refetch the snapshot after any event (simpler, never out of sync).
  - `/messages` comes with messaging (P3-13).
- **Auth**: access token in the handshake `auth.token` (never the query string — it gets logged), checked by
  namespace middleware *before* the connection is accepted (refused → `connect_error` "unauthorized"/"forbidden").
  Active user required. The server disconnects the socket when the token expires; clients reconnect with a fresh
  token. Emitting never throws — the database is the source of truth.
- Single instance for now. Several API instances need the Socket.IO Redis adapter (Upstash) — P4 deployment task.
- **Jobs** (`@nestjs/schedule`, in-process; BullMQ comes with the notification queue, P2-12), off when
  `JOBS_ENABLED=false` (the API e2e tests do this; tests call the jobs directly):
  - **Visit monitor**, every minute, over scheduled visits from 7 days back to tomorrow, in each agency's timezone:
    +15 min without clock-in → `visit:late` + an in-app nudge to the caregiver; +30 min → `visit:noshow` + a
    `missed_visit` notification to the caregiver and everyone with `evv:approve`; **scheduled end + 2 h** → visit
    becomes `missed` (reason "No clock-in" / "No caregiver assigned"), its open shift and pending swaps are cancelled.
    Not at 30 min: a late caregiver can still clock in until then. Each step is a guarded update on new columns
    `visits.late_alerted_at` / `no_show_alerted_at` / status, so it fires once even with several instances.
  - **Recurring extension**, daily 08:15 UTC: every active series booked 28 days ahead (idempotent, D-031).
- **`GET /evv/live`** (`evv:read`, audited): agency-today snapshot — active visits with clock-in point and home point
  (for the map), late/no-show list, today's unassigned visits, counts (scheduled, in progress, completed, missed,
  late, no-show, unassigned, EVV records needing review).
- socket.io is pinned to the exact version `@nestjs/platform-socket.io` ships (4.8.3) so there's one copy and the
  types line up.

### D-042 — Web: live monitor, EVV review, visit documentation, open shifts, live notifications (P2-03)
2026-09-28 · Claude Code
- **`/monitor`** (`evv:read`): today's counts, a map of active visits (patient home vs clock-in point, red when
  outside the geofence), late/no-show and unassigned lists, and a live feed. Socket events only trigger a refetch of
  `GET /evv/live`; it also refetches every minute because lateness grows with the clock, not with events.
- **Map**: Leaflet + react-leaflet with **OpenStreetMap tiles** (no key needed; loaded client-only). Circle markers,
  so no icon assets. OSM's public tiles are fine for development and small use; production needs a tile provider
  (or Google Maps if the owner provides a key) — noted for P4. Patient coordinates are sent to the tile server only as
  map tile requests (areas), never with names.
- **`/evv`** list (default: needing review) and **`/evv/:id`**: what the device captured, flags in plain words,
  verify/reject (note required to reject; disabled while corrections are pending), and time corrections (request;
  approve/deny by someone else — the UI hides the buttons for the requester). `datetime-local` is interpreted in the
  browser's timezone (the office works in the agency's zone).
- **Visit page**: EVV summary (supervisors), task checklist (office adds/removes open tasks), vitals (entered-in-error
  shown struck through) and notes, read-only — caregivers write them in the mobile app. "Offer as an open shift"
  (with call-out confirmation) creates the offer and broadcasts it.
- **`/schedule/open-shifts`** (link from the schedule for `visits:read_all`): offers by status with notify again /
  assign (caregivers of a fitting discipline; conflicts shown with override for `visits:approve`) / withdraw; pending
  swap requests with approve (and approve anyway on conflicts) / deny.
- **Notification bell** in the header for everyone: unread count, latest ten, mark all read; live via the
  `/notifications` socket (`useLiveSocket` in `lib/realtime.ts` reads the current access token at each connect and
  reconnects after the server closes the socket at token expiry).
- Demo seed adds EVV history (verified, completed, two flagged records) and, in daytime, one visit in progress.
- Browser tests run with **one worker**: they share the demo agency, and parallel dev-server compiles exhausted the
  owner's laptop. 17 browser tests.
- The API's open-shift broadcast now checks candidates in parallel batches of 5 (it was sequential and slow).

### D-044 — Owner answers: 2FA roles, multi-agency, Virginia, portal (2026-09-28)
2026-09-28 · Claude Code (owner's answers)
- **Q-008 → mandatory 2FA for admins only**: `agency_admin` and `super_admin`. Everyone else may turn it on.
  Implemented in P1-11c (D-045).
- **Q-003 → multi-agency SaaS.** Keep everything agency-scoped (already the rule). Consequences, to plan in Phase 4:
  agency onboarding (create agency + first admin), `super_admin` cross-agency tooling, per-agency settings and
  billing, and tenant isolation tests. Never add a feature that reads across agencies except for `super_admin`.
- **Q-005 → Virginia first.** Virginia Medicaid (DMAS) requires EVV for personal care and home health; which
  aggregator/vendor and data format apply must be researched from DMAS's current guidance before P4-04 — don't
  assume Sandata or HHAeXchange. Billing rules (Virginia Medicaid + its managed-care plans) follow in Phase 3.
- **Q-006 → deferred** by the owner; development continues on Neon/Upstash. Production must still be HIPAA-eligible
  with a BAA — ask again before P4-10.
- **Q-002 → build the patient portal ourselves, in this repo, instead of on Base44.** The owner asked for the
  unsafe design to be fixed. Building it here removes both problems: sessions are per patient (the same secure
  sign-in as the dashboard, `portal_user` role, API guard limiting them to their own record — P3-14), and PHI no
  longer passes through a third party (no Base44 BAA needed). P3-16 changes from `base44` to `agent`;
  `docs/base44-portal/` becomes obsolete once the portal exists. Portal screens live in the web app under their own
  layout; portal users can't reach staff pages and vice versa.
- **Google Maps key**: the owner will provide it later; until then patient map points are entered by hand and the map
  uses OpenStreetMap (D-042).

### D-045 — Mandatory 2FA for admins (P1-11c)
2026-09-28 · Claude Code
- Roles `agency_admin` and `super_admin` (`MANDATORY_TWO_FACTOR_ROLES` in `@alora/shared`) must use 2FA.
- An admin without 2FA can still sign in (they need a session to set it up), but tokens are issued with a
  setup-only claim: every route answers **403 `TWO_FACTOR_SETUP_REQUIRED`** except those marked
  `@AllowDuringTwoFactorSetup()` — `/auth/me`, `/auth/2fa/setup`, `/auth/2fa/enable`, `/auth/change-password`
  (plus the public refresh/logout). Sockets are refused too. Login/refresh responses carry `mustEnable2fa`;
  `/auth/me` carries `is2faRequired`.
- The claim is computed from the database whenever tokens are issued, so after enabling 2FA the client refreshes and
  the restriction is gone; if an admin's 2FA is reset, the next token is restricted again. Admins can't turn 2FA off.
- Web: login sends such admins to **`/setup-two-factor`** (QR code drawn in the browser from the otpauth URI — the
  secret never goes to a third party — the key as text, code confirmation, backup codes), and the app shell redirects
  there too. Any user may open the page to turn 2FA on voluntarily.
- Demo data: the demo admins have 2FA on with the published demo key `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` (fake data;
  the seed refuses production). Tests: API suites sign admins in through `test/login-helper.ts`, which performs the
  real setup; browser tests compute codes from the demo key (`e2e/two-factor.ts`) and wait for the next code when a
  second sign-in in the same 30 s is refused as a replay.

### D-043 — Caregiver app foundation (P2-06)
2026-09-28 · Claude Code
- `apps/mobile`: **Expo SDK 57**, React Native 0.86, Expo Router (routes in `src/app`), TypeScript. Expo's Metro config
  handles the monorepo automatically (no custom metro.config.js). **One React for the whole repo** (19.2.8, root
  `overrides`; React Native accepts ^19.2.3) — duplicate React in one app breaks at runtime. Verified by bundling
  (`npx expo export --platform android`, 1,275 modules). `ios/`/`android/` are generated (never committed).
- **Session** (`src/lib/session.ts`, unit-tested): body tokens (never cookies); access token in memory; refresh
  token in the Keychain/Keystore with `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` — a phone without a passcode can't store
  it, so the session lives in memory only and the caregiver signs in with the password next launch. Renewal is
  single-flight; being offline never discards the session, the API refusing it does.
- **Lock instead of a custom PIN**: after 5 minutes in the background, and on every relaunch, the app locks (access
  token dropped, nothing shown) and unlocks with Face ID / fingerprint / the phone's own passcode
  (expo-local-authentication). Stronger than a 4-digit app PIN and nothing extra to remember. Server-side the
  30-minute idle refresh limit still applies.
- Accounts with 2FA enter the code at sign-in. Admins who still must set up 2FA are told to do it on the web (the app
  doesn't do 2FA setup). Forced password change works in the app.
- Screens so far: sign-in, unlock, change password, today's visits. Clock-in/out, visit detail (P2-07),
  documentation (P2-08), offline queue (P2-09) and background location (P2-10) build on this.
- Checks: `typecheck` (tsc), `lint` (oxlint), `test` (vitest on plain-TS logic) run in turbo/CI like the other apps.
- Audit: 3 moderate findings from `decode-uri-component` (via expo-router → query-string 7); the fixed version is
  ESM-only and can't be forced safely. Risk: slow parsing of a malformed deep link on the user's own phone. Revisit
  on the next Expo update. `uuid` for Expo's `xcode` tool is overridden to ^11.1.1.

### D-046 — Mobile clock-in/out (P2-07)
2026-09-28 · Claude Code
- Today's list opens a **visit screen**: patient, time, status, address with **Directions** (opens Apple/Google Maps
  with the address) and **Call**, and **Clock in** / **Clock out** depending on the visit status.
- Location: foreground permission only, asked the first time the caregiver clocks in, with a plain explanation (the
  location is recorded only at clock-in/out). A last-known fix is reused if under 2 minutes old, otherwise a fresh
  high-accuracy fix. The **timestamp is when the button was pressed**, not when the fix was taken. Denied permission
  → the caregiver is told EVV needs it (telephony EVV, P2-13, is the fallback later).
- After clocking, the API's flags are shown in plain words ("Recorded. The office will review: …") — never as an error,
  because flags don't block (D-038).
- Offline clocking (queue + sync within 72 h) comes with P2-09; until then an offline clock-in shows the connection error.
- Logic in `src/lib/evv.ts` is unit-tested (payload, freshness, messages, directions URL).

### D-047 — Mobile visit documentation (P2-08)
2026-09-28 · Claude Code
- From the visit screen (in progress or completed): **Tasks** (done / not done with a reason / tap again to undo),
  **Vitals** (checked on the phone with the API's ranges — `src/lib/vitals.ts`, unit-tested — earlier readings listed,
  entered-in-error ones struck through), **Visit note** (aides: "what you did", *Submit*; clinicians with
  `visit_notes:sign`: SOAP + narrative, *Sign*; a draft can be saved; a finalised note is locked and corrections are
  addenda).
- **Patient signatures are deferred**: storing a signature image needs file storage (S3 + a BAA), which doesn't exist
  yet. The EVV record has the columns (`patient_signature_url`); add capture when documents/S3 land (Phase 3), and
  record the decision then. States' EVV rules (Virginia) don't require a patient signature for GPS EVV.
- AGENTS.md updated: the portal is in this repo (D-044); how to add Expo native modules and verify bundling.

### D-048 — Mobile offline queue and read cache (P2-09)
2026-09-28 · Claude Code
- **What works offline**: clock in/out (GPS works without signal; the timestamp is the button press, and the API
  accepts it up to 72 h later — D-038), task updates, vitals (`recordedAt` = when taken), and notes. They're saved on
  the phone and sent **in the order they happened** (`src/lib/offline-queue.ts`, unit-tested).
- **Order rule**: if anything is already waiting, new work joins the queue instead of going straight to the API — so a
  note never arrives before the clock-in it depends on. Sending happens when the app comes to the foreground, every
  30 s while something waits, and after each new item. One send at a time.
- **Failures**: offline, 5xx, 429 and 401 (session needs renewing) → keep and retry. Any other 4xx → set aside with the
  API's message, shown to the caregiver ("wasn't accepted — please tell the office") until dismissed; never retried.
- **Screens reflect pending work**: a pending clock-in shows the visit as in progress (so nobody clocks in twice),
  task changes show immediately, and editing a note pauses while that visit's note is waiting (prevents duplicates).
- **Read cache**: today's list, visit, patient, tasks, vitals and notes fall back to the last copy saved on the
  phone when offline, with an "Offline — showing what was saved" banner.
- **Encryption (PHI on the device)**: queue + cache live in one SQLite database encrypted with **SQLCipher**
  (`expo-sqlite` plugin `useSQLCipher: true`), key = 32 random bytes in the keychain (this device only, never
  backed up). **Expo Go can't do SQLCipher** — it ignores the key, so Expo Go must only be used with the fake demo
  data; real builds (EAS/dev builds) are encrypted.
- **Sign-out wipes** the queue and cache; if unsent work exists the caregiver is warned first.
- Not yet: a background sync task while the app is closed (the next foreground sends it), conflict merging beyond
  "the API decides".

### D-049 — No background location tracking; clock-out reminders instead (P2-10)
2026-09-28 · Claude Code (conservative default — owner may overrule, see OPEN_QUESTIONS Q-009)
- **The app does not track caregivers' location in the background.** EVV (21st Century Cures Act; Virginia DMAS)
  needs the location at the start and end of the visit, which clock-in/out already capture. Continuous tracking
  would need "Always" location permission (app-store scrutiny, many caregivers refuse it), drains batteries, and
  collects far more location data than required — minimum necessary.
- Instead, the most common real EVV problem — **forgetting to clock out** — gets a **local reminder on the phone**
  15 minutes after the scheduled end (agency timezone; 30 minutes after clock-in if the visit already ran over),
  set at clock-in and cancelled at clock-out, even offline (queued clock events). Text has no patient details
  (lock screens are visible). Notification permission is asked at the first clock-in; refusing it changes nothing
  else. Sign-out cancels all reminders. `expo-notifications`, local only — push comes with P2-12 (Firebase).
- If the owner wants mid-visit location checks, the cheaper middle ground is a single location ping at the scheduled
  end, not continuous tracking.

### D-050 — Payers, service codes, rates, authorizations (P3-01)
2026-09-28 · Claude Code
- **Service codes** (`service_codes`: HCPCS/CPT/revenue, unit visit|hour|15-min|day, default rate, needs-authorization)
  unique per agency; **payer rates** (`payer_rates`) per payer + code (+ modifiers) over date ranges that **never
  overlap** — 409 names the open rate to end first. Rates are ended, never edited (claims keep the rate they were
  billed at). `BillingSetupService.rateOn(payer, code, date, modifier)` answers "the rate on a date" for claims.
- **Authorizations** keep the design's table but **usage is computed from the visits linked to them** (completed/in
  progress = used, with actual times when known; scheduled = booked). The design's `used_visits/used_hours`
  counters are left unused (they would drift). States: active, upcoming, expired, exhausted, cancelled; "ends soon"
  within 14 days. Either visits, hours, or both.
- **Linking**: booking or changing a visit with a service code links it to the matching authorization (active,
  covering the date, same code or "any service", soonest-ending with room first); recurring generation does the same.
  Cancelling an authorization releases its booked visits (history of done visits stays).
- **Scheduling warnings** (not blocks — the office may be awaiting a renewal): `authorization_missing` when the
  patient's primary payer or the service code requires authorization and none covers the visit;
  `authorization_exhausted` when the visit goes past the authorized visits/hours.
- **Permissions**: new `authorizations:read|manage` (office, billing, supervisor; admins). Payers and service codes are
  readable with `authorizations:read` (to pick them) and changed with `billing:update`; rates (money) need
  `billing:read`/`billing:update`. The design's "admin" for payers became billing staff — they maintain payer setup.
- Web: **Billing setup** page (payers, codes, rates with "end it"), **Authorizations** panel on the patient page.
  Demo data: fake Medicaid (requires authorization), Medicare and private pay; G0156/G0299/G0151/T1019 with rates;
  all patients on demo Medicaid; authorizations for the recurring aide patients (visits linked) and one ending soon.
- Virginia specifics (DMAS/MCO rules, which codes and modifiers) are still to be confirmed against current DMAS
  guidance before real billing (D-044).

### D-051 — Pre-billing QA per visit (P3-02)
2026-09-28 · Claude Code
- QA runs **per completed visit**, before any claim exists (the design runs it on claims; claims in P3-03 reuse the same
  rules). `billing-readiness.ts` is a pure function (unit-tested); the service gathers facts in a few batched queries.
- Checks (error = can't bill, warning = can, but look): visit completed; **EVV verified** (missing/exception/rejected
  explained); a **signed or submitted note**; an active service code; an active primary payer; the **member ID** that
  payer type needs (Medicaid ID, Medicare MBI, or insurance member ID); a primary diagnosis; the **authorization**
  (when the payer or code needs one: linked, not cancelled, covers the date, and within limits — the first N completed
  visits/hours in service order are covered, later ones are over); a **rate** (payer rate, else the code's default with
  a warning); the **agency NPI**; **timely filing** (warning within 30 days of the payer's limit, error after).
- **Units**: 15-minute units round at 8 minutes (the common Medicaid/Medicare convention — **confirm against the
  Virginia DMAS provider manual** before real billing); hours round to the quarter hour; visit/day = 1. Minutes come
  from EVV actual times, else the schedule. Amount = units × rate.
- `GET /billing/ready-to-bill` (billing:read, audited): visits with checks, units, rate, amount; filters (dates ≤ 92
  days, payer, ready/blocked) and a summary (ready count and amount, blockers by check). Web page **Ready to bill**.
- Demo data: agency NPI, patients' fake Medicaid IDs, authorizations and submitted notes for the EVV-history visits, so
  some are ready and the flagged ones show why not.

### D-052 — Claims from ready visits (P3-03)
2026-09-28 · Claude Code
- `POST /billing/claims` (`billing:create`) takes a date range (optionally a payer) or specific visits, re-runs
  pre-billing QA (D-051) and makes **one claim per patient + payer** with **one line per visit**. Visits that aren't
  ready come back in `skipped` with their reasons.
- A claim is a **snapshot**: member ID (by payer type), ICD-10 codes (primary first, max 12), each line's code, units,
  unit rate and charge are copied at creation; later rate or record changes don't alter it.
- **No double billing**: `claim_lines.active` + a partial unique index (one active line per visit) — two people billing
  the same visit at once: exactly one claim gets it (tested). Pre-billing QA now fails already-billed visits
  ("Already billed on claim …").
- Claim numbers: 12 characters, date + random base-32 (fits X12 CLM01's 20), unique per agency, regenerated on the
  rare collision. Claim type 837P, except Medicare → 837I (Medicare home health institutional billing — OASIS/HIPPS
  — isn't built; Virginia Medicaid personal care is professional).
- Statuses now used: `ready` (QA passed), `draft` (QA re-check failed, with `qa_errors`), `void`. `POST .../qa`
  re-checks; `POST .../void` (`billing:void`, reason required) only before sending — voiding releases the visits for
  re-billing. Voiding/replacing a claim already sent (frequency 8/7) comes with submission (P3-09).
- Web: **Create claims for ready visits** on Ready to bill, **Claims** list and claim page (lines, QA problems,
  re-check, void).

### D-053 — EDI 837P generator, claim file preview, agency settings (P3-04)
2026-09-28 · Claude Code
- **Generator** (`billing/edi/edi-837p.ts`, ASC X12 005010X222A1) is pure: input object → text. Separators `*` `:`
  `^` `~`, one segment per line. Loops: ISA/GS/ST, BHT, 1000A submitter + PER, 1000B receiver, 2000A/2010AA billing
  provider (agency: NPI `XX`, N3/N4 with **ZIP+4**, `REF*EI` EIN), 2000B/2010BA subscriber = patient (SBR09 filing
  indicator by payer type: Medicaid/MCO `MC`, Medicare `MB`, commercial `CI`, VA `VA`; member ID `MI`; DMG), 2010BB
  payer (`PI`), 2300 `CLM` (place of service 12 home, qualifier B, frequency code; Y/A/Y/Y), `REF*G1` prior
  authorization, `HI` ABK/ABF (ICD-10 without the dot), 2400 `LX`/`SV1` (HC:code:modifiers, charge, UN units,
  diagnosis pointer 1)/`DTP*472`. No 2000C (patient is the subscriber for Medicaid/Medicare).
- **Values are sanitised** to the X12 basic character set (upper-case, accents removed, separators replaced).
- **Golden-file test**: fixed FAKE input → `__fixtures__/837p-basic.edi`, reviewed segment by segment. Re-generate only
  after review with `UPDATE_GOLDEN=1 npx vitest run src/modules/billing/edi`. Plus SE count, ISA width, control
  numbers, and validation tests.
- `validate837` lists everything payers reject before building (NPI, 9-digit EIN, address, ZIP+4, submitter/receiver
  IDs, payer ID, member ID, DOB, diagnoses, ≤50 lines, ≤12 diagnoses, private pay not e-billed).
- `GET /billing/claims/:id/837` returns a **preview** — test indicator `T`, control number 1 — never a production
  interchange; 422 `EDI_INCOMPLETE` with the list otherwise. Real control numbers, file storage, clearinghouse
  submission and 999/277 acknowledgments come with P3-08/P3-09. 837I (Medicare home health) is not built.
- **Agency settings** API (`GET/PATCH /agency`, `settings:read|update` — admins): name, NPI (check digit), EIN,
  phone, address; timezone not editable. Payers gain `ediSubmitterId`/`ediReceiverId`. `IsNpi` moved to
  `common/validators`. Web: **Agency settings** page; **Download 837P (preview)** on the claim page.
- Virginia DMAS/MCO companion guides may require extra segments or values — check them with the clearinghouse
  before production (D-044).

### D-054 — 835 remittances and payment posting (P3-06)
2026-09-28 · Claude Code
- **Parser** (`billing/edi/edi-835.ts`, 005010X221A1) is pure and reads separators from ISA (any delimiters, with or
  without line breaks): BPR (amount, method, date), TRN (trace/check number), N1 PR/PE (+REF*2U payer ID, payee NPI),
  CLP (our claim number, status 1/2/3 processed, 4 denied, 22 reversal, charge, paid, patient responsibility, payer
  claim number), NM1*QC, CAS (group + up to six reason/amount/quantity triples, claim or line level), SVC (code,
  modifiers, charge, paid, units), DTM*472, LQ*HE remarks, PLB provider adjustments. Fixture tests.
- **Upload** (`POST /billing/edi-files/upload-835`, JSON `{fileName, content}`, ≤5 MB; global JSON limit raised to
  6 MB): stored in `edi_files` (content in the DB until S3 exists; `content_hash` unique per agency → a file can't be
  loaded twice), one `payments` row, one `payment_details` row per CLP, matched to our claims by claim number
  (unmatched ones listed, never posted). Payer matched by payer ID.
- **Posting** (`POST /billing/payments/:id/post`, once — guarded update): claim `total_paid`, `total_adjustments` (all
  CAS except PR), `patient_responsibility`, payer claim number; lines matched by code + date + first modifier get paid
  and adjustment amounts. Status: CLP02 4 (or nothing paid) → `denied` with the first CARC; 22 reversal →
  `submitted`; else balance ≤ $0.005 → `paid`, otherwise `partially_paid`. Void claims are skipped.
- Web: **Payments** page — load an 835, review per claim, post.
- Not yet: 999/277 acknowledgments, PLB application to balances, patient statements for patient responsibility.

### D-055 — Clinical records: medications, orders, plans of care, assessments (P3-11)
2026-09-28 · Claude Code
- Routes under `/patients/:patientId/{medications,orders,care-plans,assessments}`. **Reading** needs `patients:read`
  and patient access (`PatientsService.assertAccessible` — a caregiver sees their own patients'); **writing** needs the
  clinical permission: new `medications:manage` (supervisor, RN, LPN), `orders:create|update`, `care_plans:create|
  update`, `assessments:create|update|approve`.
- **Nothing clinical is deleted**: medications are *discontinued* (reason + end date; a stopped one can't be edited —
  add it again), orders *cancelled*, plans *superseded* or *ended*, assessments stay.
- **Physician orders**: `pending → sent → signed` (dates kept), cancel before signed; **overdue** when not signed 30
  days after the order date (Medicare needs signed plan-of-care orders before final billing).
- **Plans of care** (CMS-485-style): certification period (≤1 year; Medicare uses 60 days), physician, goals,
  interventions and visit frequency per discipline (e.g. `HHA 3W8`), disciplines derived. Versioned; only drafts are
  editable; **activating** (physician signature date, not in the future, physician required) makes it the one active
  plan and supersedes the previous one. Generating visits from the frequency is a later step.
- **Assessments**: type (OASIS SOC/ROC/recert/transfer/discharge, nursing, Morse fall, Braden, pain, other), the form's
  answers as JSON. **Morse** and **Braden** are scored in `@alora/shared` (`scoreAssessment`, unit-tested; bands:
  Morse <25 low / 25–44 moderate / ≥45 high; Braden ≤9 very high … ≥19 none). Draft → completed by the assessor
  (scored scales must be complete, else 400 `ASSESSMENT_INCOMPLETE` with the missing items) → **approved by someone
  else** (`assessments:approve`). Full OASIS forms/validation are future work.
- Web: clinical section on the patient page (medications, orders, plan of care with physician and activation,
  assessments with approval). Mobile assessment entry comes with the next mobile pass.

### D-056 — Documents: storage, versions, e-signature (P3-12)
2026-09-28 · Claude Code
- **Storage** goes through an abstract `DocumentStorage` (`save`/`load`). The only driver today is
  `DatabaseDocumentStorage`: the file is AES-256-GCM encrypted with the PHI keyring (`PhiCryptoService.encryptBytes`,
  context bound to the document ID so blobs can't be swapped) into `document_blobs`, and `documents.s3_key` holds
  `db:<id>`. When hosting + an S3 BAA exist (Q-006), an S3 driver (SSE-KMS, private bucket) replaces it without API
  changes. Files are **streamed through the API**, not handed out as pre-signed URLs, so every download is permission-
  and patient-checked and audited (`DOWNLOAD_DOCUMENT`). Pre-signed URLs can come with S3 if size requires it.
- **Accepted files**: PDF, PNG, JPEG, DOCX, recognised by their first bytes (a ZIP only counts as DOCX when named
  `.docx`); anything else 415, over 10 MB 413. The stored name is cleaned (no paths, quotes or control characters)
  and the extension set from the real type. SHA-256 of the content is kept and re-checked on every download and
  before signing (mismatch → 409).
- **Access**: `documents:read|create|sign|delete`. A document tied to a patient follows patient access
  (`PatientsService.accessibleWhere`) — outsiders get 404. Aides have no `documents:read` (unchanged role grants).
- **Versions**: uploading with `replacesDocumentId` creates version n+1 (inherits patient/staff/visit links and type);
  `previous_version_id` is unique, so two people replacing the same version at once → one wins, the other 409. Lists
  show the newest version; `GET /documents/:id/versions` gives the chain.
- **E-signature**: the signer types their name; stored with signer ID, time, IP, user agent and the file's SHA-256.
  Only the newest version, once (guarded update). A new version is unsigned. Drawn signatures and signing by
  patients/physicians come with the portal and fax work.
- **Delete** is soft (`deleted_at`, who, reason, `documents:delete`); the record and file are kept for retention.
- Not yet: fax sending (`documents:send`), virus scanning (add with S3, e.g. ClamAV/GuardDuty), mobile upload.

### D-057 — Secure messaging (P3-13)
2026-09-28 · Claude Code
- **Tables**: `conversations` (direct | group, optional subject and patient), `conversation_participants` (joined,
  last read, left, muted), `messages`. Message text is **encrypted** (`content_encrypted`, PHI keyring, context
  `messages.content:<id>` — `messageContentContext`); nothing about content goes in logs, audit rows, socket pushes or
  notifications.
- **Who**: new permission `messages:use`, granted to every built-in staff role (not `portal_user` — the portal gets
  its own endpoints in P3-14 on the same tables). Contacts = active users in the agency with a non-portal role. Only
  participants can see a conversation (others 404). A conversation *about a patient* requires the creator to have
  access to that patient; the people they add see the patient's name (sharing for treatment is the creator's call).
- **Direct** messages: messaging one person without a subject/patient reuses the existing direct thread (a rare race
  can create two; harmless). You can't add people to or leave a direct thread — start a group.
- **Groups**: participants may add people (up to 100); leaving keeps read access to what was said *before* leaving,
  no sending; being added back restores it.
- **Unread** = others' messages after your `last_read_at` (sending or opening marks read). `GET /messages/unread-count`
  drives the sidebar badge.
- **Real-time**: `message:new` `{conversationId, messageId, senderId, isUrgent, createdAt}` on the existing
  `/notifications` socket (user room) — not a separate `/messages` namespace as DESIGN.md §8 sketches; one socket per
  client is enough. Clients refetch the text. Typing indicators: not built.
- **Urgent** messages also create an in-app `message_received` notification ("Urgent message", sender's name only).
  Push/SMS follow when P2-11 providers exist. Messages are never edited or deleted (record retention).
- Attachments: `documentId` of a document the sender can see (uploaded via /documents); the web page doesn't offer
  attaching yet.

### D-058 — Patient & family portal (P3-14, P3-16)
2026-09-28 · Claude Code
- **Accounts**: staff with `patients:update` give access from the patient page: email + name → a `portal_user` account
  with a **temporary password shown once** (three groups of four unambiguous characters, meets the policy) that must be
  changed at first sign-in. One account per family member; linking the same email to another patient of the agency
  reuses it (no new password). An email used by staff or another agency → 409 (without saying which). Reset = new
  temporary password + all sessions revoked. Removing access unlinks; an account with no patients left is deactivated
  and signed out. `patients.portal_user_id` stays one portal account per patient. Invitation emails wait for P2-11.
- **API** (`/portal`, guard: role `portal_user`; staff get 403, and portal users hold no permissions so every staff
  route is 403 for them). Every patient route re-checks `patients.portal_user_id = caller` on each request, so
  removing access takes effect immediately even with a live token. All portal reads are audited (`PORTAL_VIEW_*`).
- **What they see** (deliberately narrow): name, DOB, contact/address, emergency contact, physician; visits 30 days
  back/ahead with caregiver as "First L."; the active plan of care (goals, interventions, visit frequency); active
  medications (no notes); **only documents staff marked `shared_with_patient`** (off by default, set on upload or
  toggled; must be about a patient; new versions inherit it); messages. Never SSN, insurance/Medicaid IDs, clinical
  notes, assessments, EVV locations, staff contact details.
- **Messages**: one `portal` conversation per (patient, portal user). Each family message (re)adds every active user
  holding the new **`messages:portal`** permission (supervisor, office staff, admins) as participants and sends them
  an in-app alert without content; they answer from the normal Messages page, where the thread is labelled
  "Portal · <patient>" with a reminder that the family reads it. Staff can't add portal users to other conversations.
- **Web**: `/portal` has its own layout (patient switcher for families with several patients, phone-friendly menu,
  "not for emergencies" notice); the staff shell sends portal users to `/portal` and the portal sends staff to `/`.
- **Known gap**: the forced password change is enforced by the clients only; the API doesn't yet restrict a session
  still on a temporary password (P4-09). Fixed a login-page race that could skip the forced change entirely.

### D-059 — Private-pay invoices (P3-10)
2026-09-28 · Claude Code
- **Who gets an invoice**: patients whose primary payer is `private_pay`. `POST /billing/invoices {from, to, patientId?}`
  takes their completed, uninvoiced visits in the range (≤ 92 days), runs the same pre-billing checks as claims (D-051:
  EVV verified, note final, service code, rate…), and makes **one invoice per patient**, priced exactly like claim
  lines (payer rate or the code's default rate × units). Skipped visits come back with reasons. Claims now **refuse
  private-pay visits** ("bill it on an invoice"), and a visit on an active invoice counts as billed for claims (and
  vice versa) — `invoice_lines` has the same one-active-line-per-visit unique index as `claim_lines`.
- **Numbers** `INV-000001…` per agency (sequential, retried on a race). Due date = issue date + 30 days
  (`INVOICE_TERMS_DAYS`; an agency setting later). Bill-to = the patient's name and address, frozen on the invoice (a
  separate responsible-party/guarantor is future work). No tax (home care is generally exempt; column kept).
- **Lifecycle**: draft → **sent** (marked by staff — printing/mailing; emailing waits for an email provider) →
  partially_paid → paid. Payments (amount, date, method check/cash/card/ACH/other, reference) only once sent, never
  above the balance, guarded against two people recording at once. **Void** only without payments; releases its visits.
  Overdue = sent, unpaid, past due (computed).
- **PDF** made on request with **pdf-lib** (pure JS), not Puppeteer as DESIGN.md §2 suggested — no headless Chrome to
  install on the owner's laptop, CI or the server. Standard fonts (non-Latin characters are folded or replaced).
- Permissions: `billing:read` (list, detail, PDF), `billing:create`, `billing:send`, `billing:update` (payments),
  `billing:void`. Web: Billing → Invoices (create for a period, list with overdue, detail with PDF, send, pay, void).
- Not yet: showing invoices/balances in the patient portal, card payments online, statements across invoices.

### D-060 — Eligibility verification, X12 270/271 (P3-07)
2026-09-28 · Claude Code
- **270** (`edi/edi-270.ts`, 005010X279A1): one subscriber per request — payer (PI payer ID), agency (XX NPI), subscriber
  (MI member ID from the same rule as claims, `memberIdFor`), DOB/gender, DTP*291 service date, EQ*30 (health benefit
  plan coverage). TRN originator = "1" + EIN (or NPI tail). Usage `T` until the clearinghouse account is live.
- **271** (`edi/edi-271.ts`): separators read from ISA; picks up our trace (TRN*2), payer and subscriber, EB benefits
  (active 1–5 / inactive 6–8, co-insurance A, co-pay B, deductible C with period 29 = remaining, plan name, service
  types, in-network flag, MSG notes), plan dates (DTP 291/346/347/356/357, D8 or RD8) and AAA rejections with readable
  reasons. Fixture-tested (active + rejected).
- **Checks** (`eligibility_checks`): `POST /billing/eligibility {patientId, serviceDate?}` uses the patient's **primary
  payer** (not private pay), refuses with **422 `ELIGIBILITY_INCOMPLETE`** listing what's missing (member ID, DOB, payer
  EDI IDs, agency NPI), stores the 270 text; `GET …/:id/270` downloads it; `POST /billing/eligibility/responses
  {content}` parses a 271 and files it on the check with the **same trace number** (unique per agency) → status
  active / inactive / rejected / unknown with plan, dates, co-pay, co-insurance, deductible(s). Permissions: request
  `billing:read` (as DESIGN.md §6.10), recording answers `billing:update`.
- **Until P3-08** staff send the 270 through the clearinghouse's portal and upload the 271; P3-08 adds a transport that
  sends and polls automatically, using the same records. Batch checks (many subscribers in one 270) come with it.
- CI note (same day): the browser suite now signs in more than 30 times a minute from one IP, which the sign-in limit
  (30/min) rightly refuses. `RATE_LIMITS_DISABLED=true` (env, validated; **refused when APP_ENV=production**) turns the
  throttler off for that CI job only. Production and the API e2e tests keep the limits.

### D-061 — Institutional claims, 837I (P3-05)
2026-09-28 · Claude Code
- **Which claims**: `payers.claim_format` = `837P` | `837I`; empty = **837I for Medicare** (home health is billed on the
  UB-04), 837P for everyone else. Virginia Medicaid skilled home health may need 837I — billing sets it per payer.
- **Generator** (`edi/edi-837i.ts`, 005010X223A2, golden file reviewed): CLM05 = facility 32 : A : frequency from the
  type of bill; statement dates DTP*434; admission DTP*435; CL1 (admission type 9, source 1, patient status);
  REF*G1 prior auth, REF*EA MRN; HI principal ABK / other ABF (≤ 25); value codes HI*BE (61 = CBSA); attending
  physician NM1*71 (the patient's primary physician, NPI required); lines SV2 revenue code + HCPCS + charge + units.
  **Medicare**: HIPPS code on a first 0023 line with zero charge, plus value code 61 — both required by validation.
- **Data**: `service_codes.revenue_code` (UB-04, e.g. 0571 aide, 0551 nursing, 0421 PT; required on every 837I line),
  and on claims `type_of_bill` (default **0329** final), `patient_status` (default 30, or 01 if discharged),
  `hipps_code`, `cbsa_code` — editable while the claim is draft/ready (`PATCH /billing/claims/:id/institutional`).
- **HIPPS is entered by billing staff**: computing it needs the PDGM grouper (OASIS functional scores, comorbidities,
  admission source, timing) — a licensed CMS component we don't have. Our OASIS forms aren't complete enough yet either.
  NOAs (type of bill 032A), 30-day period splitting and LUPA logic are not built. **All 837I output must be validated in
  the clearinghouse's test channel before production (P3-08).**
- Web: claim page shows the institutional fields and downloads "837I (preview)"; billing setup shows revenue codes and
  lets billing pick each payer's claim form.

### D-062 — Compliance: incidents, credential alerts, audit search, HIPAA checklist (P4-05)
2026-09-28 · Claude Code
- **Incidents** (`incident_reports`): type (fall, injury, medication error, abuse/neglect, complaint, property damage,
  infection, privacy breach, other), severity low/moderate/high/critical, date/time, description, actions, follow-up,
  optional patient/staff/visit. **Anyone who witnesses one can report it**: `compliance:create` now goes to every
  clinical role, aides and office staff; reviewing needs `compliance:read` (supervisor, admins). Reporting about a
  patient requires access to that patient. High/critical reports alert `compliance:update` holders in-app (no PHI).
  Status open → investigating → resolved (who/when recorded) → closed (final); reopening clears the resolution.
- **Credential expiry job** (daily 12:30 UTC, `JOBS_ENABLED`): stages *due* (inside the credential's own
  `alert_days_before`), *week* (≤ 7 days), *expired*. Each stage is claimed with a guarded update on
  `staff_credentials.expiry_alert_stage` before notifying the staff member and every `staff:update` holder, so it's
  idempotent across API instances; changing the expiry date clears the stage. Notification texts name the credential
  and staff member (not patient data).
- **Dashboard** (`GET /compliance/dashboard`, `compliance:read`): expired / expiring credentials, open and serious
  incidents, missed visits and EVV awaiting review, physician orders unsigned > 30 days, plans of care ending within
  14 days, assessments awaiting approval, admins without 2FA.
- **Audit log search** (`GET /compliance/audit-logs`, `audit_logs:read` = admins): by user, action, record type, record
  ID and date range; the search itself is audited. **HIPAA checklist** (`GET /compliance/hipaa-checklist`): technical
  safeguards the system can check about itself (2FA coverage, idle timeout, audit activity, encryption key, rate
  limits, HTTPS in production) plus reminders for the agency's own obligations (BAAs, risk assessment, training).
- State EVV rules (`/compliance/evv-state-rules`) wait for P4-04 and the Virginia DMAS research.

### D-063 — Claim follow-up: submission, denials, appeals, corrected claims, AR aging (P4-06)
2026-09-28 · Claude Code
- **Submitted**: until the clearinghouse automation (P3-09), billing downloads the 837, sends it through the
  clearinghouse portal and clicks *Mark as sent* (`POST /billing/claims/:id/submit`, `billing:submit`): ready →
  submitted with who/when. That date starts the aging clock.
- **Denials**: posting an 835 that denies a claim now records `denied_at` and `appeal_deadline` = posting date +
  `payers.appeal_window_days` (default 60; payers vary — Medicare redetermination is 120 days, set it per payer).
- **Appeals** (`claim_appeals`): one open appeal at a time; levels count up (1 redetermination, 2 reconsideration…).
  Filing moves the claim to `appealed`; a decision of *won* returns it to `submitted` (waiting for the corrected
  payment, which arrives as a new 835), *lost*/*withdrawn* back to `denied` (a higher-level appeal can follow).
- **Corrected claim** (`POST …/rebill`, `billing:create`): a new claim with the same visits and amounts, frequency 7
  (institutional: type of bill ending in 7), `original_claim_id`, and the payer's claim number, which the 837P/837I
  now send as REF*F8 (required for frequency 7/8). The original becomes `replaced` and releases its lines.
- **AR aging** (`GET /billing/reports/aging?asOf=`, `billing:read`): outstanding claims (submitted, acknowledged,
  partially paid, denied, appealed) by days since submission (creation if never marked sent), per payer, in buckets
  0–30 / 31–60 / 61–90 / 91–120 / 120+, plus private-pay invoices by days since issue. Balance = charges − paid −
  adjustments − patient responsibility, **except that denial adjustments stay owed while the denial is open**
  (denied, appealed, or won and awaiting payment) — they're only written off when the denial is final (future:
  explicit write-offs).
- Not yet: 277CA/999 acknowledgments (with P3-09), write-off/adjustment entries, statements to patients for their
  responsibility.

### D-064 — Payroll (P4-03)
2026-09-28 · Claude Code
- **Gross earnings only.** Taxes, benefits and garnishments are done by the payroll provider (ADP, Gusto, QuickBooks…);
  we export what they need. "Deductions" here are agency adjustments entered by hand (e.g. uniform advance).
- **What is paid**: completed visits whose **EVV is verified**, using the EVV clock-in/out (visit actual times as a
  fallback). Completed but unverified visits are listed as warnings and paid in a later period once verified (they
  aren't lost: they're picked up by whichever period contains the visit date — recalculate that period before approval).
- **Rates** (staff profile): a per-visit rate → per-visit pay, no overtime (fee-basis clinicians); otherwise the hourly
  rate. No rate → warning, not paid. **Overtime (FLSA)**: home care workers are non-exempt (DOL Home Care Rule, 2015):
  hours over 40 in a **workweek** at the staff overtime rate, default 1.5 × hourly. Workweeks start on
  `agencies.workweek_start_day` (default Sunday); weeks straddling a period boundary count the hours from before the
  period toward the 40 without paying them again. Travel time between clients and "regular rate" adjustments for
  bonuses are **not** computed — the owner's accountant should confirm policy (added to OPEN_QUESTIONS as Q-010).
- **Mileage**: staff log trips (no patient addresses needed), `payroll:approve` holders approve/reject with a reason;
  approved miles in the period × the staff member's mileage rate, else `agencies.payroll_mileage_rate` (default
  $0.70). Reimbursement is a separate, non-taxable column, not in gross.
- **Lifecycle**: open → calculated (recalculate freely; bonuses, deductions and notes survive) → approved (locked;
  each staff member gets a `payroll_ready` notification) → exported (CSV, re-downloadable, every export audited).
  Periods can't overlap and are at most 31 days.
- **Privacy**: stub lines show the patient as "First L." only; the CSV has no patient data at all. Staff see only
  their own stubs, and only once approved ("My pay").

### D-065 — Reports and dashboards (P4-01, P4-02)
2026-09-28 · Claude Code
- **Endpoints** (`/reports/*`, `reports:read` — admins, supervisor, billing): census (active by payer, admissions,
  discharges), visit utilization (daily and by visit type; completion rate = completed ÷ (completed + missed)), EVV
  compliance (verified / awaiting review / rejected / no EVV, clock-in methods), staff productivity (visits, missed,
  EVV hours, average visit), missed & cancelled visits (with reasons; audited — it lists patients), and the
  financial summary (billed = claims + invoices created in range, collected = posted 835 payments + invoice payments,
  denials by reason and rate, outstanding from the AR aging) which **also requires `billing:read`**. Range defaults to
  the last 30 days, at most a year. List reports take `format=csv` and return `{ fileName, content }`.
- **Materialized view** `mv_daily_visit_summary` (raw-SQL migration; Prisma doesn't model views and the CI drift check
  ignores them — verified) with a unique index so it refreshes `CONCURRENTLY` every 15 minutes (`JOBS_ENABLED`) and on
  "Refresh numbers" (`POST /reports/refresh`). Everything else is a direct query; add views only where the P4-09 load
  test shows a need. DESIGN.md's `mv_claims_aging` isn't needed — aging is computed from open claims (D-063).
- **Dashboard** (`/reports`): presets 7/30/90 days or custom, in one row; stat tiles for headline numbers; one
  stacked column chart (visits per day by outcome) using the reference categorical slots 1–4 in fixed order —
  validated with the dataviz validator (CVD ΔE ≥ 9.1, normal ≥ 22.9 on white); aqua/yellow are under 3:1 so the chart
  always has a legend, a hover tooltip and a table view. Payer bars are single-series with values at the tips. Later:
  PDF export, custom reports, authorization utilization and clinical/OASIS timeliness reports.

### D-066 — Notification preferences (P4-07)
2026-09-28 · Claude Code
- `notification_preferences` rows exist only where a user changed a default; **everything is on by default**.
  Channels per type: in-app, push, SMS, email. Only **in-app** is delivered today, so it's the one enforced now:
  `notify()` drops recipients who turned in-app off for that type. Push/SMS/email choices are stored for P2-12/P3-19.
- **`system` alerts (security, serious incidents) can't be switched off** (`MANDATORY_NOTIFICATION_TYPES`).
- API: `GET /notifications/preferences` (all types with effective values), `PUT /notifications/preferences/:type`
  (only the channels sent change). Own preferences only; no permission needed. Web: Notification settings, from the bell.
- Web checkboxes are **uncontrolled** (`defaultChecked` + a `key` that includes the saved value): a controlled checkbox
  is reset by React before TanStack Query's async cache update re-renders, so the box visibly flips back for a moment
  (and Playwright's `check()` fails). A failed save reverts the cache, which changes the key and remounts the box.

### D-067 — Audit log: monthly partitions, retention, append-only guard (P4-08)
2026-09-28 · Devin
- `audit_logs` is **range-partitioned by `created_at`, one partition per UTC month** (`audit_logs_y2026m09`), plus
  `audit_logs_default` so an insert never fails. Raw-SQL migration `20260928220000_audit_logs_partitioning` (copies
  existing rows, keeps the `audit_logs_id_seq` sequence). The primary key becomes `(id, created_at)` (Postgres requires
  the partition key in it) — `@@id([id, createdAt])` in schema.prisma. Prisma ignores the partitions: the CI drift check
  reports no difference (verified on Postgres 17).
- **Append-only in the database**: a trigger refuses every UPDATE, and DELETE/TRUNCATE unless the transaction ran
  `set_config('alora.audit_purge','on',true)`. Row-level, so it's cloned to every partition. Only two things opt in:
  `purgeAuditLogs(prisma, agencyId)` (test cleanup and the demo-agency wipe — FAKE data only; never call it from
  product code) and the partition job moving rows out of the default partition. It stops app bugs, not a DB owner.
- **`AuditPartitionsJob`** (daily 03:45 UTC, `JOBS_ENABLED`, advisory-locked, idempotent): keeps the current month + 3
  ahead created (moving any rows that landed in the default partition first), and **drops whole months older than
  `AUDIT_RETENTION_MONTHS`** (default and minimum 72 = HIPAA's 6 years). Dropping is permanent — nothing is archived
  yet; export to S3/Glacier before drop when S3 exists (P4-10). Retention length: Q-011.

### D-068 — Security pass and load test (P4-09)
2026-09-29 · Devin (review, forced-password-change code) + Claude Code (verification, fixes, load test)
- **Forced password change is enforced by the API** (was client-only, D-058). A never-set password (admin-created or
  portal temporary) or one older than `PASSWORD_MAX_AGE_DAYS` (default 90; 0 = off) puts `pwc: true` in the access
  token; `JwtAuthGuard` then answers **403 `PASSWORD_CHANGE_REQUIRED`** everywhere except `GET /auth/me` and
  `POST /auth/change-password` (`@AllowDuringPasswordChange()`), checked **before** the 2FA-setup restriction; sockets
  are refused too. `/auth/me` and every token response carry `mustChangePassword`; the web shells and the mobile app
  send the user to change-password first. Changing it issues fresh, unrestricted tokens.
- **CSV formula injection** (OWASP): all CSV downloads (reports, payroll) go through `common/utils/csv.ts` — text
  starting with `= + - @`, tab or CR gets a leading apostrophe; numbers (incl. "-5.00") are untouched.
- **Content-Security-Policy on the dashboard**: nonce per request in `src/proxy.ts` (policy in `src/lib/csp.ts`):
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (+`'unsafe-eval'` in dev only), `style-src 'self' 'unsafe-inline'`
  (Leaflet/Recharts style attributes), `img-src 'self' data: blob: https://*.tile.openstreetmap.org`, `connect-src
  'self'` + the API origin and its ws(s) origin, `object-src 'none'`, `base-uri`/`form-action 'self'`,
  `frame-ancestors 'none'`, `upgrade-insecure-requests` when the API is HTTPS. The root layout renders per request
  (`connection()`) so Next.js can nonce its scripts — every route is dynamic, fine for a signed-in app. Verified by a
  browser test (map tiles, charts, sockets, patient page — no violations) and on a production build (no
  `unsafe-eval`, all scripts nonced). The other headers stay in `next.config.ts`.
- **npm audit**: 3 moderate, all `decode-uri-component` under `expo-router → query-string@7` (mobile only). **Accepted**:
  the fixed 0.5.0 is ESM-only and `query-string@7` `require()`s it (an override would break the app bundle); impact is
  a client-side slowdown from a crafted deep link on the caregiver's own phone. Revisit when Expo Router drops
  `query-string@7`.
- **Reviewed and fine**: raw SQL (tagged templates or fixed strings), agency scoping on every by-id write, mass
  assignment (whitelist + forbidNonWhitelisted), refresh cookie (httpOnly, Secure, SameSite=strict), sanitised
  download file names, Swagger off in production, validated secrets, no SSRF surface. `trust proxy` and a shared
  (Redis) rate-limit store belong to deployment (P4-10).
- **Load test** (`apps/api/scripts/load-test.mjs`, demo data, laptop → Neon): before, 19.6 req/s at 10 concurrent with
  p50 150–1,100 ms; the slow endpoints made one database round trip per relation level. Fixes: Prisma
  **`relationJoins`** (nested includes load in one SQL query with LATERAL joins — now the default strategy for every
  query), the messages list's latest-message lookup in one `DISTINCT ON` query instead of one per conversation, pg
  TCP keep-alive. After: 30.4 req/s at 10 concurrent, p50 ~355 ms (≈3 round trips: auth, query, audit write) for
  almost every endpoint, 0 errors at 25 concurrent. At 25 concurrent throughput plateaus (~28/s) on the connection
  pool, now configurable: **`DATABASE_POOL_SIZE`** (default 10). Latency here is dominated by the laptop↔Neon
  distance; in production the API must run in the same region as the database.

### D-069 — Virginia EVV: data on the claim, no aggregator (P4-04)
2026-09-29 · Claude Code
- **Virginia has no EVV aggregator** (DMAS EVV FAQ, 11/2023: "Virginia does not use the term aggregator"). It is a
  provider-choice state: DMAS approves no vendors, and the EVV data travels **on the claim** in fields the DMAS
  companion guides assign. So P4-04 is "EVV data on Virginia claims", not an aggregator upload. The
  `evv_records.aggregator_*` columns stay unused until a state that has an aggregator (Sandata, HHAeXchange, …) is added.
- **Which lines**: 837P personal care / respite / companion **T1019, T1005, S5135** (S9125 excluded); 837I home health
  (facility type **32 or 34**) on revenue codes **0550, 0551, 0559, 0571, 0421, 0424, 0431, 0434, 0441, 0444**
  (`edi/evv-virginia.ts`).
- **Fields** (DMAS MES EDI 837P guide v1.9+, 837I guide 02/03/2023):
  - 837P: SV101-7 = begin-end time `HHMM-HHMM` (hours 00–23); 2420D NM1*DQ = attendant last/first name, REF*LU =
    attendant ID; 2420G NM1*PW + N3/N4 = begin location; 2420H NM1*45 + N3/N4 = end location.
  - 837I: 2310E NM1*77 NM103 = the literal `HH EVV Service Location` (sent in mixed case exactly as DMAS writes it) +
    N3/N4 + REF*LU*99999; SV202-7 = `HHMM-HHMM` (00–24, within the line's date); 2420D NM1*DN = attendant name,
    REF*G2 = attendant ID. One service location per claim.
  - Times are local clock times in the agency's time zone from the EVV record's clock-in/out.
- **Attendant ID** = `staff_profiles.employee_id` (DMAS: provider-assigned, unique, letters/digits, never an SSN — we
  refuse 9-digit IDs). **Location** = the patient's home address; a clock-in/out outside the geofence is accepted
  only after a supervisor verified the record (status `verified`), otherwise it's listed as edit 2095/2096.
- **Turned on per payer**: `payers.evv_claim_profile = 'va_dmas'` (Billing setup → "EVV on claims"). Virginia MCOs
  take the same claim fields as far as we know (each MCO's companion guide should be checked when the agency
  contracts with it — Q-012). Other states get their own profile value later.
- **Problems name the DMAS edit** the claim would be denied with (EOB 2094 data missing … 2100 end time invalid), in
  the claim's EDI preview (422 `EDI_INCOMPLETE`), so billers can fix them before submitting.
- **Checked before billing**: for these payers "Ready to bill" runs the same rules (check `evv_claim_data`), so a
  visit missing EVV claim data is skipped with the reason instead of making a claim that would be denied.
- **Overnight shifts**: a shift crossing local midnight becomes one line per day (`claim_lines.evv_start/evv_end`
  hold each piece; units per piece). "One active line per visit" became **one active line per visit and service
  date** (`claim_lines_one_active_per_visit_day`) — still no double billing.
- **Modifier 76**: on Virginia 837P claims, a second line for the same service on the same day gets 76 (added when
  the file is built).
- **Not done yet** (ROADMAP P4-04b): personal care hours round per **month** (DMAS: whole 1-hour units, accrued
  minutes carried forward, 30+ leftover minutes round up at month end) — today `hour` codes bill quarter hours per
  visit; the UB modifier for live-in / exempt settings.

### D-070 — Production packaging (P4-10)
2026-09-29 · Claude Code
- **Three images**: `docker/Dockerfile.api` (existing), `docker/Dockerfile.web` (Next.js `output: 'standalone'`,
  switched on by `NEXT_OUTPUT=standalone` so `next start`/dev are unchanged; traced from the monorepo root; runs
  `node apps/web/server.js`), `docker/Dockerfile.migrate` (only the locked Prisma CLI + dotenv versions, the schema
  and migrations; `prisma migrate deploy` then exit; the schema engine is downloaded at build time, as root).
- **`NEXT_PUBLIC_API_URL` is a build argument** — Next.js compiles it into the browser code and the CSP, so each
  environment gets its own dashboard image. Same-host layout recommended: dashboard at `/`, API at `/api/v1`.
- **`docker-compose.prod.yml`**: migrate → api (healthcheck) → nginx; web alongside. No database container — a
  managed PostgreSQL under the host's BAA (Q-006). Secrets from `.env.production` (template
  `.env.production.example`, gitignored real file; `certs/` gitignored too).
- **nginx** (`docker/nginx/default.conf.template`): TLS 1.2/1.3, HSTS, HTTP→HTTPS, WebSocket upgrade for Socket.IO,
  12 MB bodies, and **PHI-safe logs**: access log format `phi_safe` with `$uri` (no query string), no referrer, set
  per server so the image's default `main` format is never used; error log at `crit` only (nginx error entries quote
  the full request line). `X-Forwarded-For` is *replaced* with the client address, not appended.
- **`TRUST_PROXY_HOPS`** (new env, default 0; 1 in the prod compose): Express `trust proxy`, so rate limits and the
  audit log see the client's address rather than the proxy's.
- **One API instance** until a Redis Socket.IO adapter + shared rate-limit store are added (in-memory today).
- **CI** builds all three images, migrates a fresh Postgres with the migration image, starts the API and dashboard
  containers (health + login page + CSP nonce header), and checks the nginx config with `nginx -t`.
- **Not done**: publishing images to a registry and the actual deploy step — both depend on the host (Q-006) and the
  owner's approval of where images are published (they'd be public on GHCR while the repo is public).
- Verified locally: the standalone dashboard server runs and sends the nonce CSP; the migration recipe (same Prisma
  and dotenv versions, same files) reports "Database schema is up to date" against the dev database. Docker itself
  isn't run on the owner's laptop (D-011) — CI builds the images.

### D-071 — Push / SMS / email delivery: database outbox, providers off until connected (P2-12, P3-19 groundwork)
2026-09-29 · Claude Code
- **Outbox in Postgres, not BullMQ** (DESIGN §13.1 said BullMQ): `notify()` writes the inbox row and, in the same
  call, one `notification_deliveries` row per outside channel; a job every 30 s takes due rows with
  `FOR UPDATE SKIP LOCKED` (safe with several API instances), sends, and records `sent` / retry / `failed`. Why: no
  Redis to run, secure and back up under a BAA; the database already is; delivery survives restarts. Retries after 1,
  5, 30 and 120 minutes, then `failed`; rows stuck in `sending` for 10 minutes are taken again; notifications older
  than 24 h are `skipped` (a day-late shift reminder is noise).
- **Providers, plain HTTPS, no SDKs** (`notifications/delivery/senders.ts`): Twilio SMS, SendGrid email (no
  open/click tracking), Expo push (the mobile app is Expo; Expo relays to FCM/APNs). **Each is off until its
  settings are present** (`TWILIO_*`, `SENDGRID_*`, `PUSH_PROVIDER=expo`) — the owner turns them on after signing
  the BAAs (P2-11, P3-19). `GET /notifications/channels` says which are connected; Notification settings shows the
  rest as "not connected yet".
- **Who gets what**: a channel is used when the person's saved choice says so, or — no choice saved — when the type's
  default includes it (**DESIGN §13.2 defaults**, `DEFAULT_DELIVERY_CHANNELS` in `@alora/shared`: texts only for a new
  shift and a missed visit), the provider is connected, and the person is reachable (phone number → E.164, a
  registered phone for push). A preference row created by one toggle starts from the type's defaults. **Never for
  portal users** (patients/families): a text or email to a patient itself discloses they're a patient — in-app only
  until the owner confirms the BAAs cover it. Inactive accounts get nothing outside the app.
- **In-app off, text on** is allowed: the row is kept for delivery but without `in_app` in `channels`, and the inbox
  lists only rows with `in_app`.
- **Content**: the notification's title/body — PHI-free by contract (DESIGN §13.3). SMS: "Alora: <title> — <body>.
  Open the app for details." (≤ 320 chars). Push data carries ids only. Nothing about the message or the person is
  logged; `last_error` holds provider status codes only.
- **Push devices**: the mobile app registers its Expo push token after sign-in (`POST /notifications/devices`) and
  removes it at sign-out; a token moves to whoever signed in on that phone last; tokens Expo reports as
  `DeviceNotRegistered` are deleted. Registration is a no-op until the app is built with an EAS project id (owner's
  Expo account). Expo push receipts (second-stage errors) aren't checked yet.

### D-072 — Forgot / reset password by email (P3-19)
2026-09-29 · Claude Code
- `POST /auth/forgot-password {email}` answers **the same for every address** (`{accepted, emailAvailable}`) and does
  the work in the background, so neither the answer nor its timing tells whether an account exists. 5 requests per
  minute per IP. `emailAvailable` only says whether the agency connected email at all (then the page says "ask your
  administrator").
- The link: 256 random bits, **single use, 30 minutes, only the newest works**, stored as a SHA-256 hash
  (`password_reset_tokens`). It carries the token in the **URL fragment** (`/reset-password#token=…`), which browsers
  never send to servers — so it can't end up in nginx, CDN or API logs, or in Referer headers.
- `POST /auth/reset-password {token, newPassword}`: password policy as everywhere, must differ from the current one,
  **clears a lockout** (the person proved control of the mailbox), revokes every refresh token (all sessions end);
  they then sign in normally — 2FA still applies. Audited: `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET`,
  `PASSWORD_RESET_EMAIL_FAILED`.
- Sent straight through the email sender (not the notification outbox: it mustn't show in an inbox or wait 30 s).
  Nothing is sent unless SendGrid **and** `FRONTEND_URL` are set (D-071). Portal users can reset too — they asked for
  the email themselves.
- Web: "Forgot your password?" on the sign-in page, `/forgot-password`, `/reset-password` (reads the fragment with
  `useSyncExternalStore`, clears it from history after use).

### D-073 — Telephony EVV: Twilio voice webhooks (P2-13)
2026-09-29 · Claude Code
- **Flow**: the caregiver calls the agency's check-in number **from the patient's home phone** → the caller ID must
  match an active patient's `phone_home` (digits compared, any agency using the number) → they key their **phone
  check-in code** + # (3 tries) → the system finds their visit at that home today (one they're clocked into first,
  else the scheduled one starting soonest) → "press 1 to clock in" / "press 2 to clock out" → "You are clocked in at
  9:02 AM". Nothing spoken names the patient. EVV's own refusals ("This visit isn't scheduled around this time") are
  read out — they're PHI-free.
- **Location**: the landline stands in for GPS (Virginia accepts the member's landline; D-069). Telephony records
  have `clock_in_method = 'telephony'`, the calling number, no coordinates and no geofence flags. Everything else
  (time window, open-visit, short-visit checks, supervisor review) is the same code path as the app
  (`EvvService.clockIn/OutByPhone`).
- **Security**: routes are public (Twilio can't sign in) but **every request must carry a valid X-Twilio-Signature**
  (HMAC-SHA1 with the auth token over `TWILIO_WEBHOOK_BASE_URL` + path + query + sorted form fields) — so the step
  state in the query string (`visit`, `staff`) can't be forged or replayed on another step. Off (404) until
  `TWILIO_AUTH_TOKEN` and `TWILIO_WEBHOOK_BASE_URL` are set. Hidden from the OpenAPI docs. Clock events by phone are
  audited (`EVV_CLOCK_IN_BY_PHONE` / `EVV_CLOCK_OUT_BY_PHONE`).
- **Check-in code**: `staff_profiles.ivr_code`, 4–8 digits, unique per agency, **write-only** (the API only says
  `hasPhoneCheckInCode`). Stored plain so it can be looked up; a leaked code alone is useless without calling from
  that patient's home phone during that caregiver's visit. 6+ digits recommended.
- Needs the owner's Twilio account + BAA (P2-11); tested with signed fake requests.

### D-074 — Accessibility checks in the browser suite
2026-09-29 · Claude Code
- **WCAG 2.1 A/AA automated checks** (axe-core via `@axe-core/playwright`, helper `apps/web/e2e/axe.ts`) run in CI on
  the signed-out pages, 13 office pages (incl. patient and EVV record detail, schedule booking, live monitor, reports),
  6 billing pages and the 4 patient-portal pages. Map tiles are excluded (third-party drawing; the map container is
  labelled). Why: Medicaid agencies and their patients include people with disabilities, and public programs expect
  Section 508 / WCAG 2.1 AA.
- First run found only **colour contrast**: `text-slate-400` on white (≈2.6:1) → `text-slate-500` (≈4.8:1) everywhere
  it's used for text (incl. placeholders); the 10 px "not connected yet" label is 12 px now. **Rule for new UI: no
  `slate-400` (or lighter) text on white.**
- Automated checks catch about a third of real problems; a manual keyboard + screen-reader pass (NVDA/VoiceOver) is
  still worth doing before launch.

### D-075 — Product name: Kayo Health
2026-09-29 · owner (answer to Q-004) + Claude Code
- Everything users see says **Kayo Health**: web title, sign-in, sidebar, mobile app ("Kayo Caregiver"), texts
  ("Kayo Health: …"), emails, the phone check-in greeting, the API docs title and the 2FA issuer. Existing
  authenticator entries keep working (the issuer is only a label; the secret didn't change).
- **Internal names stay** — `@alora/*` packages, the repo name, `demo.alora.test` demo logins, `alora-*` image names:
  nobody outside sees them, and renaming would churn every import for no user benefit. "Alora" in older decisions
  refers to the same product.

### D-076 — Claim files and acknowledgments before a clearinghouse connection (P3-09a)
2026-09-29 · Claude Code
- **Files, not single claims**: Billing → *Claim files* groups ready claims by payer and form (837P/837I); billing
  picks claims and makes **one 837 file** — the real thing (production indicator, or test for the clearinghouse's
  test channel), not a preview. It's stored in `edi_files` (outbound, status `generated`) and the claims point to it
  (`claims.edi_file_id`). Staff download it, upload it to the clearinghouse portal and **mark it sent** → its claims
  become `submitted` (aging starts). This works with any clearinghouse today; SFTP automation comes once one is
  chosen (P3-08/P3-09) and will reuse the same files.
- **Control numbers** (ISA13/GS06): a per-agency counter (`agencies.edi_control_number`) advanced **inside the same
  transaction** that builds and saves the file, so numbers never repeat and a refused file (mixed payers, missing
  data → 409/422 listing every problem per claim) doesn't use one up.
- A claim can't be in **two unsent files** (409 — download the existing one).
- **Acknowledgments** (Load 999 / 277CA; duplicates refused by content hash):
  - **999**: matched to our file by its group control number. Accepted → file `accepted`. Rejected → file `rejected`
    and its waiting claims `rejected` with the reason (IK3/IK4 syntax errors spelled out).
  - **277CA**: matched claim by claim number (TRN02 = CLM01). Accepted (A1/A2…) → `acknowledged` + the payer's claim
    number (REF*1K). Rejected (A3/A4/A6/A7/A8) → `rejected` with the category and status codes in words
    ("A7 Rejected — invalid information, status code 562 (billing provider)"). Claim numbers that aren't ours are
    listed, not applied.
- **Rejected claims** never reached adjudication, so they're fixed and resent as new claims (frequency 1): the claim
  page shows the reason; *Re-check (QA)* puts it back to `ready`; it goes in a new file. They can also be voided.
- The preview (`GET /billing/claims/:id/837`) and files share one per-claim builder, so they can't drift apart.

### D-077 — Virginia billing options, ready but off (P4-04c)
2026-09-29 · owner ("have all options ready to be added at any time") + Claude Code
- **Whole hours per month** (payer setting `hour_rounding = 'monthly'`, Billing setup → "Hourly units"): for hourly
  service codes, each claim line gets whole 1-hour units; minutes that don't make a full hour carry forward to the
  next shift of the same client, service and month (after what's already on active claims), and once the month is
  over 30+ leftover minutes round up on the last line (`monthlyHourUnits`). A short early shift can get 0 units —
  its EVV still goes on the claim. Default stays quarter hours per visit.
- **Live-in caregiver** (patient checkbox `live_in`): Virginia personal care lines (T1019/T1005/S5135) for that
  client get the **UB** modifier on "EVV on claims: Virginia" payers.
- Both are **off until the agency switches them on**, after its biller confirms with DMAS / each MCO and a test claim
  goes through (Q-012). Everything else Virginia-specific (EVV fields, midnight split, modifier 76) was already on
  for Virginia payers.

### D-078 — Email through Amazon SES (SendGrid is development only)
2026-09-29 · Claude Code
- **Twilio SendGrid does not sign a BAA** and says it isn't a HIPAA-eligible service. Our emails carry no patient
  details, but a reset email to a portal user still reveals they're a patient — so production email must come from a
  provider under a BAA. **Amazon SES** is covered by the AWS BAA (self-serve in AWS Artifact) and costs about
  $0.10 per 1,000 emails.
- `EMAIL_PROVIDER=ses|sendgrid` picks the service (empty: SendGrid if its key is set — dev convenience), `EMAIL_FROM`
  is the sender for both. SES uses the AWS SDK (`@aws-sdk/client-sesv2`) with the standard credential chain — the ECS
  task role on AWS, never keys in the repo. Throttling and server errors are retried by the outbox; rejections
  (unverified sender, bad address) aren't.
- Same plain-text content as before; the "from" name is "Kayo Health".

### D-079 — Visual design: indigo & violet (web)
2026-09-29 · owner (chose "Indigo & violet") + Claude Code
- **Palette**: deep indigo `#1E1B4B` (`--color-ink`: sidebar, headings), violet `#6D28D9`/`#7C3AED` (actions, links,
  active states), fuchsia for badges, soft canvas `#F7F7FB`, white cards. Status colours: emerald / amber / rose.
  Links and text keep WCAG AA contrast (violet-700/800 on white; no `slate-400` text — D-074).
- **Type**: Inter (self-hosted by `next/font`, so the CSP's `font-src 'self'` still holds).
- **Components**: rounded-2xl cards with a soft two-layer shadow (`--shadow-card`, `--shadow-lift` on hover),
  rounded-xl inputs with a violet focus ring, gradient primary buttons; icons from `lucide-react`.
- **Shell**: indigo sidebar with icons grouped Overview / Care / Billing / Business / Admin, the user card and
  sign-out at the bottom, slide-over menu on phones; sticky translucent top bar. Dashboard: gradient welcome banner +
  icon stat cards. Signed-out pages (sign in, password reset, 2FA setup) share a split-screen `AuthLayout` with a
  brand panel. Portal: gradient header with the agency name.

### D-080 — Caregiver app: tabs, profile and settings
2026-09-29 · owner ("looks boring… can they see settings or profile") + Claude Code
- Same palette as D-079 (`components/ui.tsx`), Ionicons (`@expo/vector-icons`), gradients (`expo-linear-gradient`,
  SDK-57 version; runs in Expo Go).
- **Bottom tabs**: **Today** (greeting, stats, an "up next / you are on this visit" card, visit cards), **Schedule**
  (next 7 days, saved for offline like Today), **Alerts** (the notification inbox, mark read), **Profile** (details
  from `/staff/me`: employee ID, employment, email, phone, whether a phone check-in code is set; credentials with
  expiry state; settings: visit reminders on/off — kept on the phone —, app lock info, change password; help: call
  the office, items waiting to send, app version; sign out). Visit screens open on top of the tabs as before.
- `/auth/me` now includes the agency's name and phone (no patient data) for "call the office".
- Sign-in and unlock screens got the brand header. Forced password change still comes first; Profile → Change
  password reuses the same form.

### D-081 — Hosting: Azure, small start
2026-09-29 · owner ("start small… later Azure… can we use Vercel") + Claude Code
- **Azure, not Vercel**: Vercel only hosts the dashboard (the API needs to run all the time: sockets, jobs, IVR) and
  its HIPAA BAA is a $350/month add-on; Azure's BAA is included in the Product Terms for every customer. Starting on
  the target platform avoids a second migration.
- **Small setup** (`infra/azure/main.bicep`, ≈ $33–38/month): Container Registry Basic (private images), one Linux
  App Service plan **B1** running two container apps (dashboard, API — always on, WebSockets on, health checks,
  HTTPS only, TLS 1.2+, FTP off, **HTTP logging off** because it records query strings), PostgreSQL Flexible Server
  **B1ms** 17 (TLS required, 14-day backups, reachable only by Azure services). Apps pull images with their own
  managed identity (AcrPull) — no registry passwords. Secrets are App Settings for now (Key Vault later).
- **Custom domain required**: `app.<domain>` + `api.<domain>` (free managed certificates). On
  `*.azurewebsites.net` the two apps are different *sites* (public suffix), so the SameSite=strict refresh cookie
  wouldn't be sent and Safari would block it anyway.
- **Deploy** (`.github/workflows/deploy-azure.yml`, manual only): OpenID Connect login (no stored Azure password),
  build → push to the private registry, open the database to the runner's IP just for `prisma migrate deploy`
  (migration image), roll out both apps, health check. CI compiles the Bicep on every push.
- **First agency**: `npm run agency:create -w @alora/api -- --name … --email …` creates the agency and an admin with a
  one-time temporary password (forced change, then 2FA). The demo seed stays development-only.
- **Azure's front end writes `ip:port` into X-Forwarded-For**: the API strips ports (with `TRUST_PROXY_HOPS=1`) so
  rate limits and audit logs see the real client address.
- Step-by-step for the owner: `docs/DEPLOYMENT-AZURE.md` (all in Azure Cloud Shell).

### D-082 — Product name: Primordial Health; domain primordialhealthservices.health
2026-09-29 · owner + Claude Code (replaces the name in D-075)
- The owner's registered agency is **Primordial Health Services LLC** (domain `primordialhealthservices.health`, at
  Namecheap); the app carries the agency's name: **Primordial Health** everywhere users see it (web, portal, caregiver
  app "Primordial Caregiver", texts "Primordial Health: …", emails, IVR greeting, 2FA issuer, API docs title). The
  logo tile shows **P**.
- Hosting on that domain (D-081): dashboard **app.primordialhealthservices.health**, API
  **api.primordialhealthservices.health**; the agency's existing website is untouched. Azure names use the prefix
  `primordial` (resource group `primordial-rg`, images `primordial-api/-web/-migrate`, database `primordial`).
- Internal code names stay (`@alora/*` packages, repo name, `demo.alora.test` logins).

### D-083 — Caregiver app: Messages, Open shifts, My pay; store builds
2026-09-29 · owner ("lets progress to caregiver app and app extras") + Claude Code
- **Messages** becomes a fifth tab (Today, Schedule, Messages, Alerts, Profile) with an unread badge. The badge
  refreshes every minute and whenever a tab opens.
  - The conversation list, one conversation (refreshes every 15 s while open, marks read), and a new message screen
    (pick a colleague, first message).
  - An **urgent** toggle uses the API's `isUrgent`, which sends an alert.
  - Attachments show their title and open on the dashboard.
  - Uses the existing `/messages` API (D-057).
  - **Message text is never saved on the phone**: no offline cache, so reading and sending need a connection.
- **Open shifts** (from the Schedule header, Profile, or an `open_shift` alert):
  - Shows only what the caregiver could claim (date, time, hours, visit type, city/ZIP, priority). The patient's name
    appears only once the visit is theirs (D-040).
  - "Take this shift" asks for confirmation, then claims. First come, first served; the API refuses on conflicts or
    expired credentials.
- **My pay** (Profile → My pay, or a `payroll_ready` alert): approved stubs with the latest one highlighted, and each
  stub's breakdown and visit lines. It is labelled gross pay; the payroll provider issues the official statement.
- Alerts now open the related screen (open shift → Open shifts, message → Messages, payroll → My pay, shift changes →
  Schedule).
- **Store builds**:
  - `apps/mobile/eas.json` profiles: `preview` (installable Android APK) and `production`, both pointing at the
    production API.
  - IDs `health.primordialhealthservices.caregiver`, slug `primordial-caregiver`, scheme `primordial`, version 1.0.0.
  - Owner steps are in [MOBILE-RELEASE.md](MOBILE-RELEASE.md).

### D-084 — Adding more agencies later
2026-09-29 · owner ("in future we might have agencies that will need to be added") + Claude Code
- For now new agencies are added with `agency:create` (DEPLOYMENT-AZURE §5). It is run by the owner with a temporary
  database firewall opening and prints a one-time password; the new admin must change it and set up 2FA.
- **Built (2026-09-30)**: `.github/workflows/create-agency.yml` plus `create-agency --invite`.
  - The workflow refuses to run while the repository is public, because run inputs are visible there.
  - It uses the live API image and the API app's own email settings (read through the OIDC login and masked in logs),
    with a temporary database firewall rule.
  - The invite link reuses the password-reset token table and page, and is valid **72 hours**. The admin's email is
    masked in the output.
  - The original plan was a manual **"Create agency" GitHub workflow**. The owner enters the name, state,
  timezone and admin email. It runs inside the deploy pipeline (temporary firewall rule, like migrations) and emails
  the new admin a **set-your-password link** instead of printing a password, so nothing sensitive appears in logs.
- A signed-in platform-owner console (a `super_admin` who sees every agency) is deliberately **not** built yet. Every
  query is agency-scoped, and cross-agency access is the riskiest thing to add to a HIPAA system. Revisit it when
  there are several paying agencies.

### D-085 — Everything on Azure: email through Azure Communication Services
2026-09-29 · owner ("since we using azure lets do everything in azure") + Claude Code (refines D-078)
- **Email**: `EMAIL_PROVIDER=azure` sends through **Azure Communication Services Email**, which is under the same
  Microsoft agreement and HIPAA BAA as the hosting (D-081). No AWS account is needed.
  - Plain HTTPS to `{endpoint}/emails:send?api-version=2023-03-31` with the documented HMAC-SHA256 request signing, so
    no SDK. It is configured with `AZURE_COMMUNICATION_CONNECTION_STRING` (a secret in App Settings).
  - `EMAIL_FROM` is the plain sender address (`DoNotReply@primordialhealthservices.health`); the display name
    "Primordial Health" is set on the sender in Azure.
  - Link and open tracking are off (`userEngagementTrackingDisabled`), because tracking rewrites reset links.
  - 202 means accepted; 408, 429 and 5xx are retried.
  - SES and SendGrid stay as options (SES as the fallback; SendGrid is development only).
  - Owner steps are in DEPLOYMENT-AZURE §6. As part of that, the owner confirms Communication Services is ticked in the
    HIPAA BAA column of Microsoft's "Azure Compliance Offerings" PDF (Service Trust Portal).
- **Retirement notice (found during setup, 2026-09-29)**: Microsoft is retiring ACS **Email and SMS**. Existing
  resources and verified domains keep working and are supported until **2028-09-30**, but Microsoft advises against new
  workloads (https://aka.ms/acs-retirement). The owner's domain and resources were already set up, so ACS Email is used
  now, with a planned move before mid-2028 (ROADMAP P4-19). Replacement options:
  - Amazon SES, which is already built;
  - Microsoft 365 / Exchange Online sending through Graph, which is under the Microsoft BAA but needs an M365 licence
    and has lower limits;
  - a Marketplace provider that signs a BAA.

  M365 High Volume Email is internal-only, so it can't mail caregivers' own addresses. The sender is one class, so the
  move is small.
- **Later**:
  - **SMS stays on Twilio**, because ACS SMS is retiring too.
  - **Phone check-in (IVR)** is built on Twilio's call webhooks (D-073). Moving it means a rewrite onto Call
    Automation, so Twilio stays for IVR unless the owner decides otherwise.
  - **Push** stays on Expo's push service (messages carry no patient details).
- A service-principal/managed-identity login for email (no connection string) is possible later. It needs a custom
  role on the Communication Services resource.

### D-086 — Email: an HTML version alongside plain text; deliverability steps
2026-09-30 · owner ("email came in but it went to junk" → "do all") + Claude Code
- Every email now goes out with **both a plain-text and an HTML version** (all providers: Azure, SES, SendGrid).
  - The HTML is built only from the plain text (`email-html.ts`). Everything in it is escaped. It has a branded
    header, and a line that is only a link (the reset link) becomes a button. The footer says the message is
    automated. So the HTML can never say more than the PHI-free text.
- Deliverability for the new domain:
  - SPF, DKIM and DMARC (`p=none`) are verified.
  - First emails to Outlook.com landed in Junk. That is expected for a new sender; "Not junk" and adding the sender to
    contacts help.
  - The owner checks `Authentication-Results` (spf/dkim/dmarc=pass). Once emails pass consistently for a few weeks,
    tighten DMARC to `p=quarantine`, not before: tightening while anything fails would junk the agency's own mail.
  - Sender name: Azure doesn't allow renaming the default `DoNotReply` sender in the portal. A custom MailFrom address
    with the display name "Primordial Health" needs an Azure support request (quota for custom MailFrom).

### D-087 — Uptime and capacity alerts (Azure Monitor)
2026-09-30 · owner + Claude Code (after a startup-config outage went unnoticed until the deploy check failed)
- `infra/azure/monitoring.bicep` is deployed once, separately from `main.bicep`. It finds the same resources by the same
  names and needs no secrets. It creates an **action group** that emails the owner, and **metric alerts**:
  - API and dashboard `HealthCheckStatus` < 100 over 5 minutes (App Service's built-in health check: `/api/v1/health`,
    `/login`);
  - API `Http5xx` > 20 in 15 minutes;
  - Postgres `is_db_alive` < 1;
  - Postgres storage > 80% and CPU > 90% over 30 minutes;
  - App Service plan memory > 90% over 30 minutes.

  Alerts resolve themselves when the problem clears (`autoMitigate`).
- Metric alerts only (about $0.10 per rule per month). There is no Application Insights availability test yet, so a
  problem *in front of* App Service (DNS, certificate) isn't caught. Add a standard availability test later if that's
  wanted; it is billed per test run.
- Alert text names the failing piece and where to look (Log stream). It contains no patient data, because metrics
- Alert text names the failing piece and where to look (Log stream). It contains no patient data, because metrics
  carry none.

### D-088 — Backup restore drill (HIPAA contingency plan)
2026-09-30 · owner ("prove the database backups actually restore") + Claude Code
- **Backups**: Azure PostgreSQL automatic backups (daily full backups plus continuous logs), with **14-day** point-in-time
  restore in the same region. Geo-redundant backup is off for cost, and is the upgrade path.
  - Documents live encrypted inside the database (D-056), so they're in the same backups.
  - The PHI key lives only in the owner's password manager and the app settings: **a restore is unreadable without
    it**.
- **Drill**: the `.github/workflows/backup-restore-drill.yml` workflow runs by hand and quarterly (3 Jan/Apr/Jul/Oct).
  - It restores the latest point to a *new* temporary server; production is never touched.
  - It compares the copy with production: the same tables, the same applied migrations, at least one agency, and a
    warning if any table has *more* rows than production.
  - It always deletes the temporary server.
  - It uses the deploy pipeline's OIDC login and temporary firewall rules. The job summary (counts only, no data) is
    the drill record.
- **Runbook for a real restore** (restore to a new server, check it, switch `DATABASE_URL`, keep the old server a
  week): [BACKUP-RESTORE.md](BACKUP-RESTORE.md). Recovery point is minutes; recovery time is about 30–60 minutes.

### D-089 — Photos in messages
2026-09-30 · owner request + Claude Code / Devin (P4-22)
- A photo is uploaded to the conversation first (`POST /messages/conversations/:id/photos`, multipart `file`, same size
  limit as documents), and then sent as a message with its `documentId`. It is stored encrypted like any document, as
  `documentType = message_photo`, and hidden from the document library.
- Only the uploader can attach it, and only once, so a photo can't be moved into another conversation. It can be opened
  only through `GET …/attachments/:documentId` by participants of that conversation. Every view is audited
  (`VIEW_MESSAGE_ATTACHMENT`).
- Clients keep photos in memory only: the dashboard uses a data URL, and the app fetches with the bearer token into a
  base64 data URL. Nothing goes into a disk cache or the photo library. The app needs a connection to send a photo;
  photos are not added to the offline queue.
- The message text is required by the DTO. When the caregiver leaves it empty, the app sends "Sent a photo".

### D-090 — Time off requests
2026-09-30 · owner request + Claude Code / Devin (P4-22)
- `/time-off`: staff list, request and cancel their own requests (`visits:read`). Supervisors (`visits:approve`, like
  shift swaps) see all of them and approve or deny with `PATCH /time-off/:id`. At most 60 days per request, and never in
  the past. The requester can cancel while a request is pending, or after approval if it hasn't started yet.
- Approved time off blocks scheduling on those days, and pending time off shows a warning (conflict detector). For
  pending requests, approvers see `bookedVisits`: visits already booked in those days that will need another caregiver.
- The decision reaches the requester as a `time_off_decided` alert, with dates only. The app opens its Time off screen
  from that alert. The dashboard queue is on Schedule → Open shifts.
- The types are `vacation | sick | personal | other` (`time-off.dto.ts`). The older staff-profile time-off DTO still uses
  the shared `TIME_OFF_TYPES`, which also has `bereavement`. Reconcile the two lists if the owner wants bereavement
  leave.
