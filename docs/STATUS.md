# Project status

> Every agent updates this file at the end of every session. Keep it short and current — it's a handoff
> note, not a history book. History goes in the session log at the bottom (newest first, one line each).

## Current state

**Phase 1 is complete** on `main` (P1-01 … P1-22, P1-11c).
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
- **EVV (P2-01)**: `POST /evv/clock-in|clock-out` (own visits, GPS geofence + agency-timezone time window → flags,
  never blocks), supervisor list/verify/reject, two-person time corrections. Patients have lat/long (entered by hand
  until geocoding). D-038.
- **Visit documentation (P2-04)**: notes (draft → sign/submit, addenda), vitals (range-checked, append-only,
  entered-in-error), task checklists (office adds, caregiver records done/not done). D-039.
- **Open shifts & swaps (P2-05)**: offer a visit (call-outs unassign), PHI-free broadcast to eligible caregivers,
  first-come claim, assign with override; swap requests to a colleague or back to the pool, supervisor-approved. D-040.
- **Real-time + jobs (P2-02)**: Socket.IO `/notifications` (live inbox) and `/live-monitor` (visit events), token-
  authenticated; `GET /evv/live` snapshot; every-minute late/no-show/missed monitor; nightly recurring extension. D-041.
- **Web live monitor & co. (P2-03)**: `/monitor` (map + live feed), `/evv` review, visit page documentation + open-
  shift offer, `/schedule/open-shifts` (offers + swap decisions), live notification bell. 17 browser tests. D-042.
- **Mandatory 2FA for admins (P1-11c)**: admins without 2FA get a setup-only session until they turn it on; web
  `/setup-two-factor` with QR code; demo admins use the published demo key (README). D-045. Owner answers: D-044.
- **Caregiver app foundation (P2-06)**: `apps/mobile` (Expo SDK 57) — sign-in with 2FA code, keychain session,
  biometric/passcode lock after 5 min in background, forced password change, today's visits. README explains running
  it on a phone with Expo Go. D-043.
- **Mobile clock-in/out (P2-07)**: visit screen with directions/call and GPS clock in/out; flags explained. D-046.
- **Mobile documentation (P2-08)**: tasks, vitals (validated on the phone), notes (submit/sign, addenda); signatures
  deferred until file storage exists. D-047.
- **Mobile offline (P2-09)**: encrypted (SQLCipher) queue + read cache; clock/tasks/vitals/notes work offline and sync
  in order; refused items shown; wiped at sign-out. D-048.
- **Clock-out reminders (P2-10)**: no background tracking (D-049, Q-009); local "remember to clock out" reminder.
- **Billing setup + authorizations (P3-01)**: payers, service codes, non-overlapping rates; authorizations with usage
  from linked visits; scheduling warns when missing/used up; web billing setup + patient panel. D-050.
- **Pre-billing QA (P3-02)**: per-visit readiness (EVV, note, authorization, rate, IDs, NPI, timely filing), units and
  amounts; `GET /billing/ready-to-bill` + web page. D-051.
- **Claims (P3-03)**: claims from ready visits (per patient + payer, frozen snapshot, never double-billed), QA re-check,
  void; web claims list/detail. D-052.
- **EDI 837P (P3-04)**: golden-tested generator, claim file preview with validation, agency settings, payer EDI IDs. D-053.
- **835 payments (P3-06)**: parser, upload (dedup, claim matching), posting (paid/partial/denied); web Payments. D-054.
- **Clinical records (P3-11)**: medications, physician orders, versioned plans of care, scored assessments; web
  panels on the patient page. D-055.
- **Documents (P3-12)**: upload (PDF/PNG/JPEG/DOCX recognised by content, 10 MB), encrypted storage behind a
  `DocumentStorage` interface (database driver until S3 + BAA), audited download with integrity check, versions,
  typed-name e-signature bound to the file hash, soft delete with a reason; web panel on the patient page. D-056.
- **Messaging (P3-13)**: staff conversations (direct + group, optionally about a patient), encrypted message text,
  unread counts, leave/re-add, urgent alerts, live `message:new` pushes (IDs only); web Messages page with unread badge;
  demo seed has two threads. D-057.
- **Patient portal (P3-14, P3-16)**: staff give a family member access from the patient page (one-time temporary
  password, reset, remove); `/portal` API limited to linked patients (profile, visits, plan of care, medications,
  documents staff chose to share, messages with office/supervisors); portal screens at `/portal` in `apps/web` with
  their own layout. Demo login `family@demo.alora.test`. D-058.
- **Private-pay invoices (P3-10)**: generate per patient for a period from billable private-pay visits, PDF, mark sent,
  record payments, void; claims refuse private-pay visits; web Billing → Invoices. Demo: one private-pay patient. D-059.
