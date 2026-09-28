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
  (P4-08), and a DB-level guard against UPDATE/DELETE on `audit_logs` (add with P4-08).
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
