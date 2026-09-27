# Alora Health — Home Health Agency Management Platform

HIPAA-compliant platform for home health agencies: scheduling, EVV (GPS + IVR), live visit monitoring,
EMR (care plans, assessments, meds), caregiver management, Medicare/Medicaid/private-pay billing with
EDI 837/835, payroll, compliance and reporting.

| Part | Where | Tech |
|---|---|---|
| API | `apps/api` | NestJS, PostgreSQL, Prisma, Redis/BullMQ, Socket.IO |
| Admin dashboard | `apps/web` | Next.js (App Router) |
| Caregiver app | `apps/mobile` | React Native + Expo |
| Shared types | `packages/shared` | TypeScript |
| Patient portal | Base44 (outside this repo) | docs in `docs/base44-portal/` |

## Where things are

- **[docs/STATUS.md](docs/STATUS.md)** — what's done, what's in progress, what's next. Start here.
- [docs/ROADMAP.md](docs/ROADMAP.md) — every task, with IDs and owners.
- [docs/DESIGN.md](docs/DESIGN.md) — the full design (schema, API, architecture).
- [docs/DECISIONS.md](docs/DECISIONS.md) — changes to the design made along the way.
- [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) — things waiting on the owner.
- [AGENTS.md](AGENTS.md) — rules for AI agents working in this repo.

## Switching between AI agents (Claude Code ↔ Devin ↔ others)

Every agent reads `AGENTS.md`, which tells it to read `docs/STATUS.md` first and update it before stopping.
To hand over:

1. In the agent you're leaving, say: **"Wrap up: follow the end-of-session protocol in AGENTS.md."**
   It updates STATUS, ticks ROADMAP, commits and pushes.
2. In the new agent, say: **"Continue this project. Follow the start-of-session protocol in AGENTS.md."**

If an agent runs out of usage before wrapping up, the new agent will see uncommitted work or an unfinished
branch in `git status` / STATUS "In progress" and pick it up from there.

## Local development

Requirements: Node 24 LTS (`.nvmrc`), npm 10+, Docker Desktop.

```bash
cp .env.example .env
npm install
docker compose up -d     # PostgreSQL + Redis
```

Fill the database with a FAKE demo agency (safe to re-run; refuses to run in production):

```bash
npm run build
npm run db:deploy -w @alora/api   # apply migrations
npm run db:seed -w @alora/api     # prints the demo logins
```

Demo logins (password `Demo-Password-1!`, development only): `agency.admin@demo.alora.test`,
`supervisor@demo.alora.test`, `office.staff@demo.alora.test`, `billing.staff@demo.alora.test`,
`rn@demo.alora.test`, `hha@demo.alora.test`, `pt@demo.alora.test` and more (see the seed output).

Run the API and the dashboard (two terminals):

```bash
npm run start:dev -w @alora/api   # http://localhost:3001/api/v1
npm run dev -w @alora/web         # http://localhost:3000 — sign in with a demo login
```

More commands: [AGENTS.md §7](AGENTS.md).
