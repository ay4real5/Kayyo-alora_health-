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