- **Eligibility (P3-07)**: 270 request builder + 271 parser (fixtures); per-patient checks on the patient page — make the
  270, download it, upload the 271 (matched by trace number). Automatic send/receive waits for the clearinghouse (P3-08). D-060.
- **837I (P3-05)**: institutional (UB-04) claims — Medicare by default, any payer can be switched; revenue codes on
  service codes; type of bill / patient status / HIPPS / CBSA per claim; golden-tested generator; preview download. D-061.
- **Compliance (P4-05)**: dashboard (credentials, incidents, EVV, overdue orders, plans ending, approvals, admin 2FA),
  incident reports (everyone reports; compliance staff resolve), daily credential-expiry alerts, audit-log search and a
  HIPAA safeguards checklist (admins). Web: Compliance, Audit log. D-062.
- **Claim follow-up (P4-06)**: mark sent (starts aging), 835 denials set an appeal deadline, multi-level appeals,
  corrected claims (frequency 7 with REF*F8), AR aging report (payers + private pay). Web: claim page, Billing → AR aging. D-063.
- **Payroll (P4-03)**: pay periods calculated from EVV-verified visits (hourly with FLSA workweek overtime, or per
  visit), approved mileage, bonuses/deductions, approval (staff notified), CSV export; staff see stubs in My pay. D-064.
- **Reports (P4-01, P4-02)**: census, visit utilization (materialized view, 15-min refresh), EVV compliance, staff
  productivity, missed visits, financial summary (billing access only); Reports page with key numbers, a visits chart
  (Recharts, validated palette, table view) and CSV downloads. D-065.
- CI (P1-22) now also runs the 13 browser tests: Postgres + migrations + API + dashboard + Playwright, seeded demo data.
- Dev environment: Neon (`alora` DB) + Upstash via git-ignored root `.env` (D-018). Other machines need the
  owner to supply `.env`.
- CI (GitHub Actions) — build/typecheck/lint/unit tests, applies migrations to a real Postgres, fails on
  schema/migration drift, runs DB e2e tests, builds the Docker image and health-checks it. All green.
- Docker does not run on the owner's laptop (D-011); CI covers the image.

- **Notification preferences (P4-07)**: per type and channel (in-app, push, SMS, email; all on by default), `notify()`
  skips muted in-app alerts, `system` alerts mandatory; web `/settings/notifications` from the bell. D-066.

- **Audit-log partitioning (P4-08)**: monthly partitions + default, DB trigger makes rows append-only (tests/seed use
  `purgeAuditLogs`), daily job creates months ahead and drops months older than `AUDIT_RETENTION_MONTHS` (≥ 72). Migration
  applied to Neon (36 rows kept). D-067, Q-011.

- **Security pass (P4-09)**: API-enforced forced password change (403 `PASSWORD_CHANGE_REQUIRED`), CSV formula
  injection guard, nonce-based CSP on the dashboard, load test script + Prisma `relationJoins` (~1.5× throughput),
  `DATABASE_POOL_SIZE`. D-068.

## In progress

**P4-22 caregiver extras — done (branch `task/P4-22-caregiver-extras-2`, PR open, not merged).** Mileage and time off in
the app, photos in messages (app + dashboard), supervisor time-off queue on Schedule → Open shifts. D-089, D-090. Build,
typecheck, lint and unit tests pass; time-off e2e (API + browser) pass; CI green on the implementation commits.
- **Open PRs waiting to merge**:
  - #7 backup restore drill: its one flaky browser test was re-run. After merging, run **Actions → Backup restore
    drill** once and add the result to the BACKUP-RESTORE.md drill log.
  - #8 Create agency workflow: will conflict with #7 in the docs, so rebase it after #7.


**Production is LIVE on Azure (D-081, D-082)** — https://app.primordialhealthservices.health (dashboard),
https://api.primordialhealthservices.health (API). Central US, resource group `primordial-prod`; deploys via
*Deploy to Azure* (manual workflow, OIDC — federated credentials for both GitHub subject formats). Agency
"Primordial Health Services" and its first admin were created with `agency:create`; the owner signed in, changed the
password and set up 2FA. The DB firewall allows only Azure services (temporary client-IP rules are removed after use).

**Caregiver app (P4-14, D-083)**: Messages tab, Open shifts, My pay are done; `eas.json` targets the production API.
The owner's next steps are in [MOBILE-RELEASE.md](MOBILE-RELEASE.md) (P4-15). Once the owner has built the app, the
screens still need checking on a real phone.

