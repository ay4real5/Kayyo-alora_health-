# Alora Health — Home Health Agency Management Platform

HIPAA-compliant platform for home health agencies: scheduling, EVV (GPS + IVR), live visit monitoring,
EMR (care plans, assessments, meds), caregiver management, Medicare/Medicaid/private-pay billing with
EDI 837/835, payroll, compliance and reporting.

| Part | Where | Tech | State |
|---|---|---|---|
| API | `apps/api` | NestJS 12, PostgreSQL 17, Prisma 7 | Phase 1 complete |
| Admin dashboard | `apps/web` | Next.js 16, React 19, Tailwind 4 | Phase 1 complete |
| Shared types/rules | `packages/shared` | TypeScript | In use by both |
| Caregiver app | `apps/mobile` | React Native + Expo | Phase 2 |
| Patient portal | Base44 (outside this repo) | docs in `docs/base44-portal/` | Phase 3 (see OPEN_QUESTIONS Q-002) |

## What works today (Phase 1)

- **Sign-in**: passwords (Argon2id), account lockout, two-factor authentication with backup codes, 15-minute idle
  sign-out, sessions that survive reloads without exposing tokens to page scripts.
- **Roles and permissions**: 11 built-in roles; everything is permission-checked by the API; field staff only see
  their own patients and visits; nobody can grant access they don't have.
- **HIPAA audit trail**: every read or change of patient data is recorded (who, what, when, from where) — without
  storing the patient data itself in the log.
- **Patients**: admit, search, edit, discharge/readmit, diagnoses (ICD-10), allergies; SSNs encrypted, only the last
  4 digits ever shown.
- **Staff**: profiles, credentials with expiry tracking, weekly availability, time off with approval; pay visible to
  payroll only.
- **Users and physicians**: user administration with role assignment; physician directory with NPI checks.
- **Scheduling**: week calendar, booking with live conflict checks (double-booking, time off, availability,
  discipline, credentials), supervisor overrides (audited), recurring visits.
- **In-app notifications** for caregivers (assignments, changes, cancellations, time-off decisions).

Every change is checked on GitHub: unit tests, ~140 API tests against a real database, 13 browser tests of the
dashboard, the Docker image, and that the committed API description is current.

## Where things are

- **[docs/STATUS.md](docs/STATUS.md)** — what's done, what's in progress, what's next. Start here.
- [docs/ROADMAP.md](docs/ROADMAP.md) — every task, with IDs and owners.
- [docs/DESIGN.md](docs/DESIGN.md) — the full design (schema, API, architecture).
- [docs/DECISIONS.md](docs/DECISIONS.md) — changes to the design made along the way (read this with the design).
- [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) — things waiting on the owner.
- [docs/api/openapi.json](docs/api/openapi.json) — the full API description (also at `/api/v1/docs` in development).
- [AGENTS.md](AGENTS.md) — rules for AI agents working in this repo.

## Switching between AI agents (Claude Code ↔ Devin ↔ others)

Every agent reads `AGENTS.md`, which tells it to read `docs/STATUS.md` first and update it before stopping.
To hand over:

1. In the agent you're leaving, say: **"Wrap up: follow the end-of-session protocol in AGENTS.md."**
   It updates STATUS, ticks ROADMAP, commits and pushes.
2. In the new agent, say: **"Continue this project. Follow the start-of-session protocol in AGENTS.md."**

If an agent runs out of usage before wrapping up, the new agent will see uncommitted work or an unfinished
branch in `git status` / STATUS "In progress" and pick it up from there.

## Try it locally

Requirements: Node 24 LTS (`.nvmrc`), npm 10+, a PostgreSQL database (a free Neon database works — see
DECISIONS D-018 — or `docker compose up -d postgres redis` on a machine that can run Docker).

```bash
cp .env.example .env              # then set DATABASE_URL, JWT_SECRET and PHI_ENCRYPTION_KEY
npm install
npm run build
npm run db:deploy -w @alora/api   # create the tables
npm run db:seed -w @alora/api     # FAKE demo agency (safe to re-run; refuses to run in production)
```

Then, in two terminals:

```bash
npm run start:dev -w @alora/api   # http://localhost:3001/api/v1
npm run dev -w @alora/web         # http://localhost:3000
```

Sign in with a demo login (password `Demo-Password-1!`, development only):

| Login | Sees |
|---|---|
| `agency.admin@demo.alora.test` | everything, including users and pay |
| `supervisor@demo.alora.test` | clinical + scheduling; can override schedule conflicts |
| `office.staff@demo.alora.test` | patients, staff, scheduling; no pay, no users |
| `billing.staff@demo.alora.test` | patients (read-only) and billing |
| `rn@demo.alora.test`, `hha@demo.alora.test`, `pt@demo.alora.test`… | only their own patients and visits |

Tests: `npm run test` (unit), `npm run test:e2e -w @alora/api` (API, needs a database),
`npm run test:e2e -w @alora/web` (browser, needs the API and dashboard running). More commands:
[AGENTS.md §7](AGENTS.md).
