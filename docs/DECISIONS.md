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