**Alerts are on** (D-087): the owner deployed `monitoring.bicep` on 2026-09-30; downtime and capacity alerts are emailed to
the owner.

**Email is live** (Azure Communication Services, D-085; first test reached Outlook's Junk folder, see D-086).

**Not connected yet**: Twilio (SMS + phone check-in), Expo push, clearinghouse, map
tiles. Owner's list: [GO_LIVE.md](GO_LIVE.md).

## Next up

- **P4-17** "Create agency" workflow (D-084), once email works (P4-16).
- Test the caregiver app on a real phone once the owner has a preview build (P4-15). Possible extras: mileage logging
  in the app (`POST /payroll/mileage` exists), time-off requests, photo attachments in messages.
- Agent work that waits on accounts: SFTP transport for claim files once a clearinghouse is chosen
(P3-09), turning on Twilio/SendGrid/Expo when keys exist, Expo push receipts. The owner's list is
[GO_LIVE.md](GO_LIVE.md).

## Blockers / waiting on human

The full owner list is **[GO_LIVE.md](GO_LIVE.md)** (accounts + BAAs, security clean-up, Virginia Medicaid set-up).

- Q-006 hosting (owner deferred; needed before P4-10). Google Maps key (owner will provide).
- Q-009 background location during visits — default is no (D-049).
- P3-08 clearinghouse account (Availity/Waystar etc.) + BAA — needed to actually submit claims.

## Session log

| Date | Agent | Task | Outcome |
|---|---|---|---|
| 2026-09-30 | Claude Code | P4-21 | Backup restore drill workflow + runbook (D-088); first drill to run after merge. |
| 2026-09-30 | Claude Code | P4-20 | Uptime/capacity alerts template (monitoring.bicep, D-087); owner runs DEPLOYMENT-AZURE §7 once. |
| 2026-09-30 | Claude Code | P4-18 | Azure email live in production; forgiving provider settings (PR #4); HTML version of every email (D-086). |
| 2026-09-29 | Claude Code | P4-18 | Azure Communication Services email provider (EMAIL_PROVIDER=azure, HMAC-signed REST); owner steps in DEPLOYMENT-AZURE §6 (D-085). |
| 2026-09-29 | Claude Code | P4-14 | Caregiver app: Messages tab, Open shifts, My pay, alert links; eas.json + store IDs (D-083); SES steps; D-084 agency onboarding plan. |
| 2026-09-29 | Claude Code | azure | Production live: first deploy green, agency + admin created, owner signed in. |
| 2026-09-29 | Claude Code | azure | Azure infra + domains + HTTPS + GitHub deploy settings done; first deploy pending (migration flag fixed). |
| 2026-09-29 | Claude Code | rename | Primordial Health on primordialhealthservices.health (D-082). |
| 2026-09-29 | Claude Code | azure | Azure hosting prepared: Bicep, deploy workflow, first-agency script (D-081). |
| 2026-09-29 | Claude Code | design | Indigo & violet redesign (web) and caregiver app tabs/profile/settings. |
| 2026-09-29 | Claude Code | P3-19b | Amazon SES email provider (SendGrid signs no BAA). |
| 2026-09-29 | Claude Code | P4-04c | Virginia options ready but off: monthly whole-hour rounding (payer), live-in UB (patient). |
| 2026-09-29 | Claude Code | P3-09a | Claim files (batch 837, control numbers, mark sent) and 999/277CA acknowledgments. |
| 2026-09-29 | Claude Code | rename | Product renamed to Kayo Health (owner). |
| 2026-09-29 | Claude Code | P4-13 | Accessibility: axe WCAG 2.1 AA checks on ~26 pages in CI; contrast fixes. |
| 2026-09-29 | Claude Code | P2-13 | Telephony EVV: signed Twilio voice webhooks, caller ID = patient home line + caregiver code. |
| 2026-09-29 | Claude Code | P3-19 | Forgot/reset password by email (single-use 30-min link in the URL fragment, neutral answers). |
| 2026-09-29 | Claude Code | P2-12 | Notification delivery outbox + SMS/email/push senders (off until keys), device registration. |
| 2026-09-29 | Claude Code | P4-10 | Production images (web, migrate), prod compose, PHI-safe nginx, TRUST_PROXY_HOPS, DEPLOYMENT.md; CI builds them. |
| 2026-09-29 | Claude Code | P4-09 | Verified Devin's forced-password-change work; CSV injection, CSP, load test + relationJoins. |
| 2026-09-28 | Devin | P4-09 (in progress) | Forced-password-change enforcement written (unverified WIP); OWASP review findings in STATUS. Owner switched to Claude Code. |
| 2026-09-28 | Devin | P4-08 | Audit-log partitions + append-only trigger + retention job; 5 unit + 3 e2e, drift check clean. |
| 2026-09-28 | Devin | P4-07 | Browser test fixed (uncontrolled checkboxes), openapi/typecheck/lint green; pushed for CI + merge. |
| 2026-09-28 | Claude Code | P4-07 (in progress) | Preferences API + page; P4-01/P4-02 merged. Owner switched to Devin. |
| 2026-09-28 | Claude Code | P4-01, P4-02 | Reports API (4 e2e) + dashboard (2 browser tests); P4-03 merged. |
| 2026-09-28 | Claude Code | P4-03 | Payroll calc (8 unit) + API (6 e2e) + web (browser test); P4-06 merged. |
| 2026-09-28 | Claude Code | P4-06 | Submit/appeal/rebill/aging API (4 e2e) + web (browser test); P4-05 merged. |
| 2026-09-28 | Claude Code | P4-05 | Compliance API (5 e2e + unit) + web (browser test); P3-05 merged. |
| 2026-09-28 | Claude Code | P3-05 | 837I generator (golden), claim format per payer, institutional fields, preview (2 e2e); P3-07 + P3-10 merged. |
| 2026-09-28 | Claude Code | P3-07 | 270/271 builder+parser (5 unit), eligibility API (4 e2e), patient panel (browser test). |
| 2026-09-28 | Claude Code | P3-10 | Private-pay invoices API (4 e2e) + PDF + web pages (browser test). P3-16 merged. |
| 2026-09-28 | Claude Code | P3-15 | Retired docs/base44-portal and the portal-only OpenAPI export. |
| 2026-09-28 | Claude Code | P3-14, P3-16 | Portal API (7 e2e) + staff access panel + portal screens (browser test); fixed login race skipping forced password change. P3-13 merged. |
| 2026-09-28 | Claude Code | P3-13 | Messaging API (7 e2e) + web page + demo threads; 25 browser tests pass. P3-12 merged. |
| 2026-09-28 | Claude Code | P3-12 | Documents API (6 e2e) + web panel (1 browser test); P3-11 merged to main. |
| 2026-09-28 | Claude Code | P3-11 | Clinical records API + web; 4 e2e + 1 browser test; 23 browser tests pass. Owner tried the app on web and phone. |
| 2026-09-28 | Claude Code | P3-06 | 835 parser + upload + posting API and web; 22 browser tests pass. |
| 2026-09-28 | Claude Code | P3-04 | 837P generator (golden file), preview endpoint, agency settings; 21 browser tests pass. |
| 2026-09-28 | Claude Code | P3-03 | Claims API + web; 3 e2e (incl. simultaneous billing) + 1 browser test; 21 browser tests pass. |
| 2026-09-28 | Claude Code | P3-02 | Pre-billing QA API + page; 6 unit + 1 e2e + 1 browser test; 20 browser tests pass. |
| 2026-09-28 | Claude Code | P3-01 | Payers/codes/rates/authorizations API + web; 4 API + 2 browser tests; 19 browser tests pass. |
| 2026-09-28 | Claude Code | P2-10 | No background tracking (Q-009); local clock-out reminders; 26 unit tests; bundles. |
| 2026-09-28 | Claude Code | P2-09 | Mobile offline queue + encrypted cache; 23 unit tests; bundles. |
| 2026-09-28 | Claude Code | P2-08 | Mobile tasks/vitals/notes screens; 17 unit tests; bundles. Signatures deferred (D-047). |
| 2026-09-28 | Claude Code | P2-07 | Mobile visit screen + GPS clock in/out; 13 unit tests; bundles. |
| 2026-09-28 | Claude Code | P2-06 | Mobile foundation (Expo 57): auth, lock, today's visits; bundles; checks green. |
| 2026-09-28 | Claude Code | P1-11c | Owner answered Q-002/3/5/8 (D-044); admin-only mandatory 2FA + web setup page (D-045). |
| 2026-09-28 | Claude Code | P2-03 | Web live monitor, EVV review, visit docs, open shifts/swaps, notification bell; 4 new browser tests. |
| 2026-09-28 | Claude Code | P2-02 | Socket.IO + live events, visit monitor + recurring jobs, /evv/live; 5 e2e tests. |
| 2026-09-28 | Claude Code | P2-05 | Open shifts + shift swaps API, 7 e2e tests (incl. simultaneous claims). |
| 2026-09-28 | Claude Code | P2-04 | Visit notes/vitals/tasks API, 5 e2e tests; demo aide checklists. |
| 2026-09-28 | Claude Code | P2-01 | EVV API (clock in/out, flags, verify, corrections), 10 e2e tests. |
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
