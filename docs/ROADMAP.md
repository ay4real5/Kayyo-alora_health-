# Roadmap — task list

The checkbox version of [DESIGN.md §15](DESIGN.md#15-phased-build-roadmap). Each task is sized for roughly one
agent session. Tick `[x]` only when the code is merged (or on a pushed branch with passing tests, noted in STATUS).

Owner: `agent` = any coding agent · `human` = the owner · `base44` = built in Base44 by the owner.
`deps:` lists tasks that must be done first.

---

## Phase 0 — Repo & handoff setup

- [x] **P0-01** `agent` Handoff system: AGENTS.md, CLAUDE.md, docs/STATUS, ROADMAP, DECISIONS, OPEN_QUESTIONS, DESIGN
- [x] **P0-02** `agent` Root monorepo config: package.json workspaces, turbo.json, tsconfig.base, .editorconfig, .gitignore, .env.example, docker-compose (Postgres + Redis)
- [x] **P0-03** `human` Decide repo visibility — public during build phase (see DECISIONS D-012)
- [ ] **P0-04** `human` Answer the Phase 1-blocking items in OPEN_QUESTIONS (Q-002 Base44 auth, Q-005 target state)

## Phase 1 — Foundation & core operations

- [x] **P1-01** `agent` Scaffold `packages/shared` (types, constants: roles, permissions) and `apps/api` (NestJS, current stable). Add `api` service to docker-compose. deps: P0-02
- [x] **P1-02** `agent` CI: GitHub Actions — install, lint, typecheck, test, build, Docker image build + health check. deps: P1-01
- [x] **P1-03** `agent` Prisma schema for core tables (agencies, users, roles, permissions, role_permissions, user_roles, refresh_tokens, audit_logs, patients, physicians, patient_diagnoses, payers, staff_profiles, staff_credentials, staff_availability, staff_time_off, visits, recurrence_rules, authorizations, documents, notifications). First migration. deps: P1-01
- [x] **P1-04** `agent` Common layer: response transform interceptor, exception filter, validation pipe, correlation-id, config module with env validation. deps: P1-01
- [x] **P1-05** `agent` PHI encryption util (AES-256-GCM, key from env) + tests. deps: P1-01
- [x] **P1-06** `agent` Auth module: login, refresh (rotation, hashed), logout, lockout after 5 fails, password policy, `/auth/me`. deps: P1-03, P1-04
- [x] **P1-07** `agent` 2FA (TOTP) setup + verify flow. deps: P1-06
- [x] **P1-08** `agent` RBAC: permissions seed, `@Permissions()` decorator, RbacGuard, agency scoping. deps: P1-06
- [x] **P1-09** `agent` HIPAA audit interceptor → `audit_logs` (PHI redaction, no-store cache headers). deps: P1-06
- [x] **P1-10** `agent` Swagger/OpenAPI at `/api/v1/docs` + script exporting portal-only spec to `docs/base44-portal/openapi-portal-spec.json`. deps: P1-04
- [x] **P1-11** `agent` Users module: admin CRUD, deactivate/reactivate, unlock, admin 2FA reset, role assignment without privilege escalation, user activity. deps: P1-08, P1-09
- [x] **P1-11b** `agent` 2FA recovery codes (one-time, hashed, usable at login). deps: P1-11
- [ ] **P1-11c** `agent` Enforce mandatory 2FA for the roles the owner picks (Q-008). deps: Q-008
- [x] **P1-12** `agent` Patients module: list/search, admit, get, update, discharge/readmit, diagnoses, allergies; encrypted SSN; record-level access (field staff see only their patients). deps: P1-08, P1-09
- [x] **P1-12b** `agent` Physicians directory (CRUD, NPI validation) — referenced by patients, orders, care plans. deps: P1-12
- [x] **P1-13** `agent` Staff module: CRUD, credentials, availability, time-off, expiring-credentials. deps: P1-08, P1-09
- [x] **P1-14** `agent` Scheduling: visits CRUD, cancel, calendar endpoint, conflict detector. deps: P1-12, P1-13
- [x] **P1-15** `agent` Recurring visit rules + occurrence generation. deps: P1-14
- [x] **P1-16** `agent` In-app notifications (DB + endpoints). deps: P1-08
- [x] **P1-17** `agent` Seed script with fake agency, users per role, patients, staff, visits. deps: P1-12, P1-13, P1-14
- [x] **P1-18** `agent` Scaffold `apps/web` (Next.js, Tailwind, shadcn/ui, React Query, Zustand), api-client with refresh, login page, idle-timeout, sidebar layout. deps: P1-06
- [x] **P1-19** `agent` Web: patients list/detail pages. deps: P1-18, P1-12
- [x] **P1-20** `agent` Web: staff list/detail/credentials pages. deps: P1-18, P1-13
- [x] **P1-21** `agent` Web: scheduling calendar + visit form. deps: P1-18, P1-14
- [x] **P1-22** `agent` e2e test pass for Phase 1 flows (Playwright in CI); update README quick start. deps: all P1

## Phase 2 — EVV & mobile

- [x] **P2-01** `agent` EVV module: GPS clock-in/out, geofence (haversine), exceptions, verify. deps: P1-14
- [ ] **P2-02** `agent` Socket.IO gateway with JWT handshake + rooms; `/live-monitor` events; late/no-show cron; nightly job extending recurring-visit windows (D-031). deps: P2-01
- [ ] **P2-03** `agent` Web: live monitor page (map + feed). deps: P2-02, P1-18
- [x] **P2-04** `agent` Visit documentation API: notes (sign), vitals, tasks. deps: P1-14
- [ ] **P2-05** `agent` Open shifts (create, broadcast, claim, assign) + shift swaps. deps: P1-14, P1-16
- [ ] **P2-06** `agent` Scaffold `apps/mobile` (Expo, Expo Router): login, PIN, secure token storage. deps: P1-06
- [ ] **P2-07** `agent` Mobile: today's schedule, visit detail, clock-in/out with location. deps: P2-06, P2-01
- [ ] **P2-08** `agent` Mobile: tasks, vitals, notes, signature pad. deps: P2-07, P2-04
- [ ] **P2-09** `agent` Mobile: offline queue (expo-sqlite) + background sync + offline banner. deps: P2-08
- [ ] **P2-10** `agent` Mobile: background location during active visit. deps: P2-07
- [ ] **P2-11** `human` Create Twilio + Firebase accounts, sign Twilio BAA, put keys in `.env`
- [ ] **P2-12** `agent` Notification queue (BullMQ) + push (FCM) + SMS (Twilio) channels, PHI-free templates. deps: P1-16, P2-11
- [ ] **P2-13** `agent` Telephony/IVR EVV (TwiML flows, signature-verified webhooks). deps: P2-01, P2-11

## Phase 3 — Billing, claims, clinical, portal

- [ ] **P3-01** `agent` Payers, service codes, payer rates; patient authorizations (moved from P1-12, needs payers). deps: P1-12
- [ ] **P3-02** `agent` Pre-billing QA engine. deps: P3-01, P2-01
- [ ] **P3-03** `agent` Claim creation from verified visits + claim lines. deps: P3-02
- [ ] **P3-04** `agent` X12 utils + EDI 837P generator with golden-file tests. deps: P3-03
- [ ] **P3-05** `agent` EDI 837I generator. deps: P3-04
- [ ] **P3-06** `agent` EDI 835 parser + payment posting/reconciliation. deps: P3-04
- [ ] **P3-07** `agent` EDI 270/271 eligibility. deps: P3-04
- [ ] **P3-08** `human` Clearinghouse account (Availity/Waystar), SFTP creds, BAA
- [ ] **P3-09** `agent` Clearinghouse SFTP submit/poll via claims-queue. deps: P3-04, P3-08
- [ ] **P3-10** `agent` Private-pay invoices + PDF (Puppeteer). deps: P3-01
- [ ] **P3-11** `agent` Care plans (CMS-485), assessments (JSONB forms), medications, physician orders. deps: P1-12
- [ ] **P3-12** `agent` Documents: S3 upload/download (pre-signed), versions, e-sign. deps: P1-12
- [ ] **P3-13** `agent` Secure messaging API + `/messages` socket namespace. deps: P2-02
- [ ] **P3-14** `agent` Portal module (`/portal/*`, portal_user guard scoped to own patient). deps: P3-11, P3-12, P3-13
- [ ] **P3-15** `agent` Write `docs/base44-portal/` (screen prompts, integration notes, regenerated spec). deps: P3-14
- [ ] **P3-16** `base44` Build the 7 portal screens in Base44 using `docs/base44-portal/`. deps: P3-15, Q-002 resolved
- [ ] **P3-17** `agent` Web: billing pages (claims, payments, invoices, eligibility). deps: P3-03
- [ ] **P3-18** `agent` Web: clinical pages (care plan, assessments, meds, documents). deps: P3-11, P3-12
- [ ] **P3-19** `agent` Email channel (SendGrid). deps: P2-12

## Phase 4 — Analytics, compliance, hardening

- [ ] **P4-01** `agent` Reports module + materialized views + refresh job
- [ ] **P4-02** `agent` Web: dashboards (Recharts) + report export (CSV/PDF)
- [ ] **P4-03** `agent` Payroll: pay periods, stubs, calculation, export; mileage
- [ ] **P4-04** `agent` EVV state aggregator adapter interface + first aggregator. deps: Q-005
- [ ] **P4-05** `agent` Compliance: dashboard, incidents, credential-expiry cron, audit-log query
- [ ] **P4-06** `agent` Claims denial/appeal workflow + aging report
- [ ] **P4-07** `agent` Notification preferences UI/API
- [ ] **P4-08** `agent` Audit-log monthly partitioning + retention
- [ ] **P4-09** `agent` Security pass (OWASP checklist), load test, perf fixes
- [ ] **P4-10** `agent` Production Dockerfiles, docker-compose.prod, nginx (must NOT log query strings — search terms can be PHI, D-035), deploy workflows. Deploys must run `prisma migrate deploy` (separate migration image/job — the API image has no Prisma CLI) **before** starting the API, which refuses to boot on an unmigrated DB.
- [ ] **P4-11** `human` Hosting choice (HIPAA-eligible, BAA), production secrets, domain
- [ ] **P4-12** `human` Rotate/revoke every dev credential shared during development (DECISIONS D-019); make repo private
