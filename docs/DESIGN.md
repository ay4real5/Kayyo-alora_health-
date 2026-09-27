# Design: Alora Home Health Agency Management Platform

> **Source of truth for WHAT to build.** Do not edit casually. Deviations are recorded in
> [docs/DECISIONS.md](DECISIONS.md) and unresolved problems in [docs/OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).
> Where this document and DECISIONS.md disagree, DECISIONS.md wins.

A comprehensive, HIPAA-compliant home health agency management platform covering all operational, clinical, financial, and compliance workflows. The system enables agencies to manage staff shifts & scheduling, electronic visit verification (GPS + telephony), live visit monitoring, patient EMR/EHR records, caregiver management, Medicare/Medicaid/VA/private-pay billing with EDI 837 claims, compliance reporting, and analytics — all from a unified platform with web admin dashboard (Next.js), mobile caregiver app (React Native), and patient portal (Base44).

---

## 1. Goals

- **Staff Shift Management**: Full scheduling with conflict detection, open-shift broadcasting, recurring visits, multi-discipline support, and authorization tracking
- **EVV Compliance**: GPS-based mobile clock-in/out + telephony/IVR fallback, meeting 21st Century Cures Act 6-point data capture requirements
- **Live Visit Monitoring**: Real-time supervisor dashboard showing active visits, late arrivals, no-shows, and geo-fence alerts
- **Patient EMR/EHR**: Clinical documentation including assessments (OASIS/non-OASIS), care plans (CMS-485), visit notes, medication management, and physician orders
- **Caregiver Management**: Profiles, credentials/certifications with expiry tracking, availability, skills matrix, and compliance status
- **Billing & Claims**: Multi-payer billing (Medicare, Medicaid, Managed Care, VA, Private Pay), EDI 837P/837I claim generation, ERA 835 remittance processing, eligibility verification, pre-billing QA
- **Compliance & Regulatory**: HIPAA compliance (encryption, audit logs, BAA support), EVV state mandate handling, Medicare conditions of participation
- **Mobile Caregiver App**: React Native app with offline-first documentation, EVV capture, navigation, and task management
- **Admin Web Dashboard**: Next.js admin panel for scheduling, billing, reporting, staff management, and live monitoring — full control, self-hosted, real-time Socket.IO
- **Patient Portal**: Base44-built patient/family portal for viewing care plans, visit schedules, and communicating with care team — lightweight, fast to ship
- **Document Management**: Upload, store, e-sign, and fax clinical documents
- **Notifications & Alerts**: Multi-channel (SMS, email, push, in-app) for shift reminders, missed visits, credential expiry, and compliance alerts
- **Reporting & Analytics**: Operational, clinical, financial, and compliance dashboards with exportable reports
- **Payroll Integration**: Automated pay calculation from verified visits, exportable to ADP/Gusto/QuickBooks
- **Telephony/IVR**: Twilio-powered IVR for caregiver clock-in/out in areas without smartphone access

---

## 2. Tech Stack

| Layer | Technology | Justification |
|---|---|---|
| **Backend Runtime** | Node.js 20 LTS + NestJS 10 (TypeScript) | Enterprise-grade DI framework, decorators for clean API structure, excellent TypeScript support, Guards/Interceptors for HIPAA middleware |
| **Admin Dashboard** | Next.js 14 (App Router, TypeScript) | SSR for dashboard performance, RSC for data-heavy admin views, full Socket.IO real-time support, self-hosted for HIPAA control, no vendor dependency for the core operations tool |
| **Patient Portal** | Base44 (AI web app builder) | Lightweight read-mostly portal (7 screens); consumes NestJS REST API via Custom OpenAPI integration; fast to build and iterate; patients access infrequently — no need for a full custom frontend |
| **Mobile** | React Native 0.74 + Expo SDK 51 | Cross-platform iOS/Android, Expo for OTA updates, offline SQLite via expo-sqlite, background location — required for GPS EVV, offline support, push notifications |
| **Database** | PostgreSQL 16 | JSONB for flexible clinical forms, row-level security, full-text search, HIPAA audit capability, mature ecosystem |
| **ORM** | Prisma 5 | Type-safe queries, migration management, introspection, schema-as-code |
| **Cache/Queue** | Redis 7 + BullMQ | Job queues for claims processing, EVV aggregation, notifications; caching for session/real-time data |
| **Real-time** | Socket.IO 4 | Bi-directional events for live visit monitoring, shift alerts, chat — consumed by Next.js dashboard + React Native app |
| **Auth** | JWT (access + refresh tokens) + bcrypt | Stateless auth with short-lived access tokens (15min), long-lived refresh (7d), HIPAA session timeout compliance |
| **File Storage** | AWS S3 (HIPAA-eligible) with pre-signed URLs | BAA-covered, encryption at rest (SSE-S3), versioning for clinical documents |
| **Maps/GPS** | Google Maps Platform (Geocoding + Distance Matrix) | Geo-fence validation for EVV, route optimization, address standardization |
| **SMS/Voice** | Twilio (Programmable SMS + Voice + Verify) | IVR for telephony EVV, SMS notifications, 2FA; HIPAA-eligible with BAA |
| **Email** | SendGrid (with Twilio BAA) | Transactional emails, HIPAA-eligible |
| **EDI Processing** | Custom X12 parser + clearinghouse integration (Availity/Waystar) | 837P/837I generation, 835 remittance parsing, 270/271 eligibility |
| **PDF Generation** | Puppeteer (headless Chrome) | CMS-485 forms, invoices, reports in standardized PDF format |
| **Monitoring** | Prometheus + Grafana + Sentry | Infrastructure metrics, error tracking, HIPAA audit alerting |
| **Containerization** | Docker + docker-compose | Consistent dev/prod environments, easy local bootstrap |
| **CI/CD** | GitHub Actions | Automated testing, linting, Docker builds |
| **Testing** | Jest + Supertest (backend), Playwright (e2e for Next.js), React Testing Library (dashboard), Detox (mobile) | Comprehensive coverage across all layers |

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Admin Web    │  │  Mobile App  │  │  Patient     │               │
│  │  (Next.js)    │  │  (React      │  │  Portal      │               │
│  │  Self-hosted  │  │   Native)    │  │  (Base44)    │               │
│  │  Full real-   │  │  GPS EVV     │  │  Read-mostly │               │
│  │  time via     │  │  Offline     │  │  7 screens   │               │
│  │  Socket.IO    │  │  Push notif  │  │  API-driven  │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
└─────────┼──────────────────┼──────────────────┼─────────────────────┘
          │ REST + WS         │ REST + WS         │ REST (OpenAPI)
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     API GATEWAY / LOAD BALANCER                      │
│                        (Nginx / ALB)                                 │
│              Rate Limiting · SSL Termination · CORS                  │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     NESTJS API SERVER                                 │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Middleware Layer                                            │     │
│  │  HIPAA Audit Logger · Rate Limiter · CORS · Helmet          │     │
│  └─────────────────────────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Auth Layer                                                  │     │
│  │  JWT Guard · RBAC Guard · Session Timeout · 2FA              │     │
│  └─────────────────────────────────────────────────────────────┘     │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐     │
│  │Schedule││  EVV   ││Patient ││Billing ││ Staff  ││  Doc   │     │
│  │Module  ││Module  ││Module  ││Module  ││Module  ││Module  │     │
│  └────────┘└────────┘└────────┘└────────┘└────────┘└────────┘     │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐     │
│  │Notif.  ││Report  ││Payroll ││Comply  ││IVR/Tel ││Portal  │     │
│  │Module  ││Module  ││Module  ││Module  ││Module  ││Module  │     │
│  └────────┘└────────┘└────────┘└────────┘└────────┘└────────┘     │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  WebSocket Gateway (Socket.IO)                               │     │
│  │  Live Visit Feed · Shift Alerts · Chat · Dashboard Updates   │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────┬──────────────┬──────────────┬────────────────────────────┘
           │              │              │
     ┌─────▼─────┐  ┌────▼────┐  ┌─────▼─────┐
     │PostgreSQL │  │  Redis  │  │  AWS S3   │
     │  (Primary │  │ Cache + │  │  Document │
     │   + Read  │  │ BullMQ  │  │  Storage  │
     │  Replica) │  │ Queues  │  │  (HIPAA)  │
     └───────────┘  └─────────┘  └───────────┘
           │
     ┌─────▼──────────────────────────────────┐
     │          EXTERNAL SERVICES              │
     │  ┌──────────┐  ┌───────────────────┐   │
     │  │  Twilio   │  │  EDI Clearinghouse│   │
     │  │  SMS/IVR  │  │  (Availity/       │   │
     │  │  Voice    │  │   Waystar)        │   │
     │  └──────────┘  └───────────────────┘   │
     │  ┌──────────┐  ┌───────────────────┐   │
     │  │ SendGrid │  │  Google Maps API  │   │
     │  │  Email   │  │  Geocoding/       │   │
     │  │          │  │  Distance         │   │
     │  └──────────┘  └───────────────────┘   │
     │  ┌──────────┐  ┌───────────────────┐   │
     │  │ EVV      │  │  Payroll APIs     │   │
     │  │Aggregator│  │  (ADP/Gusto)      │   │
     │  │(Sandata/ │  │                   │   │
     │  │ HHAeX)   │  │                   │   │
     │  └──────────┘  └───────────────────┘   │
     └────────────────────────────────────────┘
```

### 3.2 Architecture Split Rationale

| Criterion | Admin Dashboard (Next.js) | Patient Portal (Base44) |
|-----------|--------------------------|------------------------|
| **Users** | Staff: admins, supervisors, billers, schedulers (power users, 8hr/day) | Patients/families (casual users, 1-2x/week) |
| **Complexity** | High — drag-drop scheduling, live EVV map, claims workflows, data tables with inline edit | Low — 7 read-mostly screens (visits, care plan, meds, docs, messages) |
| **Real-time** | Required — Socket.IO live visit monitor, shift alerts, messaging | Not needed — patients check visits periodically |
| **PHI Exposure** | Heavy — full patient records, billing, clinical notes | Limited — patient's own data only (scoped by portal_user role) |
| **HIPAA Control** | Full — self-hosted, your infrastructure, your BAA chain | Minimal risk — limited PHI scope, API-enforced access control |
| **Build Effort** | ~60% of total frontend effort | ~5% of total frontend effort (Base44 ships this in days) |
| **Vendor Risk** | None — you own the code | Low — if Base44 goes away, rebuild 7 simple screens in Next.js in a week |

### 3.3 Base44 Patient Portal — Integration Architecture

```
┌───────────────────────────────────────────────────┐
│              BASE44 PLATFORM                       │
│                                                     │
│  ┌─────────────────────────────────────┐           │
│  │  Patient Portal (Base44 Project)    │           │
│  │                                     │           │
│  │  • Login page                       │           │
│  │  • Dashboard (upcoming visits)      │           │
│  │  • Visit Schedule                   │           │
│  │  • Care Plan View                   │           │
│  │  • Medications List                 │           │
│  │  • Documents                        │           │
│  │  • Messages                         │           │
│  │  • Profile                          │           │
│  └──────────┬──────────────────────────┘           │
│             │                                       │
│  ┌──────────▼──────────────────────────┐           │
│  │  Custom OpenAPI Integration         │           │
│  │  • Imported from NestJS Swagger     │           │
│  │  • Scoped to /api/v1/portal/* only  │           │
│  │  • JWT Bearer auth via Secrets      │           │
│  │  • Proxied through Base44 backend   │           │
│  └──────────┬──────────────────────────┘           │
└─────────────┼──────────────────────────────────────┘
              │ HTTPS
              ▼
┌─────────────────────────────────────────────────────┐
│  NESTJS API SERVER                                   │
│  Portal endpoints only:                              │
│  GET /portal/profile                                 │
│  GET /portal/visits                                  │
│  GET /portal/care-plan                               │
│  GET /portal/medications                             │
│  GET /portal/documents                               │
│  GET /portal/messages + POST /portal/messages        │
│                                                       │
│  Auth: JWT with portal_user role                     │
│  RBAC: Portal guard restricts to own patient data    │
│  Audit: All PHI access logged                        │
└─────────────────────────────────────────────────────┘
```

**How it works:**
1. Export NestJS OpenAPI spec (Swagger JSON from `/api/v1/docs-json`)
2. Import into Base44 workspace as Custom OpenAPI Integration — scope to portal endpoints only
3. Base44 backend function handles login: calls `POST /auth/login`, stores JWT in Base44 Secrets
4. Each Base44 page calls the relevant portal endpoint via the OpenAPI integration
5. NestJS enforces `portal_user` role — patient can only see their own data
6. Custom domain: `portal.youragency.com` with SSL

**Patient Portal screen inventory:**

| Screen | API Endpoint | Notes |
|--------|-------------|-------|
| Login | `POST /auth/login` | portal_user role |
| Dashboard | `GET /portal/visits`, `GET /portal/care-plan` | Summary cards |
| Visit Schedule | `GET /portal/visits` | Upcoming + past visits list |
| Care Plan | `GET /portal/care-plan` | Read-only CMS-485 view |
| Medications | `GET /portal/medications` | Active medication list |
| Documents | `GET /portal/documents` | Download via pre-signed URLs |
| Messages | `GET /portal/messages`, `POST /portal/messages` | Secure messaging with care team |
| Profile | `GET /portal/profile` | Demographics view |

### 3.4 Module Communication

All modules are NestJS modules within a single deployable monolith (modular monolith pattern). Inter-module communication uses direct service injection. This simplifies deployment for v1 while maintaining clean boundaries for future microservice extraction.

**Background Job Processing (BullMQ Queues):**
- `claims-queue`: EDI 837 generation, submission, status polling
- `notification-queue`: SMS, email, push delivery with retry
- `evv-aggregator-queue`: Batch EVV data transmission to state aggregators
- `report-queue`: Async report generation (large datasets)
- `payroll-queue`: Pay period calculation and export generation
- `document-queue`: PDF generation, fax transmission

**Real-time Events (Socket.IO):**
- `visit:started`, `visit:completed`, `visit:late`, `visit:noshow` → Live Monitor (Next.js dashboard)
- `shift:assigned`, `shift:updated`, `shift:open` → Caregiver notifications (mobile app)
- `alert:credential-expiry`, `alert:auth-limit` → Admin alerts (Next.js dashboard)
- `message:new` → Secure messaging (Next.js dashboard + mobile app)

---

## 4. Monorepo Folder Structure

```
alora-health/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint, test, build
│       ├── deploy-staging.yml
│       └── deploy-production.yml
├── docker/
│   ├── Dockerfile.api               # NestJS backend
│   ├── Dockerfile.web               # Next.js admin dashboard
│   └── nginx.conf                   # Reverse proxy config
├── docker-compose.yml               # Full local stack
├── docker-compose.prod.yml
├── packages/
│   └── shared/                      # Shared TypeScript types & utilities
│       ├── src/
│       │   ├── types/
│       │   │   ├── index.ts
│       │   │   ├── auth.types.ts        # User, Role, Permission types
│       │   │   ├── patient.types.ts
│       │   │   ├── staff.types.ts
│       │   │   ├── schedule.types.ts
│       │   │   ├── evv.types.ts
│       │   │   ├── billing.types.ts
│       │   │   ├── claims.types.ts
│       │   │   ├── document.types.ts
│       │   │   └── notification.types.ts
│       │   ├── constants/
│       │   │   ├── roles.ts             # RBAC role definitions
│       │   │   ├── permissions.ts       # Permission constants
│       │   │   ├── evv-states.ts        # State EVV mandate configs
│       │   │   ├── billing-codes.ts     # HCPCS, revenue codes
│       │   │   └── claim-status.ts
│       │   ├── validators/
│       │   │   ├── npi.validator.ts     # National Provider Identifier
│       │   │   ├── phone.validator.ts
│       │   │   └── ssn.validator.ts
│       │   └── utils/
│       │       ├── date.utils.ts
│       │       ├── encryption.utils.ts
│       │       └── edi.utils.ts
│       ├── package.json
│       └── tsconfig.json
├── apps/
│   ├── api/                          # NestJS Backend
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── decorators/
│   │   │   │   │   ├── roles.decorator.ts
│   │   │   │   │   ├── permissions.decorator.ts
│   │   │   │   │   ├── current-user.decorator.ts
│   │   │   │   │   └── audit-log.decorator.ts
│   │   │   │   ├── guards/
│   │   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   │   ├── rbac.guard.ts
│   │   │   │   │   ├── hipaa-session.guard.ts
│   │   │   │   │   └── rate-limit.guard.ts
│   │   │   │   ├── interceptors/
│   │   │   │   │   ├── audit-log.interceptor.ts
│   │   │   │   │   ├── transform.interceptor.ts
│   │   │   │   │   └── timeout.interceptor.ts
│   │   │   │   ├── filters/
│   │   │   │   │   └── http-exception.filter.ts
│   │   │   │   ├── pipes/
│   │   │   │   │   └── validation.pipe.ts
│   │   │   │   ├── middleware/
│   │   │   │   │   ├── hipaa-audit.middleware.ts
│   │   │   │   │   └── correlation-id.middleware.ts
│   │   │   │   └── dto/
│   │   │   │       └── pagination.dto.ts
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.module.ts
│   │   │   │   │   ├── auth.controller.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── strategies/
│   │   │   │   │   │   ├── jwt.strategy.ts
│   │   │   │   │   │   └── refresh-token.strategy.ts
│   │   │   │   │   └── dto/
│   │   │   │   │       ├── login.dto.ts
│   │   │   │   │       ├── register.dto.ts
│   │   │   │   │       └── refresh-token.dto.ts
│   │   │   │   ├── users/
│   │   │   │   │   ├── users.module.ts
│   │   │   │   │   ├── users.controller.ts
│   │   │   │   │   ├── users.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── patients/
│   │   │   │   │   ├── patients.module.ts
│   │   │   │   │   ├── patients.controller.ts
│   │   │   │   │   ├── patients.service.ts
│   │   │   │   │   ├── assessments.controller.ts
│   │   │   │   │   ├── assessments.service.ts
│   │   │   │   │   ├── care-plans.controller.ts
│   │   │   │   │   ├── care-plans.service.ts
│   │   │   │   │   ├── medications.controller.ts
│   │   │   │   │   ├── medications.service.ts
│   │   │   │   │   ├── physician-orders.controller.ts
│   │   │   │   │   ├── physician-orders.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── staff/
│   │   │   │   │   ├── staff.module.ts
│   │   │   │   │   ├── staff.controller.ts
│   │   │   │   │   ├── staff.service.ts
│   │   │   │   │   ├── credentials.controller.ts
│   │   │   │   │   ├── credentials.service.ts
│   │   │   │   │   ├── availability.controller.ts
│   │   │   │   │   ├── availability.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── scheduling/
│   │   │   │   │   ├── scheduling.module.ts
│   │   │   │   │   ├── scheduling.controller.ts
│   │   │   │   │   ├── scheduling.service.ts
│   │   │   │   │   ├── shifts.controller.ts
│   │   │   │   │   ├── shifts.service.ts
│   │   │   │   │   ├── open-shifts.controller.ts
│   │   │   │   │   ├── open-shifts.service.ts
│   │   │   │   │   ├── recurring-visits.service.ts
│   │   │   │   │   ├── conflict-detector.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── evv/
│   │   │   │   │   ├── evv.module.ts
│   │   │   │   │   ├── evv.controller.ts
│   │   │   │   │   ├── evv.service.ts
│   │   │   │   │   ├── evv-telephony.service.ts
│   │   │   │   │   ├── evv-gps.service.ts
│   │   │   │   │   ├── evv-aggregator.service.ts
│   │   │   │   │   ├── live-monitor.gateway.ts      # Socket.IO gateway
│   │   │   │   │   └── dto/
│   │   │   │   ├── billing/
│   │   │   │   │   ├── billing.module.ts
│   │   │   │   │   ├── billing.controller.ts
│   │   │   │   │   ├── billing.service.ts
│   │   │   │   │   ├── claims.controller.ts
│   │   │   │   │   ├── claims.service.ts
│   │   │   │   │   ├── edi/
│   │   │   │   │   │   ├── edi-837.generator.ts
│   │   │   │   │   │   ├── edi-835.parser.ts
│   │   │   │   │   │   ├── edi-270.generator.ts
│   │   │   │   │   │   ├── edi-271.parser.ts
│   │   │   │   │   │   └── x12.utils.ts
│   │   │   │   │   ├── eligibility.controller.ts
│   │   │   │   │   ├── eligibility.service.ts
│   │   │   │   │   ├── invoices.controller.ts
│   │   │   │   │   ├── invoices.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── payroll/
│   │   │   │   │   ├── payroll.module.ts
│   │   │   │   │   ├── payroll.controller.ts
│   │   │   │   │   ├── payroll.service.ts
│   │   │   │   │   ├── pay-rules.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── documents/
│   │   │   │   │   ├── documents.module.ts
│   │   │   │   │   ├── documents.controller.ts
│   │   │   │   │   ├── documents.service.ts
│   │   │   │   │   ├── esign.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── notifications/
│   │   │   │   │   ├── notifications.module.ts
│   │   │   │   │   ├── notifications.controller.ts
│   │   │   │   │   ├── notifications.service.ts
│   │   │   │   │   ├── channels/
│   │   │   │   │   │   ├── sms.channel.ts
│   │   │   │   │   │   ├── email.channel.ts
│   │   │   │   │   │   ├── push.channel.ts
│   │   │   │   │   │   └── in-app.channel.ts
│   │   │   │   │   ├── templates/
│   │   │   │   │   │   ├── shift-reminder.template.ts
│   │   │   │   │   │   ├── missed-visit.template.ts
│   │   │   │   │   │   └── credential-expiry.template.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── reports/
│   │   │   │   │   ├── reports.module.ts
│   │   │   │   │   ├── reports.controller.ts
│   │   │   │   │   ├── reports.service.ts
│   │   │   │   │   ├── generators/
│   │   │   │   │   │   ├── census.report.ts
│   │   │   │   │   │   ├── financial.report.ts
│   │   │   │   │   │   ├── visit-utilization.report.ts
│   │   │   │   │   │   ├── evv-compliance.report.ts
│   │   │   │   │   │   └── staff-productivity.report.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── compliance/
│   │   │   │   │   ├── compliance.module.ts
│   │   │   │   │   ├── compliance.controller.ts
│   │   │   │   │   ├── compliance.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── telephony/
│   │   │   │   │   ├── telephony.module.ts
│   │   │   │   │   ├── telephony.controller.ts  # Twilio webhooks
│   │   │   │   │   ├── telephony.service.ts
│   │   │   │   │   ├── ivr-flow.service.ts
│   │   │   │   │   └── twiml/
│   │   │   │   │       ├── clock-in.twiml.ts
│   │   │   │   │       └── clock-out.twiml.ts
│   │   │   │   ├── portal/
│   │   │   │   │   ├── portal.module.ts
│   │   │   │   │   ├── portal.controller.ts
│   │   │   │   │   └── portal.service.ts
│   │   │   │   └── messaging/
│   │   │   │       ├── messaging.module.ts
│   │   │   │       ├── messaging.controller.ts
│   │   │   │       ├── messaging.service.ts
│   │   │   │       └── messaging.gateway.ts     # Socket.IO
│   │   │   └── config/
│   │   │       ├── database.config.ts
│   │   │       ├── redis.config.ts
│   │   │       ├── jwt.config.ts
│   │   │       ├── s3.config.ts
│   │   │       ├── twilio.config.ts
│   │   │       └── google-maps.config.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── test/
│   │   │   ├── e2e/
│   │   │   └── unit/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/                          # Next.js Admin Dashboard (self-hosted)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx              # Dashboard home
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   └── forgot-password/page.tsx
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── scheduling/
│   │   │   │   │   ├── page.tsx          # Calendar view
│   │   │   │   │   ├── shifts/page.tsx
│   │   │   │   │   └── open-shifts/page.tsx
│   │   │   │   ├── patients/
│   │   │   │   │   ├── page.tsx          # Patient list
│   │   │   │   │   ├── [id]/page.tsx     # Patient detail
│   │   │   │   │   ├── [id]/assessments/page.tsx
│   │   │   │   │   ├── [id]/care-plan/page.tsx
│   │   │   │   │   ├── [id]/medications/page.tsx
│   │   │   │   │   ├── [id]/visits/page.tsx
│   │   │   │   │   └── [id]/documents/page.tsx
│   │   │   │   ├── staff/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── [id]/page.tsx
│   │   │   │   │   ├── [id]/credentials/page.tsx
│   │   │   │   │   ├── [id]/schedule/page.tsx
│   │   │   │   │   └── [id]/payroll/page.tsx
│   │   │   │   ├── evv/
│   │   │   │   │   ├── live-monitor/page.tsx
│   │   │   │   │   └── history/page.tsx
│   │   │   │   ├── billing/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── claims/page.tsx
│   │   │   │   │   ├── invoices/page.tsx
│   │   │   │   │   ├── eligibility/page.tsx
│   │   │   │   │   └── payments/page.tsx
│   │   │   │   ├── payroll/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   └── pay-periods/page.tsx
│   │   │   │   ├── reports/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   └── [reportType]/page.tsx
│   │   │   │   ├── compliance/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── documents/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── messages/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── settings/
│   │   │   │       ├── page.tsx
│   │   │   │       ├── agency/page.tsx
│   │   │   │       ├── users/page.tsx
│   │   │   │       ├── roles/page.tsx
│   │   │   │       ├── payers/page.tsx
│   │   │   │       └── service-codes/page.tsx
│   │   │   ├── components/
│   │   │   │   ├── ui/                  # shadcn/ui primitives
│   │   │   │   ├── layout/
│   │   │   │   │   ├── Sidebar.tsx
│   │   │   │   │   ├── Header.tsx
│   │   │   │   │   └── Breadcrumbs.tsx
│   │   │   │   ├── scheduling/
│   │   │   │   │   ├── CalendarView.tsx
│   │   │   │   │   ├── ShiftCard.tsx
│   │   │   │   │   ├── ShiftForm.tsx
│   │   │   │   │   └── OpenShiftBoard.tsx
│   │   │   │   ├── patients/
│   │   │   │   ├── staff/
│   │   │   │   ├── evv/
│   │   │   │   │   ├── LiveMonitorMap.tsx
│   │   │   │   │   ├── VisitCard.tsx
│   │   │   │   │   └── EVVTimeline.tsx
│   │   │   │   ├── billing/
│   │   │   │   └── reports/
│   │   │   ├── hooks/
│   │   │   │   ├── useAuth.ts
│   │   │   │   ├── useSocket.ts
│   │   │   │   ├── usePatients.ts
│   │   │   │   └── useSchedule.ts
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts        # Axios instance with auth
│   │   │   │   ├── socket-client.ts
│   │   │   │   └── utils.ts
│   │   │   └── stores/
│   │   │       ├── auth.store.ts        # Zustand
│   │   │       └── ui.store.ts
│   │   ├── public/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── mobile/                       # React Native Caregiver App
│       ├── app/
│       │   ├── _layout.tsx              # Expo Router root layout
│       │   ├── (auth)/
│       │   │   ├── login.tsx
│       │   │   └── pin.tsx              # Quick PIN unlock
│       │   ├── (tabs)/
│       │   │   ├── _layout.tsx
│       │   │   ├── schedule.tsx         # Today's visits
│       │   │   ├── patients.tsx         # Assigned patients
│       │   │   ├── messages.tsx
│       │   │   └── profile.tsx
│       │   ├── visit/
│       │   │   ├── [id]/index.tsx       # Visit detail
│       │   │   ├── [id]/clock-in.tsx    # EVV clock-in
│       │   │   ├── [id]/tasks.tsx       # Visit tasks/checklist
│       │   │   ├── [id]/notes.tsx       # Visit documentation
│       │   │   ├── [id]/vitals.tsx      # Vital signs entry
│       │   │   └── [id]/clock-out.tsx   # EVV clock-out
│       │   ├── patient/
│       │   │   └── [id]/index.tsx
│       │   └── notifications.tsx
│       ├── components/
│       │   ├── EVVClockButton.tsx
│       │   ├── VisitCard.tsx
│       │   ├── VitalsForm.tsx
│       │   ├── TaskChecklist.tsx
│       │   ├── SignaturePad.tsx
│       │   └── OfflineBanner.tsx
│       ├── services/
│       │   ├── api.service.ts
│       │   ├── offline-sync.service.ts
│       │   ├── location.service.ts
│       │   └── notification.service.ts
│       ├── stores/
│       │   ├── auth.store.ts
│       │   ├── visit.store.ts
│       │   └── offline.store.ts
│       ├── utils/
│       │   └── offline-db.ts            # expo-sqlite wrapper
│       ├── app.json
│       └── package.json
├── docs/
│   └── base44-portal/                # Base44 patient portal documentation
│       ├── portal-screens.md         # Screen inventory, prompt guides for Base44
│       ├── openapi-portal-spec.json  # Filtered OpenAPI spec (portal endpoints only)
│       └── integration-notes.md      # Auth flow, secrets config, custom domain setup
├── AGENTS.md                         # Architecture conventions for Claude Code
├── CONTRIBUTING.md
├── package.json                      # Workspace root (npm workspaces)
├── turbo.json                        # Turborepo config
├── tsconfig.base.json
├── .env.example
├── .eslintrc.js
├── .prettierrc
└── README.md
```


---

## 5. Database Schema

### 5.1 Agency & Auth Tables

```sql
-- Multi-tenant agency table
CREATE TABLE agencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    npi             VARCHAR(10) UNIQUE,           -- National Provider Identifier
    tax_id          VARCHAR(20),                  -- EIN encrypted
    phone           VARCHAR(20),
    fax             VARCHAR(20),
    email           VARCHAR(255),
    address_line1   VARCHAR(255),
    address_line2   VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(2),
    zip             VARCHAR(10),
    timezone        VARCHAR(50) DEFAULT 'America/New_York',
    medicare_provider_number VARCHAR(20),
    medicaid_provider_number VARCHAR(20),
    evv_state_config JSONB,                       -- State-specific EVV rules
    settings        JSONB DEFAULT '{}',           -- Agency-level settings
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Users (all roles: admin, nurse, caregiver, billing, etc.)
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    phone           VARCHAR(20),
    role            VARCHAR(50) NOT NULL,          -- admin, supervisor, nurse, caregiver, billing_staff, office_staff
    is_active       BOOLEAN DEFAULT true,
    is_2fa_enabled  BOOLEAN DEFAULT false,
    two_fa_secret   VARCHAR(255),                 -- TOTP secret, encrypted
    last_login_at   TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    failed_login_attempts INT DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    pin_hash        VARCHAR(255),                 -- Mobile quick-unlock PIN
    push_token      TEXT,                         -- FCM/APNs token
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agency_id, email)
);
CREATE INDEX idx_users_agency ON users(agency_id);
CREATE INDEX idx_users_role ON users(agency_id, role);

-- Role permissions (RBAC)
CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    name            VARCHAR(50) NOT NULL,
    description     TEXT,
    is_system       BOOLEAN DEFAULT false,         -- Built-in roles can't be deleted
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource        VARCHAR(100) NOT NULL,         -- patients, staff, billing, evv, etc.
    action          VARCHAR(50) NOT NULL,           -- create, read, update, delete, approve, export
    description     TEXT,
    UNIQUE(resource, action)
);

CREATE TABLE role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Refresh tokens (for JWT rotation)
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    device_info     VARCHAR(255),
    ip_address      INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- HIPAA audit log (append-only, never deleted)
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    agency_id       UUID NOT NULL,
    user_id         UUID,
    action          VARCHAR(100) NOT NULL,         -- LOGIN, VIEW_PATIENT, UPDATE_RECORD, EXPORT_DATA, etc.
    resource_type   VARCHAR(100),                  -- patients, visits, claims, etc.
    resource_id     UUID,
    details         JSONB,                         -- Request body (PHI redacted), IP, user-agent
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_agency_date ON audit_logs(agency_id, created_at);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
```

### 5.2 Patient / Clinical Tables

```sql
-- Patients
CREATE TABLE patients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    mrn             VARCHAR(50),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    date_of_birth   DATE NOT NULL,
    gender          VARCHAR(10),
    ssn_encrypted   BYTEA,                        -- AES-256 encrypted
    phone_home      VARCHAR(20),
    phone_cell      VARCHAR(20),
    email           VARCHAR(255),
    address_line1   VARCHAR(255),
    address_line2   VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(2),
    zip             VARCHAR(10),
    latitude        DECIMAL(10,8),
    longitude       DECIMAL(11,8),
    geo_fence_radius_meters INT DEFAULT 200,
    emergency_contact_name  VARCHAR(200),
    emergency_contact_phone VARCHAR(20),
    emergency_contact_relation VARCHAR(50),
    primary_physician_id UUID REFERENCES physicians(id),
    primary_diagnosis_code VARCHAR(10),
    admission_date  DATE,
    discharge_date  DATE,
    status          VARCHAR(20) DEFAULT 'active',
    payer_primary_id UUID REFERENCES payers(id),
    payer_secondary_id UUID REFERENCES payers(id),
    insurance_member_id VARCHAR(50),
    insurance_group_number VARCHAR(50),
    medicare_beneficiary_id VARCHAR(20),
    medicaid_id     VARCHAR(20),
    authorization_id UUID,
    notes           TEXT,
    portal_user_id  UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_patients_agency ON patients(agency_id);
CREATE INDEX idx_patients_status ON patients(agency_id, status);
CREATE INDEX idx_patients_name ON patients(agency_id, last_name, first_name);

-- Physicians
CREATE TABLE physicians (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    npi             VARCHAR(10),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    phone           VARCHAR(20),
    fax             VARCHAR(20),
    email           VARCHAR(255),
    practice_name   VARCHAR(255),
    address_line1   VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(2),
    zip             VARCHAR(10),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Patient diagnoses (ICD-10)
CREATE TABLE patient_diagnoses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    icd10_code      VARCHAR(10) NOT NULL,
    description     TEXT,
    is_primary      BOOLEAN DEFAULT false,
    sequence_order  INT DEFAULT 1,
    onset_date      DATE,
    resolved_date   DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_diagnoses_patient ON patient_diagnoses(patient_id);

-- Care Plans (CMS-485 equivalent)
CREATE TABLE care_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    physician_id    UUID REFERENCES physicians(id),
    certification_period_start DATE NOT NULL,
    certification_period_end DATE NOT NULL,
    status          VARCHAR(20) DEFAULT 'draft',
    goals           JSONB,
    interventions   JSONB,
    disciplines_required JSONB,
    visit_frequency JSONB,
    physician_signature_date DATE,
    signed_by       UUID REFERENCES users(id),
    version         INT DEFAULT 1,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_care_plans_patient ON care_plans(patient_id);

-- Assessments (OASIS, Braden, Fall Risk, etc.)
CREATE TABLE assessments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    visit_id        UUID REFERENCES visits(id),
    assessor_id     UUID NOT NULL REFERENCES users(id),
    type            VARCHAR(50) NOT NULL,
    status          VARCHAR(20) DEFAULT 'draft',
    data            JSONB NOT NULL,
    score           DECIMAL(8,2),
    qa_reviewed_by  UUID REFERENCES users(id),
    qa_reviewed_at  TIMESTAMPTZ,
    qa_notes        TEXT,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_assessments_patient ON assessments(patient_id);
CREATE INDEX idx_assessments_type ON assessments(patient_id, type);

-- Medications
CREATE TABLE medications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    drug_name       VARCHAR(255) NOT NULL,
    ndc_code        VARCHAR(20),
    dosage          VARCHAR(100),
    frequency       VARCHAR(100),
    route           VARCHAR(50),
    prescribing_physician_id UUID REFERENCES physicians(id),
    start_date      DATE,
    end_date        DATE,
    is_active       BOOLEAN DEFAULT true,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_medications_patient ON medications(patient_id);

-- Physician Orders
CREATE TABLE physician_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    physician_id    UUID REFERENCES physicians(id),
    order_type      VARCHAR(50) NOT NULL,
    description     TEXT NOT NULL,
    status          VARCHAR(20) DEFAULT 'pending',
    ordered_date    DATE NOT NULL,
    signed_date     DATE,
    effective_date  DATE,
    expiry_date     DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_orders_patient ON physician_orders(patient_id);

-- Allergies
CREATE TABLE patient_allergies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    allergen        VARCHAR(255) NOT NULL,
    reaction        TEXT,
    severity        VARCHAR(20),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.3 Staff & Credential Tables

```sql
-- Staff profiles (extends users table)
CREATE TABLE staff_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    employee_id     VARCHAR(50),
    discipline      VARCHAR(20) NOT NULL,
    hire_date       DATE,
    termination_date DATE,
    employment_type VARCHAR(20) DEFAULT 'full_time',
    hourly_rate     DECIMAL(10,2),
    per_visit_rate  DECIMAL(10,2),
    overtime_rate   DECIMAL(10,2),
    mileage_rate    DECIMAL(6,4),
    ssn_encrypted   BYTEA,
    tax_filing_status VARCHAR(20),
    address_line1   VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(2),
    zip             VARCHAR(10),
    service_area_zip_codes TEXT[],
    max_patients    INT,
    skills          TEXT[],
    languages       TEXT[],
    notes           TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_staff_agency ON staff_profiles(agency_id);
CREATE INDEX idx_staff_discipline ON staff_profiles(agency_id, discipline);

-- Staff credentials / certifications
CREATE TABLE staff_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    credential_type VARCHAR(100) NOT NULL,
    credential_name VARCHAR(255) NOT NULL,
    credential_number VARCHAR(100),
    issuing_authority VARCHAR(255),
    issue_date      DATE,
    expiry_date     DATE,
    status          VARCHAR(20) DEFAULT 'active',
    document_id     UUID REFERENCES documents(id),
    alert_days_before INT DEFAULT 30,
    verified_by     UUID REFERENCES users(id),
    verified_at     TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_credentials_staff ON staff_credentials(staff_profile_id);
CREATE INDEX idx_credentials_expiry ON staff_credentials(expiry_date);

-- Staff availability
CREATE TABLE staff_availability (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    is_available    BOOLEAN DEFAULT true,
    effective_date  DATE,
    end_date        DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_availability_staff ON staff_availability(staff_profile_id);

-- Staff time-off requests
CREATE TABLE staff_time_off (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    type            VARCHAR(20) NOT NULL,
    status          VARCHAR(20) DEFAULT 'pending',
    approved_by     UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.4 Scheduling & Shift Tables

```sql
-- Visits (scheduled patient visits)
CREATE TABLE visits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    staff_id        UUID REFERENCES staff_profiles(id),
    authorization_id UUID REFERENCES authorizations(id),
    visit_type      VARCHAR(50) NOT NULL,
    service_code    VARCHAR(20),
    status          VARCHAR(20) DEFAULT 'scheduled',
    scheduled_date  DATE NOT NULL,
    scheduled_start TIME NOT NULL,
    scheduled_end   TIME NOT NULL,
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,
    is_recurring    BOOLEAN DEFAULT false,
    recurrence_rule_id UUID REFERENCES recurrence_rules(id),
    notes           TEXT,
    cancel_reason   TEXT,
    missed_reason   TEXT,
    priority        VARCHAR(10) DEFAULT 'normal',
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_visits_agency_date ON visits(agency_id, scheduled_date);
CREATE INDEX idx_visits_patient ON visits(patient_id, scheduled_date);
CREATE INDEX idx_visits_staff ON visits(staff_id, scheduled_date);
CREATE INDEX idx_visits_status ON visits(agency_id, status, scheduled_date);

-- Visit documentation (clinical notes per visit)
CREATE TABLE visit_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id        UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    staff_id        UUID NOT NULL REFERENCES staff_profiles(id),
    note_type       VARCHAR(50) NOT NULL,
    subjective      TEXT,
    objective       TEXT,
    assessment      TEXT,
    plan            TEXT,
    narrative       TEXT,
    form_data       JSONB,
    status          VARCHAR(20) DEFAULT 'draft',
    signed_at       TIMESTAMPTZ,
    signed_by       UUID REFERENCES users(id),
    qa_reviewed_by  UUID REFERENCES users(id),
    qa_reviewed_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_visit_notes_visit ON visit_notes(visit_id);

-- Visit vitals
CREATE TABLE visit_vitals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id        UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    blood_pressure_systolic INT,
    blood_pressure_diastolic INT,
    heart_rate      INT,
    respiratory_rate INT,
    temperature     DECIMAL(5,2),
    temperature_unit VARCHAR(1) DEFAULT 'F',
    oxygen_saturation DECIMAL(5,2),
    weight          DECIMAL(6,2),
    weight_unit     VARCHAR(3) DEFAULT 'lbs',
    pain_level      INT,
    blood_glucose   INT,
    notes           TEXT,
    recorded_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vitals_visit ON visit_vitals(visit_id);

-- Visit tasks (checklist items per visit)
CREATE TABLE visit_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id        UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    task_name       VARCHAR(255) NOT NULL,
    description     TEXT,
    is_completed    BOOLEAN DEFAULT false,
    completed_at    TIMESTAMPTZ,
    sort_order      INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Recurrence rules for recurring visits
CREATE TABLE recurrence_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    staff_id        UUID REFERENCES staff_profiles(id),
    visit_type      VARCHAR(50) NOT NULL,
    service_code    VARCHAR(20),
    frequency       VARCHAR(20) NOT NULL,
    days_of_week    SMALLINT[],
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE,
    max_occurrences INT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Open shifts (unassigned, broadcast to available staff)
CREATE TABLE open_shifts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    visit_id        UUID REFERENCES visits(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    visit_type      VARCHAR(50) NOT NULL,
    required_discipline VARCHAR(20) NOT NULL,
    required_skills TEXT[],
    scheduled_date  DATE NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    status          VARCHAR(20) DEFAULT 'open',
    claimed_by      UUID REFERENCES staff_profiles(id),
    claimed_at      TIMESTAMPTZ,
    assigned_by     UUID REFERENCES users(id),
    notes           TEXT,
    broadcast_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_open_shifts_agency ON open_shifts(agency_id, status, scheduled_date);

-- Shift swap requests
CREATE TABLE shift_swap_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id        UUID NOT NULL REFERENCES visits(id),
    requesting_staff_id UUID NOT NULL REFERENCES staff_profiles(id),
    target_staff_id UUID REFERENCES staff_profiles(id),
    status          VARCHAR(20) DEFAULT 'pending',
    reason          TEXT,
    approved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Patient service authorizations
CREATE TABLE authorizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    payer_id        UUID NOT NULL REFERENCES payers(id),
    authorization_number VARCHAR(50),
    service_code    VARCHAR(20),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    authorized_visits INT,
    used_visits     INT DEFAULT 0,
    authorized_hours DECIMAL(8,2),
    used_hours      DECIMAL(8,2) DEFAULT 0,
    status          VARCHAR(20) DEFAULT 'active',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_authorizations_patient ON authorizations(patient_id);
CREATE INDEX idx_authorizations_expiry ON authorizations(end_date);
```

### 5.5 EVV Tables

```sql
-- EVV records (one per visit clock-in/clock-out)
CREATE TABLE evv_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id        UUID NOT NULL REFERENCES visits(id),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    staff_id        UUID NOT NULL REFERENCES staff_profiles(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    -- 21st Century Cures Act 6-point data:
    service_type    VARCHAR(50) NOT NULL,
    service_date    DATE NOT NULL,
    clock_in_time   TIMESTAMPTZ,
    clock_out_time  TIMESTAMPTZ,
    clock_in_method VARCHAR(20) NOT NULL,
    clock_out_method VARCHAR(20),
    clock_in_latitude  DECIMAL(10,8),
    clock_in_longitude DECIMAL(11,8),
    clock_out_latitude DECIMAL(10,8),
    clock_out_longitude DECIMAL(11,8),
    clock_in_phone_number VARCHAR(20),
    clock_out_phone_number VARCHAR(20),
    clock_in_address TEXT,
    clock_out_address TEXT,
    clock_in_within_geofence BOOLEAN,
    clock_out_within_geofence BOOLEAN,
    clock_in_distance_meters INT,
    clock_out_distance_meters INT,
    patient_signature_url VARCHAR(500),
    caregiver_signature_url VARCHAR(500),
    status          VARCHAR(20) DEFAULT 'pending',
    exception_reason TEXT,
    verified_by     UUID REFERENCES users(id),
    verified_at     TIMESTAMPTZ,
    aggregator_submitted_at TIMESTAMPTZ,
    aggregator_confirmation_id VARCHAR(100),
    aggregator_status VARCHAR(20),
    device_id       VARCHAR(100),
    device_model    VARCHAR(100),
    app_version     VARCHAR(20),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_evv_agency_date ON evv_records(agency_id, service_date);
CREATE INDEX idx_evv_visit ON evv_records(visit_id);
CREATE INDEX idx_evv_staff ON evv_records(staff_id, service_date);
CREATE INDEX idx_evv_status ON evv_records(agency_id, status);

-- EVV exceptions (manual overrides and explanations)
CREATE TABLE evv_exceptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evv_record_id   UUID NOT NULL REFERENCES evv_records(id) ON DELETE CASCADE,
    exception_type  VARCHAR(50) NOT NULL,
    original_value  TEXT,
    corrected_value TEXT,
    reason          TEXT NOT NULL,
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    status          VARCHAR(20) DEFAULT 'pending',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.6 Billing & Claims Tables

```sql
-- Payers (insurance companies, Medicare, Medicaid, etc.)
CREATE TABLE payers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    name            VARCHAR(255) NOT NULL,
    payer_type      VARCHAR(30) NOT NULL,
    payer_id_code   VARCHAR(50),
    address_line1   VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(2),
    zip             VARCHAR(10),
    phone           VARCHAR(20),
    claims_address  VARCHAR(255),
    edi_submitter_id VARCHAR(50),
    edi_receiver_id VARCHAR(50),
    timely_filing_days INT DEFAULT 365,
    requires_authorization BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    settings        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_payers_agency ON payers(agency_id);

-- Service codes (HCPCS, CPT, Revenue codes)
CREATE TABLE service_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    code            VARCHAR(20) NOT NULL,
    code_type       VARCHAR(20) NOT NULL,
    description     TEXT,
    default_rate    DECIMAL(10,2),
    unit_type       VARCHAR(20),
    requires_auth   BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Payer-specific rate schedules
CREATE TABLE payer_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id        UUID NOT NULL REFERENCES payers(id) ON DELETE CASCADE,
    service_code_id UUID NOT NULL REFERENCES service_codes(id),
    rate            DECIMAL(10,2) NOT NULL,
    effective_date  DATE NOT NULL,
    end_date        DATE,
    modifier1       VARCHAR(5),
    modifier2       VARCHAR(5),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Claims
CREATE TABLE claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    payer_id        UUID NOT NULL REFERENCES payers(id),
    claim_number    VARCHAR(50) NOT NULL UNIQUE,
    claim_type      VARCHAR(10) NOT NULL,
    status          VARCHAR(30) DEFAULT 'draft',
    frequency_code  VARCHAR(1) DEFAULT '1',
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    total_charges   DECIMAL(10,2) DEFAULT 0,
    total_paid      DECIMAL(10,2) DEFAULT 0,
    total_adjustments DECIMAL(10,2) DEFAULT 0,
    patient_responsibility DECIMAL(10,2) DEFAULT 0,
    submitted_at    TIMESTAMPTZ,
    submitted_by    UUID REFERENCES users(id),
    edi_file_id     UUID REFERENCES edi_files(id),
    clearinghouse_claim_id VARCHAR(100),
    payer_claim_number VARCHAR(100),
    denial_reason_code VARCHAR(20),
    denial_reason   TEXT,
    appeal_deadline DATE,
    qa_passed       BOOLEAN,
    qa_errors       JSONB,
    qa_reviewed_by  UUID REFERENCES users(id),
    qa_reviewed_at  TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_claims_agency ON claims(agency_id, status);
CREATE INDEX idx_claims_patient ON claims(patient_id);
CREATE INDEX idx_claims_payer ON claims(payer_id, status);

-- Claim line items
CREATE TABLE claim_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id        UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    visit_id        UUID REFERENCES visits(id),
    line_number     INT NOT NULL,
    service_code    VARCHAR(20) NOT NULL,
    revenue_code    VARCHAR(4),
    modifier1       VARCHAR(5),
    modifier2       VARCHAR(5),
    modifier3       VARCHAR(5),
    modifier4       VARCHAR(5),
    service_date    DATE NOT NULL,
    units           DECIMAL(8,2) NOT NULL DEFAULT 1,
    charge_amount   DECIMAL(10,2) NOT NULL,
    paid_amount     DECIMAL(10,2) DEFAULT 0,
    adjustment_amount DECIMAL(10,2) DEFAULT 0,
    diagnosis_pointers INT[] DEFAULT '{1}',
    place_of_service VARCHAR(2) DEFAULT '12',
    rendering_provider_npi VARCHAR(10),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_claim_lines_claim ON claim_lines(claim_id);

-- EDI files (generated/received)
CREATE TABLE edi_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    file_type       VARCHAR(10) NOT NULL,
    direction       VARCHAR(10) NOT NULL,
    file_name       VARCHAR(255),
    s3_key          VARCHAR(500),
    content_hash    VARCHAR(64),
    interchange_control_number VARCHAR(20),
    record_count    INT,
    status          VARCHAR(20) DEFAULT 'generated',
    error_details   JSONB,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Payments / ERA (835 remittance)
CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    payer_id        UUID NOT NULL REFERENCES payers(id),
    edi_file_id     UUID REFERENCES edi_files(id),
    check_number    VARCHAR(50),
    payment_date    DATE NOT NULL,
    payment_amount  DECIMAL(12,2) NOT NULL,
    payment_method  VARCHAR(20),
    status          VARCHAR(20) DEFAULT 'received',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Payment details (per-claim from ERA)
CREATE TABLE payment_details (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id      UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    claim_id        UUID REFERENCES claims(id),
    paid_amount     DECIMAL(10,2),
    adjustment_amount DECIMAL(10,2),
    patient_responsibility DECIMAL(10,2),
    adjustment_reason_codes JSONB,
    remark_codes    JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices (for private pay patients)
CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    invoice_number  VARCHAR(50) NOT NULL UNIQUE,
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    subtotal        DECIMAL(10,2) NOT NULL,
    tax_amount      DECIMAL(10,2) DEFAULT 0,
    total_amount    DECIMAL(10,2) NOT NULL,
    paid_amount     DECIMAL(10,2) DEFAULT 0,
    balance_due     DECIMAL(10,2),
    status          VARCHAR(20) DEFAULT 'draft',
    due_date        DATE,
    sent_at         TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    pdf_url         VARCHAR(500),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Invoice line items
CREATE TABLE invoice_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    visit_id        UUID REFERENCES visits(id),
    description     TEXT NOT NULL,
    service_date    DATE NOT NULL,
    quantity        DECIMAL(8,2) DEFAULT 1,
    unit_rate       DECIMAL(10,2) NOT NULL,
    total           DECIMAL(10,2) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Eligibility checks
CREATE TABLE eligibility_checks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    payer_id        UUID NOT NULL REFERENCES payers(id),
    check_date      DATE NOT NULL,
    status          VARCHAR(20) NOT NULL,
    response_data   JSONB,
    coverage_active BOOLEAN,
    coverage_start  DATE,
    coverage_end    DATE,
    copay           DECIMAL(10,2),
    deductible      DECIMAL(10,2),
    deductible_remaining DECIMAL(10,2),
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.7 Payroll Tables

```sql
-- Pay periods
CREATE TABLE pay_periods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    pay_date        DATE NOT NULL,
    status          VARCHAR(20) DEFAULT 'open',
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    export_file_url VARCHAR(500),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Pay stubs (per staff per pay period)
CREATE TABLE pay_stubs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pay_period_id   UUID NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
    staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id),
    regular_hours   DECIMAL(8,2) DEFAULT 0,
    overtime_hours  DECIMAL(8,2) DEFAULT 0,
    visit_count     INT DEFAULT 0,
    regular_pay     DECIMAL(10,2) DEFAULT 0,
    overtime_pay    DECIMAL(10,2) DEFAULT 0,
    per_visit_pay   DECIMAL(10,2) DEFAULT 0,
    mileage_amount  DECIMAL(10,2) DEFAULT 0,
    bonus_amount    DECIMAL(10,2) DEFAULT 0,
    deductions      DECIMAL(10,2) DEFAULT 0,
    gross_pay       DECIMAL(10,2) DEFAULT 0,
    net_pay         DECIMAL(10,2) DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Pay stub line items (detail per visit)
CREATE TABLE pay_stub_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pay_stub_id     UUID NOT NULL REFERENCES pay_stubs(id) ON DELETE CASCADE,
    visit_id        UUID REFERENCES visits(id),
    service_date    DATE NOT NULL,
    patient_name    VARCHAR(200),
    hours           DECIMAL(6,2),
    rate            DECIMAL(10,2),
    amount          DECIMAL(10,2),
    pay_type        VARCHAR(20),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Mileage tracking
CREATE TABLE mileage_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id),
    visit_id        UUID REFERENCES visits(id),
    travel_date     DATE NOT NULL,
    from_address    TEXT,
    to_address      TEXT,
    miles           DECIMAL(8,2) NOT NULL,
    reimbursement_rate DECIMAL(6,4),
    reimbursement_amount DECIMAL(10,2),
    status          VARCHAR(20) DEFAULT 'pending',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.8 Documents & Notifications Tables

```sql
-- Documents
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    patient_id      UUID REFERENCES patients(id),
    staff_id        UUID REFERENCES staff_profiles(id),
    visit_id        UUID REFERENCES visits(id),
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    document_type   VARCHAR(50) NOT NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    file_name       VARCHAR(255) NOT NULL,
    file_size       INT,
    mime_type       VARCHAR(100),
    s3_key          VARCHAR(500) NOT NULL,
    s3_version_id   VARCHAR(100),
    is_signed       BOOLEAN DEFAULT false,
    signature_data  JSONB,
    is_faxed        BOOLEAN DEFAULT false,
    faxed_to        VARCHAR(20),
    faxed_at        TIMESTAMPTZ,
    tags            TEXT[],
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_documents_patient ON documents(patient_id);
CREATE INDEX idx_documents_agency ON documents(agency_id, document_type);

-- Notifications
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    type            VARCHAR(50) NOT NULL,
    title           VARCHAR(255) NOT NULL,
    body            TEXT,
    data            JSONB,
    channels        TEXT[] NOT NULL,
    is_read         BOOLEAN DEFAULT false,
    read_at         TIMESTAMPTZ,
    sent_via_push   BOOLEAN DEFAULT false,
    sent_via_sms    BOOLEAN DEFAULT false,
    sent_via_email  BOOLEAN DEFAULT false,
    delivery_status JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_agency ON notifications(agency_id, created_at DESC);

-- Notification preferences
CREATE TABLE notification_preferences (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    channel_push    BOOLEAN DEFAULT true,
    channel_sms     BOOLEAN DEFAULT true,
    channel_email   BOOLEAN DEFAULT true,
    channel_in_app  BOOLEAN DEFAULT true,
    is_enabled      BOOLEAN DEFAULT true,
    UNIQUE(user_id, notification_type)
);

-- Secure messages (HIPAA-compliant internal messaging)
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    conversation_id UUID NOT NULL,
    sender_id       UUID NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL,
    is_urgent       BOOLEAN DEFAULT false,
    attachments     JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- Message conversations
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    subject         VARCHAR(255),
    type            VARCHAR(20) DEFAULT 'direct',
    patient_id      UUID REFERENCES patients(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation participants
CREATE TABLE conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    last_read_at    TIMESTAMPTZ,
    is_muted        BOOLEAN DEFAULT false,
    PRIMARY KEY (conversation_id, user_id)
);

-- Incident reports
CREATE TABLE incident_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID NOT NULL REFERENCES agencies(id),
    patient_id      UUID REFERENCES patients(id),
    staff_id        UUID REFERENCES staff_profiles(id),
    visit_id        UUID REFERENCES visits(id),
    reported_by     UUID NOT NULL REFERENCES users(id),
    incident_date   DATE NOT NULL,
    incident_time   TIME,
    incident_type   VARCHAR(50) NOT NULL,
    description     TEXT NOT NULL,
    severity        VARCHAR(20),
    actions_taken   TEXT,
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_notes TEXT,
    status          VARCHAR(20) DEFAULT 'open',
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. API Design

All endpoints are prefixed with `/api/v1`. All require JWT auth unless noted. Responses follow `{ success: boolean, data: T, meta?: { page, limit, total } }`.

> **Note:** The NestJS API auto-generates an OpenAPI/Swagger spec at `/api/v1/docs` (via `@nestjs/swagger`). The Next.js admin dashboard consumes the API directly via Axios. The Base44 patient portal imports the portal subset of the OpenAPI spec as a Custom OpenAPI Integration.

### 6.1 Auth Module

| Method | Path | Description | Auth | Request Body |
|--------|------|-------------|------|--------------|
| POST | `/auth/login` | Login with email + password | Public | `{ email, password }` |
| POST | `/auth/logout` | Revoke refresh token | JWT | `{ refreshToken }` |
| POST | `/auth/refresh` | Get new access token | Public | `{ refreshToken }` |
| POST | `/auth/forgot-password` | Request password reset email | Public | `{ email }` |
| POST | `/auth/reset-password` | Reset password with token | Public | `{ token, newPassword }` |
| POST | `/auth/2fa/setup` | Enable 2FA, returns QR code | JWT | — |
| POST | `/auth/2fa/verify` | Verify 2FA code | JWT | `{ code }` |
| POST | `/auth/change-password` | Change own password | JWT | `{ currentPassword, newPassword }` |
| GET | `/auth/me` | Get current user profile | JWT | — |

### 6.2 Users Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/users` | List agency users (paginated) | admin |
| POST | `/users` | Create new user | admin |
| GET | `/users/:id` | Get user details | admin |
| PATCH | `/users/:id` | Update user | admin |
| DELETE | `/users/:id` | Deactivate user | admin |
| GET | `/users/:id/activity` | User audit log | admin |

### 6.3 Patients Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/patients` | List patients (filter: status, name, mrn) | read:patients |
| POST | `/patients` | Admit new patient | create:patients |
| GET | `/patients/:id` | Patient detail (demographics, diagnoses, authorizations) | read:patients |
| PATCH | `/patients/:id` | Update patient | update:patients |
| POST | `/patients/:id/discharge` | Discharge patient | update:patients |
| POST | `/patients/:id/readmit` | Readmit patient | update:patients |
| GET | `/patients/:id/diagnoses` | List diagnoses | read:patients |
| POST | `/patients/:id/diagnoses` | Add diagnosis | update:patients |
| DELETE | `/patients/:id/diagnoses/:diagId` | Remove diagnosis | update:patients |
| GET | `/patients/:id/medications` | List medications | read:patients |
| POST | `/patients/:id/medications` | Add medication | update:patients |
| PATCH | `/patients/:id/medications/:medId` | Update medication | update:patients |
| GET | `/patients/:id/allergies` | List allergies | read:patients |
| POST | `/patients/:id/allergies` | Add allergy | update:patients |
| GET | `/patients/:id/care-plans` | List care plans | read:patients |
| POST | `/patients/:id/care-plans` | Create care plan | create:care_plans |
| GET | `/patients/:id/care-plans/:cpId` | Care plan detail | read:patients |
| PATCH | `/patients/:id/care-plans/:cpId` | Update care plan | update:care_plans |
| GET | `/patients/:id/assessments` | List assessments | read:patients |
| POST | `/patients/:id/assessments` | Create assessment | create:assessments |
| GET | `/patients/:id/assessments/:aId` | Assessment detail | read:patients |
| PATCH | `/patients/:id/assessments/:aId` | Update assessment | update:assessments |
| POST | `/patients/:id/assessments/:aId/approve` | QA approve assessment | approve:assessments |
| GET | `/patients/:id/physician-orders` | List orders | read:patients |
| POST | `/patients/:id/physician-orders` | Create order | create:orders |
| PATCH | `/patients/:id/physician-orders/:oId` | Update order | update:orders |
| GET | `/patients/:id/visits` | Patient visit history | read:visits |
| GET | `/patients/:id/documents` | Patient documents | read:documents |
| GET | `/patients/:id/authorizations` | List authorizations | read:patients |
| POST | `/patients/:id/authorizations` | Create authorization | update:patients |
| PATCH | `/patients/:id/authorizations/:authId` | Update authorization | update:patients |

### 6.4 Staff Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/staff` | List staff (filter: discipline, status) | read:staff |
| POST | `/staff` | Create staff profile | create:staff |
| GET | `/staff/:id` | Staff detail | read:staff |
| PATCH | `/staff/:id` | Update staff profile | update:staff |
| DELETE | `/staff/:id` | Deactivate staff | admin |
| GET | `/staff/:id/credentials` | List credentials | read:staff |
| POST | `/staff/:id/credentials` | Add credential | update:staff |
| PATCH | `/staff/:id/credentials/:credId` | Update credential | update:staff |
| DELETE | `/staff/:id/credentials/:credId` | Remove credential | update:staff |
| GET | `/staff/:id/availability` | Get availability schedule | read:staff |
| PUT | `/staff/:id/availability` | Set availability (bulk) | update:staff (or self) |
| GET | `/staff/:id/time-off` | List time-off requests | read:staff |
| POST | `/staff/:id/time-off` | Request time off | self |
| PATCH | `/staff/:id/time-off/:toId` | Approve/deny time off | approve:time_off |
| GET | `/staff/:id/schedule` | Staff schedule (date range) | read:visits |
| GET | `/staff/:id/payroll` | Staff payroll summary | read:payroll |
| GET | `/staff/expiring-credentials` | All credentials expiring soon | read:staff |

### 6.5 Scheduling & Shifts Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/schedule/visits` | List visits (filter: date range, patient, staff, status) | read:visits |
| POST | `/schedule/visits` | Create visit | create:visits |
| GET | `/schedule/visits/:id` | Visit detail | read:visits |
| PATCH | `/schedule/visits/:id` | Update visit (reschedule, reassign) | update:visits |
| POST | `/schedule/visits/:id/cancel` | Cancel visit | update:visits |
| POST | `/schedule/visits/:id/notes` | Add visit note | create:visit_notes |
| GET | `/schedule/visits/:id/notes` | Get visit notes | read:visits |
| PATCH | `/schedule/visits/:id/notes/:noteId` | Update visit note | update:visit_notes |
| POST | `/schedule/visits/:id/notes/:noteId/sign` | Sign/finalize note | sign:visit_notes |
| POST | `/schedule/visits/:id/vitals` | Record vitals | create:vitals |
| GET | `/schedule/visits/:id/vitals` | Get vitals | read:visits |
| GET | `/schedule/visits/:id/tasks` | Get visit tasks | read:visits |
| PATCH | `/schedule/visits/:id/tasks/:taskId` | Complete task | update:visits |
| POST | `/schedule/recurring` | Create recurring schedule | create:visits |
| PATCH | `/schedule/recurring/:id` | Update recurrence rule | update:visits |
| DELETE | `/schedule/recurring/:id` | Cancel recurrence | update:visits |
| GET | `/schedule/calendar` | Calendar view data (week/day/month) | read:visits |
| GET | `/schedule/conflicts` | Detect scheduling conflicts | read:visits |
| GET | `/schedule/open-shifts` | List open shifts | read:visits |
| POST | `/schedule/open-shifts` | Create open shift | create:visits |
| POST | `/schedule/open-shifts/:id/claim` | Claim open shift (caregiver) | self |
| POST | `/schedule/open-shifts/:id/assign` | Assign open shift (admin) | assign:visits |
| POST | `/schedule/open-shifts/:id/broadcast` | Broadcast to eligible staff | create:notifications |
| POST | `/schedule/shift-swaps` | Request shift swap | self |
| PATCH | `/schedule/shift-swaps/:id` | Approve/deny swap | approve:visits |

### 6.6 EVV Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/evv/clock-in` | Clock in (GPS) | self (caregiver) |
| POST | `/evv/clock-out` | Clock out (GPS) | self (caregiver) |
| GET | `/evv/records` | List EVV records (filter: date, staff, status) | read:evv |
| GET | `/evv/records/:id` | EVV record detail | read:evv |
| PATCH | `/evv/records/:id` | Update EVV record (manual correction) | update:evv |
| POST | `/evv/records/:id/verify` | Verify EVV record | approve:evv |
| POST | `/evv/records/:id/exception` | Create exception | update:evv |
| PATCH | `/evv/exceptions/:id` | Approve/deny exception | approve:evv |
| GET | `/evv/live` | Live visit data (active visits, late, etc.) | read:evv |
| POST | `/evv/export-aggregator` | Submit EVV data to state aggregator | export:evv |
| GET | `/evv/aggregator-status` | Check aggregator submission status | read:evv |
| POST | `/evv/telephony/clock-in` | Twilio webhook — IVR clock in | Public (Twilio signature verified) |
| POST | `/evv/telephony/clock-out` | Twilio webhook — IVR clock out | Public (Twilio signature verified) |

**Clock-In Request Body:**
```json
{
  "visitId": "uuid",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "timestamp": "2026-08-19T08:00:00Z",
  "deviceId": "device-uuid",
  "appVersion": "1.2.0"
}
```

**Clock-In Response:**
```json
{
  "success": true,
  "data": {
    "evvRecordId": "uuid",
    "withinGeofence": true,
    "distanceMeters": 45,
    "visitTasks": [...],
    "patientInfo": { "name": "...", "address": "..." }
  }
}
```

### 6.7 Billing & Claims Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/billing/claims` | List claims (filter: status, payer, date) | read:billing |
| POST | `/billing/claims` | Create claim (auto-populate from visits) | create:billing |
| GET | `/billing/claims/:id` | Claim detail with line items | read:billing |
| PATCH | `/billing/claims/:id` | Update claim | update:billing |
| POST | `/billing/claims/:id/qa` | Run pre-billing QA check | read:billing |
| POST | `/billing/claims/:id/submit` | Submit claim (generates EDI) | submit:billing |
| POST | `/billing/claims/batch-submit` | Submit multiple claims | submit:billing |
| POST | `/billing/claims/:id/void` | Void claim | void:billing |
| POST | `/billing/claims/:id/rebill` | Rebill (frequency code 7) | create:billing |
| POST | `/billing/claims/:id/appeal` | Mark for appeal | update:billing |
| GET | `/billing/edi-files` | List EDI files | read:billing |
| GET | `/billing/edi-files/:id/download` | Download EDI file | read:billing |
| POST | `/billing/edi-files/upload-835` | Upload ERA remittance | create:billing |
| GET | `/billing/payments` | List payments | read:billing |
| GET | `/billing/payments/:id` | Payment detail (per-claim breakdown) | read:billing |
| POST | `/billing/payments/:id/post` | Post payment to claims | update:billing |
| GET | `/billing/invoices` | List invoices (private pay) | read:billing |
| POST | `/billing/invoices` | Generate invoice | create:billing |
| GET | `/billing/invoices/:id` | Invoice detail | read:billing |
| POST | `/billing/invoices/:id/send` | Email invoice to patient | send:billing |
| POST | `/billing/invoices/:id/record-payment` | Record payment received | update:billing |
| POST | `/billing/eligibility/check` | Check patient eligibility (270/271) | read:billing |
| POST | `/billing/eligibility/batch-check` | Batch eligibility check | read:billing |
| GET | `/billing/payers` | List payers | read:billing |
| POST | `/billing/payers` | Create payer | admin |
| PATCH | `/billing/payers/:id` | Update payer | admin |
| GET | `/billing/service-codes` | List service codes | read:billing |
| POST | `/billing/service-codes` | Create service code | admin |

### 6.8 Payroll Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/payroll/pay-periods` | List pay periods | read:payroll |
| POST | `/payroll/pay-periods` | Create pay period | create:payroll |
| GET | `/payroll/pay-periods/:id` | Pay period detail with stubs | read:payroll |
| POST | `/payroll/pay-periods/:id/calculate` | Calculate pay for period | create:payroll |
| POST | `/payroll/pay-periods/:id/approve` | Approve pay period | approve:payroll |
| POST | `/payroll/pay-periods/:id/export` | Export to payroll provider (CSV/API) | export:payroll |
| GET | `/payroll/pay-stubs/:id` | Pay stub detail | read:payroll (or self) |
| PATCH | `/payroll/pay-stubs/:id` | Adjust pay stub | update:payroll |
| GET | `/payroll/mileage` | List mileage logs | read:payroll |
| POST | `/payroll/mileage` | Log mileage | self |
| PATCH | `/payroll/mileage/:id` | Approve mileage | approve:payroll |

### 6.9 Documents Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/documents` | List documents (filter: type, patient, staff) | read:documents |
| POST | `/documents/upload` | Upload document (multipart) | create:documents |
| GET | `/documents/:id` | Document metadata | read:documents |
| GET | `/documents/:id/download` | Get pre-signed download URL | read:documents |
| DELETE | `/documents/:id` | Soft-delete document | delete:documents |
| POST | `/documents/:id/sign` | E-sign document | sign:documents |
| POST | `/documents/:id/fax` | Fax document | send:documents |
| GET | `/documents/:id/versions` | Document version history | read:documents |

### 6.10 Notifications Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/notifications` | List user notifications (paginated) | self |
| PATCH | `/notifications/:id/read` | Mark as read | self |
| POST | `/notifications/mark-all-read` | Mark all as read | self |
| GET | `/notifications/preferences` | Get notification preferences | self |
| PUT | `/notifications/preferences` | Update preferences | self |
| POST | `/notifications/register-device` | Register push token | self |

### 6.11 Reports Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/reports/census` | Active patient census | read:reports |
| GET | `/reports/visit-utilization` | Visit utilization summary | read:reports |
| GET | `/reports/evv-compliance` | EVV compliance rates | read:reports |
| GET | `/reports/financial-summary` | Revenue, AR, collections | read:reports |
| GET | `/reports/staff-productivity` | Staff visits, hours, productivity | read:reports |
| GET | `/reports/credential-expiry` | Expiring credentials report | read:reports |
| GET | `/reports/authorization-usage` | Authorization utilization | read:reports |
| GET | `/reports/missed-visits` | Missed/cancelled visit report | read:reports |
| GET | `/reports/claims-aging` | Claims aging (AR buckets) | read:reports |
| POST | `/reports/custom` | Generate custom report | read:reports |
| GET | `/reports/:id/download` | Download generated report (PDF/CSV) | read:reports |

### 6.12 Compliance Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/compliance/dashboard` | Compliance overview metrics | read:compliance |
| GET | `/compliance/evv-state-rules` | State EVV mandate rules | read:compliance |
| GET | `/compliance/audit-logs` | Query audit logs | admin |
| GET | `/compliance/hipaa-checklist` | HIPAA compliance status | admin |
| GET | `/compliance/credential-alerts` | Active credential compliance alerts | read:compliance |
| GET | `/compliance/incidents` | List incident reports | read:compliance |
| POST | `/compliance/incidents` | Create incident report | create:compliance |
| PATCH | `/compliance/incidents/:id` | Update incident | update:compliance |

### 6.13 Messaging Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/messages/conversations` | List conversations | self |
| POST | `/messages/conversations` | Create conversation | self |
| GET | `/messages/conversations/:id` | Get messages in conversation | self (participant) |
| POST | `/messages/conversations/:id/messages` | Send message | self (participant) |
| POST | `/messages/conversations/:id/read` | Mark conversation read | self |

### 6.14 Patient Portal Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/portal/profile` | Patient profile | portal_user |
| GET | `/portal/visits` | Upcoming & past visits | portal_user |
| GET | `/portal/care-plan` | Active care plan | portal_user |
| GET | `/portal/medications` | Medication list | portal_user |
| GET | `/portal/documents` | Patient documents | portal_user |
| GET | `/portal/messages` | Messages | portal_user |
| POST | `/portal/messages` | Send message to care team | portal_user |

### 6.15 Settings Module

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/settings/agency` | Agency settings | admin |
| PATCH | `/settings/agency` | Update agency settings | admin |
| GET | `/settings/roles` | List roles and permissions | admin |
| POST | `/settings/roles` | Create custom role | admin |
| PATCH | `/settings/roles/:id` | Update role permissions | admin |
| DELETE | `/settings/roles/:id` | Delete custom role | admin |

---

## 7. Authentication & Authorization Model

### 7.1 Auth Flow

```
For Next.js Admin Dashboard + React Native Mobile App:
  1. User logs in → POST /auth/login { email, password }
  2. Server validates credentials, checks 2FA
  3. If 2FA enabled → returns { requires2FA: true, tempToken }
  4. User submits 2FA code → POST /auth/2fa/verify { tempToken, code }
  5. Server returns { accessToken (15min), refreshToken (7 days) }
  6. Client stores refreshToken in secure storage:
     - Web (Next.js): httpOnly cookie
     - Mobile: Keychain/Keystore
  7. Access token sent in Authorization: Bearer header
  8. On 401, client calls POST /auth/refresh → new access token
  9. Session auto-logout after 15 minutes of inactivity (HIPAA)

For Base44 Patient Portal:
  1. Base44 login page collects email + password
  2. Base44 backend function calls POST /auth/login on NestJS
  3. Tokens stored in Base44 Secrets (encrypted, server-side)
  4. All subsequent API calls via OpenAPI integration include Bearer token
  5. Token refresh handled via Base44 backend function
  6. HIPAA idle timeout enforced via Base44 session timer
```

### 7.2 RBAC Roles

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| **super_admin** | Platform owner | All permissions |
| **agency_admin** | Agency administrator | All agency-scoped permissions |
| **supervisor** | Clinical supervisor | View all patients/staff, approve notes, live monitoring, scheduling |
| **registered_nurse** | RN staff | View assigned patients, create/edit notes & assessments, EVV, schedule view |
| **licensed_nurse** | LPN/LVN staff | Similar to RN but cannot approve care plans |
| **therapist** | PT/OT/ST | View assigned patients, therapy notes, EVV |
| **home_health_aide** | HHA/CNA | View assigned patients, activity logs, EVV, task checklists |
| **billing_staff** | Billing specialist | Full billing/claims access, read patient demographics, no clinical notes |
| **office_staff** | Office coordinator | Scheduling, basic patient info, staff management, no billing |
| **medical_social_worker** | MSW | Assigned patients, social work assessments |
| **portal_user** | Patient/family | Portal-only access to own records (Base44 portal) |

### 7.3 HIPAA Session Controls

- **Access token TTL**: 15 minutes
- **Idle timeout**: 15 minutes (enforced client-side on Next.js + Base44 + mobile; server validates last activity timestamp)
- **Password policy**: Min 12 chars, uppercase, lowercase, number, special char
- **Password rotation**: Every 90 days (configurable)
- **Account lockout**: After 5 failed attempts, 30-minute lockout
- **Audit**: Every PHI access logged to `audit_logs` table
- **Encryption**: All PHI fields encrypted at rest (AES-256), TLS 1.2+ in transit

---

## 8. Real-Time Architecture

### 8.1 Socket.IO Namespaces & Events

```
Namespace: /live-monitor (supervisors/admins only — Next.js dashboard)
  Events:
    visit:clock-in    → { visitId, staffName, patientName, lat, lng, withinGeofence, timestamp }
    visit:clock-out   → { visitId, duration, withinGeofence, timestamp }
    visit:late        → { visitId, staffName, patientName, minutesLate }
    visit:noshow      → { visitId, staffName, patientName, scheduledTime }
    visit:geofence-violation → { visitId, distance, threshold }
    dashboard:update  → { activeVisits, completedToday, lateCount, noShowCount }

Namespace: /shifts (all staff — mobile app)
  Events:
    shift:assigned    → { visitId, patientName, date, startTime }
    shift:updated     → { visitId, changes }
    shift:cancelled   → { visitId, reason }
    open-shift:new    → { openShiftId, patientName, date, discipline }
    open-shift:claimed → { openShiftId, claimedBy }
    swap:requested    → { swapId, fromStaff, visitDetails }
    swap:response     → { swapId, status }

Namespace: /messages (all authenticated users — Next.js + mobile)
  Events:
    message:new       → { conversationId, senderId, content, timestamp }
    message:typing    → { conversationId, userId }

Namespace: /notifications (all authenticated users — Next.js + mobile)
  Events:
    notification:new  → { id, type, title, body, data }
```

> **Base44 Portal Note:** The patient portal on Base44 does not use Socket.IO. Patients check visits/messages periodically — the portal fetches fresh data on each page load. No real-time requirement for the patient use case.

### 8.2 Connection Auth

Socket.IO connections authenticated via JWT passed in `auth` handshake. Server validates token, extracts `userId` and `agencyId`, joins user to appropriate rooms:
- `agency:{agencyId}` — agency-wide broadcasts
- `user:{userId}` — user-specific notifications
- `role:{role}` — role-based broadcasts (e.g., open shifts to caregivers)

### 8.3 Live Monitor Data Flow

```
Caregiver clocks in via mobile app
  → POST /evv/clock-in → EVV Service validates geofence
  → Saves EVV record to DB
  → Emits visit:clock-in to /live-monitor namespace
  → Updates visit status to 'in_progress'
  → If outside geofence → emits visit:geofence-violation
  → Next.js dashboard updates in real-time via dashboard:update (Socket.IO)

Background cron (every minute):
  → Check visits where scheduled_start < NOW - 15min AND status = 'scheduled'
  → Emit visit:late for each
  → If > 30 min late → emit visit:noshow + create notification
```

---

## 9. Mobile App Architecture (React Native)

### 9.1 Screen Flow

```
App Launch
  ├── Auth Check (Keychain token)
  │   ├── Valid → PIN Screen (biometric/PIN unlock)
  │   └── Invalid → Login Screen
  │
  ├── Tab Navigator
  │   ├── Schedule Tab
  │   │   ├── Today's Visits (default)
  │   │   ├── Weekly Calendar View
  │   │   └── Visit Detail
  │   │       ├── Clock In → EVV Capture (GPS + signature)
  │   │       ├── Tasks Checklist
  │   │       ├── Vitals Entry
  │   │       ├── Visit Notes (SOAP/narrative)
  │   │       ├── Medications Review
  │   │       └── Clock Out → EVV Capture + Patient Signature
  │   │
  │   ├── Patients Tab
  │   │   ├── Assigned Patient List
  │   │   └── Patient Detail
  │   │       ├── Demographics
  │   │       ├── Care Plan
  │   │       ├── Medications
  │   │       ├── Allergies
  │   │       ├── Visit History
  │   │       └── Documents
  │   │
  │   ├── Messages Tab
  │   │   ├── Conversation List
  │   │   └── Conversation Detail
  │   │
  │   └── Profile Tab
  │       ├── My Schedule
  │       ├── My Credentials
  │       ├── Availability
  │       ├── Time Off Requests
  │       ├── Mileage Log
  │       └── Settings (notifications, PIN, logout)
  │
  ├── Open Shifts (accessible from Schedule)
  └── Notifications (bell icon in header)
```

### 9.2 Offline Support

**Strategy: Offline-first with background sync**

1. **Local DB**: expo-sqlite stores pending visit notes, vitals, task completions, and EVV clock events
2. **Sync Queue**: All write operations go to a local queue first, then sync when online
3. **Conflict Resolution**: Server timestamp wins; if offline EVV clock-in conflicts, server marks as "manual review"
4. **Data Prefetch**: On login/refresh, download today's visits, assigned patient summaries, and task lists
5. **Offline Indicator**: Persistent banner when offline; queued items count shown

**Offline-Capable Actions:**
- Clock in/out (GPS cached, syncs when online)
- Complete visit tasks
- Enter vitals
- Write visit notes (draft)
- View cached patient info

**Online-Only Actions:**
- Submit/sign final visit notes
- View full patient history
- Send messages
- Claim open shifts

### 9.3 Background Location

- Use `expo-location` with `startLocationUpdatesAsync` for background GPS during active visits
- Location sampled every 5 minutes during visit (for route/dwell time verification)
- Battery-conscious: stop background tracking when no visit is in progress

---

## 10. EDI/Claims Pipeline Design

### 10.1 Claim Lifecycle

```
Visit Completed
  → Visit note signed and approved (QA)
  → Billing staff creates claim (auto-populated from visit data)
  → Pre-Billing QA runs:
      ✓ Patient demographics complete
      ✓ Insurance info valid
      ✓ Diagnosis codes present
      ✓ Service codes match visit type
      ✓ Authorization valid & not exhausted
      ✓ Rendering provider NPI on file
      ✓ Timely filing check
  → If QA fails → claim flagged with red errors, cannot submit
  → If QA passes → claim status = 'ready'
  → Submit claim:
      → EDI 837P/837I file generated
      → File stored in S3 + edi_files table
      → Submitted to clearinghouse (Availity/Waystar) via SFTP or API
      → claim status = 'submitted'
  → Clearinghouse acknowledgment (999/277):
      → Accepted → claim status = 'acknowledged'
      → Rejected → claim status = 'rejected', errors stored
  → Payer adjudication:
      → ERA (835) received from clearinghouse
      → Parsed → payment_details created
      → Paid → claim status = 'paid', payment posted
      → Denied → claim status = 'denied', denial reason stored
      → Partial → claim updated, patient responsibility calculated
  → Denied claims → appeal workflow or rebill
```

### 10.2 EDI 837P Generation (Simplified Structure)

```
ISA*00*          *00*          *ZZ*SENDER_ID      *ZZ*RECEIVER_ID    *260819*1200*^*00501*000000001*0*P*:~
GS*HC*SENDER_CODE*RECEIVER_CODE*20260819*1200*1*X*005010X222A1~
ST*837*0001*005010X222A1~
BHT*0019*00*BATCH001*20260819*1200*CH~
...
(Loop 2000A - Billing Provider)
(Loop 2000B - Subscriber/Patient)
(Loop 2300 - Claim)
(Loop 2400 - Service Line)
...
SE*{count}*0001~
GE*1*1~
IEA*1*000000001~
```

### 10.3 EDI File Handling

- **Outbound (837)**: Generated by `edi-837.generator.ts`, stored in S3, submitted via SFTP to clearinghouse
- **Inbound (835, 277, 271)**: Polled from clearinghouse SFTP, parsed by respective parsers, data stored in DB
- **BullMQ Job**: `claims-queue` processes claim submission asynchronously with retry (3 attempts, exponential backoff)
- **Reconciliation**: 835 parser matches payments to claims via `claim_number` and `payer_claim_number`

---

## 11. HIPAA Compliance Checklist & Implementation

### 11.1 Technical Safeguards

| Requirement | Implementation |
|-------------|----------------|
| **Access Control** | JWT + RBAC, unique user IDs, emergency access procedure |
| **Audit Controls** | `audit_logs` table, every PHI access logged with user, timestamp, IP, action |
| **Integrity Controls** | Database constraints, input validation, checksums on EDI files |
| **Transmission Security** | TLS 1.2+ enforced, HSTS headers, no PHI in URLs/query params |
| **Encryption at Rest** | AES-256 for SSN/sensitive fields, S3 SSE, PostgreSQL TDE (optional) |
| **Auto-Logoff** | 15-min idle timeout enforced on Next.js web + Base44 portal + mobile |
| **Authentication** | Unique credentials, 2FA option, password complexity + rotation |
| **Emergency Access** | `super_admin` break-glass access with enhanced audit trail |

### 11.2 Administrative Safeguards

| Requirement | Implementation |
|-------------|----------------|
| **Security Officer** | Configurable security admin role per agency |
| **Workforce Training** | Training completion tracked in staff credentials |
| **Sanction Policy** | Incident reporting module for policy violations |
| **Contingency Plan** | Database backups (daily, encrypted), disaster recovery documented |
| **Business Associates** | BAA required for Twilio, SendGrid, AWS, clearinghouse (documented in settings) |

### 11.3 Physical Safeguards

| Requirement | Implementation |
|-------------|----------------|
| **Device Security** | Mobile app PIN/biometric lock, remote wipe capability |
| **Media Disposal** | S3 lifecycle policies, database retention policies |
| **Workstation Security** | Session timeout, screen lock recommendations in user guide |

### 11.4 HIPAA Considerations for Base44 Patient Portal

The Base44 patient portal displays limited PHI (patient's own data: visits, care plan, medications, documents). HIPAA considerations:

| Concern | Mitigation |
|---------|-----------|
| **PHI Scope** | Portal shows only the logged-in patient's own data — scoped by `portal_user` role and NestJS server-side guards. No access to other patients' data. |
| **Data at rest** | Base44 does NOT store PHI in its own database. All data fetched on-demand from NestJS API and rendered in the browser. No Base44 data models contain PHI. |
| **Data in transit** | All API calls from Base44 to NestJS use HTTPS (TLS 1.2+). Base44 proxies through their backend — TLS enforced. |
| **Session management** | HIPAA idle timeout (15 min) enforced via Base44 session timer + NestJS token expiry (15-min access tokens). |
| **Audit trail** | All PHI access is logged by the NestJS HIPAA audit middleware (server-side), regardless of frontend. |
| **BAA** | If Base44/Wix offers a BAA, execute it. If not, the risk is low because: (a) PHI is limited to the patient's own data, (b) no PHI is stored in Base44, (c) data is only transiently displayed in the browser. Consult healthcare counsel for formal risk assessment. |
| **Browser caching** | NestJS responses containing PHI include `Cache-Control: no-store, no-cache` headers. |
| **Custom domain + SSL** | Use custom domain (`portal.youragency.com`) with SSL — Base44 provides SSL on custom domains. |

> **Note:** The admin dashboard (Next.js) is self-hosted on your own infrastructure — full HIPAA control, no third-party vendor dependency for the heavy PHI screens.

### 11.5 Audit Log Fields

Every audit log entry captures:
- `user_id`, `agency_id` — Who
- `action` — What (VIEW_PATIENT, EDIT_VISIT, EXPORT_REPORT, etc.)
- `resource_type`, `resource_id` — Which record
- `ip_address`, `user_agent` — From where
- `details` (JSONB) — Request metadata (PHI redacted from log)
- `created_at` — When

**Retention**: Audit logs retained for minimum 6 years (HIPAA requirement). Partition `audit_logs` table by month for performance.

---

## 12. EVV Implementation

### 12.1 GPS-Based EVV (Mobile App)

**Clock-In Flow:**
1. Caregiver opens visit in mobile app → taps "Clock In"
2. App captures current GPS coordinates via `expo-location` (high accuracy mode)
3. App sends `POST /evv/clock-in` with `{ visitId, lat, lng, timestamp, deviceId }`
4. Server validates:
   - Visit exists and is assigned to this caregiver
   - Visit is scheduled for today (±2 hour window)
   - GPS coordinates within patient's `geo_fence_radius_meters` (default 200m)
5. If within geofence → EVV record created with `clock_in_within_geofence = true`
6. If outside geofence → EVV record created, `clock_in_within_geofence = false`, alert sent to supervisor
7. Visit status updated to `in_progress`
8. Real-time event emitted to Live Monitor (Next.js dashboard via Socket.IO)

**Clock-Out Flow:**
1. Caregiver completes tasks → taps "Clock Out"
2. Patient signature captured on device (SignaturePad component → PNG → S3)
3. GPS captured again
4. `POST /evv/clock-out` with coordinates + signature URL
5. Server validates geofence, calculates visit duration
6. Visit status updated to `completed`
7. EVV data flows to billing (auto-populates billable units)

### 12.2 Telephony/IVR EVV

**For caregivers without smartphones or in low-connectivity areas:**

1. Agency assigns a dedicated phone number per patient (Twilio phone number pool)
2. Caregiver arrives at patient home → calls the assigned number from patient's landline
3. Twilio webhook hits `POST /evv/telephony/clock-in`
4. IVR flow (TwiML):
   ```
   "Welcome to [Agency] visit verification."
   "Please enter your 6-digit employee ID."
   [Caregiver enters ID]
   "You are clocking in for patient [Name]. Press 1 to confirm, 2 to cancel."
   [Caregiver presses 1]
   "Clock-in confirmed at [time]. Goodbye."
   ```
5. Server identifies caregiver by employee ID, patient by phone number (Caller ID of patient's landline)
6. EVV record created with `clock_in_method = 'telephony'`, `clock_in_phone_number` = patient's landline
7. Clock-out: Caregiver calls again, same flow but for clock-out

### 12.3 State Aggregator Integration

Different states mandate EVV data submission to specific aggregators:
- **Sandata** (NY, NJ, etc.)
- **HHAeXchange** (NY, etc.)
- **Netsmart/CareBridge** (various)

**Implementation:**
- `evv_state_config` JSONB on `agencies` table stores per-state aggregator credentials and format requirements
- `evv-aggregator-queue` BullMQ job runs nightly (configurable):
  1. Query verified EVV records not yet submitted
  2. Format data per aggregator's API/file spec (typically CSV or API)
  3. Submit via SFTP or REST API
  4. Update `aggregator_submitted_at` and `aggregator_status`
  5. Poll for confirmation/rejection

---

## 13. Notification System Design

### 13.1 Architecture

```
Trigger Event (e.g., visit scheduled, credential expiring)
  → Notification Service creates notification record
  → Checks user's notification_preferences
  → Enqueues to notification-queue (BullMQ)
  → Workers process per channel:
      ├── Push → Firebase Cloud Messaging (FCM) / APNs (mobile app)
      ├── SMS → Twilio Programmable SMS
      ├── Email → SendGrid transactional email
      └── In-App → Socket.IO event (Next.js dashboard + mobile) + DB record
  → delivery_status updated per channel
```

### 13.2 Notification Types & Triggers

| Type | Trigger | Default Channels | Timing |
|------|---------|------------------|--------|
| `shift_reminder` | Upcoming visit in 1 hour | push, in_app | 60 min before |
| `shift_assigned` | New visit assigned | push, in_app, sms | Immediate |
| `shift_cancelled` | Visit cancelled | push, in_app | Immediate |
| `open_shift` | Open shift broadcast | push, in_app | Immediate |
| `missed_visit` | Caregiver no-show (30+ min late) | push, sms, in_app | 30 min after scheduled start |
| `late_arrival` | Caregiver late (15+ min) | in_app | 15 min after |
| `credential_expiry` | Credential expires in 30/14/7/1 days | email, in_app | At configured intervals |
| `auth_limit` | Authorization at 80%/90%/100% usage | in_app, email | On visit completion |
| `claim_status` | Claim accepted/denied/paid | in_app | On status change |
| `message_received` | New secure message | push, in_app | Immediate |
| `document_signature` | Document requires signature | push, email, in_app | Immediate |
| `payroll_ready` | Pay stub available | email, in_app | On pay period approval |
| `system` | System announcements | in_app, email | Scheduled |

### 13.3 SMS Content (HIPAA-Safe)

SMS messages must NOT contain PHI. Example:
- ✅ "You have a visit scheduled at 9:00 AM tomorrow. Open the app for details."
- ❌ "Your visit with John Smith at 123 Main St is scheduled for 9:00 AM."

---

## 14. Reporting & Analytics Architecture

### 14.1 Report Categories

**Operational:**
- Active Patient Census (by status, payer, discipline)
- Visit Utilization (scheduled vs. completed vs. missed/cancelled)
- Staff Productivity (visits/day, hours, travel time)
- Open Shift Fill Rate
- Authorization Utilization (% used per patient)

**Clinical:**
- Assessment Completion Rates
- OASIS Timeliness
- Hospitalization/ER Rates
- Clinical Outcome Tracking
- Incident Reports Summary

**Financial:**
- Revenue Summary (by payer, service line, period)
- Claims Aging (0-30, 31-60, 61-90, 90+ days)
- Collection Rates
- Denial Analysis (by reason code, payer)
- Payroll Summary
- Profitability by Patient/Service Line

**Compliance:**
- EVV Compliance Rate (% of visits with valid EVV)
- Credential Compliance (% staff fully credentialed)
- Documentation Timeliness (notes signed within X days)
- HIPAA Audit Activity

### 14.2 Implementation

- **Real-time dashboards**: Direct PostgreSQL queries with materialized views for expensive aggregations. Refresh materialized views via cron (every 15 min for operational, hourly for financial).
- **Heavy reports**: Queued via `report-queue`, generated as PDF/CSV by Puppeteer/fast-csv, stored in S3, user notified when ready.
- **Dashboard widgets**: API returns pre-aggregated data; Next.js dashboard renders charts via Recharts.
- **Date filters**: All reports support date range, payer, discipline, staff, patient filters.
- **Export**: All reports exportable as CSV and PDF.

### 14.3 Materialized Views

```sql
-- Refresh every 15 minutes via pg_cron or BullMQ scheduled job
CREATE MATERIALIZED VIEW mv_daily_visit_summary AS
SELECT
    agency_id,
    scheduled_date,
    status,
    visit_type,
    COUNT(*) as visit_count,
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'missed') as missed,
    COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
FROM visits
WHERE scheduled_date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY agency_id, scheduled_date, status, visit_type;

CREATE MATERIALIZED VIEW mv_claims_aging AS
SELECT
    agency_id,
    payer_id,
    status,
    CASE
        WHEN submitted_at >= NOW() - INTERVAL '30 days' THEN '0-30'
        WHEN submitted_at >= NOW() - INTERVAL '60 days' THEN '31-60'
        WHEN submitted_at >= NOW() - INTERVAL '90 days' THEN '61-90'
        ELSE '90+'
    END as aging_bucket,
    COUNT(*) as claim_count,
    SUM(total_charges) as total_charges,
    SUM(total_paid) as total_paid
FROM claims
WHERE status IN ('submitted', 'acknowledged', 'accepted')
GROUP BY agency_id, payer_id, status, aging_bucket;
```

---

## 15. Phased Build Roadmap

> The actionable, checkbox version of this roadmap (with task IDs and owners) is [docs/ROADMAP.md](ROADMAP.md).

### Phase 1: Foundation & Core Operations (Weeks 1-6)

**Goal**: Basic operational platform — manage patients, staff, scheduling

- Monorepo setup (Turborepo, Docker, CI)
- Database schema & Prisma migrations (core tables: agencies, users, patients, staff, visits)
- Auth module (JWT, RBAC, 2FA, HIPAA session controls)
- HIPAA audit middleware
- NestJS Swagger/OpenAPI spec generation (`@nestjs/swagger`)
- Patient CRUD + demographics + diagnoses
- Staff CRUD + credentials + availability
- Visit scheduling (create, edit, cancel, calendar view)
- Recurring visit rules
- Next.js admin dashboard (login, sidebar layout, patient/staff/schedule pages)
- Basic notifications (in-app only)
- Seed data script
- Unit + integration tests for all modules

### Phase 2: EVV & Mobile App (Weeks 7-12)

**Goal**: Field caregiver operations with EVV compliance

- EVV module (GPS clock-in/out, geofence validation)
- React Native mobile app (Expo):
  - Login + PIN unlock
  - Today's schedule
  - Visit flow (clock in → tasks → vitals → notes → clock out)
  - Offline support (SQLite queue + background sync)
  - Patient summary view
- Live Visit Monitor (Socket.IO real-time dashboard in Next.js)
- Open shift management (create, broadcast, claim)
- Shift swap requests
- Visit documentation (notes, vitals, tasks)
- Push notifications (FCM)
- SMS notifications (Twilio)
- Telephony/IVR EVV (Twilio Voice)
- Background location tracking during visits

### Phase 3: Billing, Claims & Clinical (Weeks 13-20)

**Goal**: Revenue cycle management, clinical documentation, and patient portal

- Payer setup + rate schedules
- Service code management
- Authorization tracking
- Pre-billing QA engine
- Claim creation (auto-populate from visits)
- EDI 837P generator
- EDI 837I generator
- Clearinghouse SFTP integration
- EDI 835 (ERA) parser
- Payment posting + reconciliation
- Private pay invoicing + PDF generation
- Eligibility verification (270/271)
- Care plans (CMS-485)
- Assessment forms (OASIS, Braden, Fall Risk — JSONB-driven)
- Medication management
- Physician orders
- Document management (upload, e-sign, fax)
- **Base44 Patient Portal:**
  - Create Base44 project, import portal OpenAPI spec subset
  - Build login, visits, care plan, medications, documents, messages, profile pages
  - Configure custom domain (`portal.youragency.com`)
  - Implement HIPAA idle timeout (15-min session timer)
- Secure messaging (Socket.IO on Next.js + mobile; API-polled on Base44 portal)
- Email notifications (SendGrid)

### Phase 4: Analytics, Compliance & Polish (Weeks 21-26)

**Goal**: Full reporting, compliance tooling, production hardening

- Reporting engine (all report types)
- Dashboard analytics widgets (Recharts in Next.js)
- Materialized views + cron refresh
- Payroll module (pay period calculation, pay stubs, export)
- Mileage tracking
- EVV state aggregator integration (Sandata, HHAeXchange)
- Compliance dashboard
- Credential expiry alerts (automated cron)
- Incident reporting
- Claims denial/appeal workflow
- Claims aging report
- Notification preferences management
- Report export (PDF via Puppeteer, CSV)
- Performance optimization (query optimization, caching, pagination)
- Security audit (OWASP top 10, penetration testing checklist)
- Load testing
- Production deployment config (docker-compose.prod, env management)
- Documentation (API docs via Swagger/OpenAPI, user guide)

---

## 16. Environment Setup

> Superseded for day-to-day use by the root [README.md](../README.md) and [AGENTS.md](../AGENTS.md).
> Kept here as the original bootstrap reference.

### 16.1 Prerequisites

```bash
# Required software
Node.js 20 LTS
npm 10+
Docker & docker-compose
Expo CLI (npx expo)
# Base44 account (for patient portal only)
```

### 16.2 Bootstrap Commands

```bash
# 1. Create monorepo
mkdir alora-health && cd alora-health
npm init -y
# Configure npm workspaces in package.json:
# "workspaces": ["packages/*", "apps/*"]

# 2. Install Turborepo
npm install -D turbo

# 3. Create NestJS API
cd apps
npx @nestjs/cli new api --package-manager npm --strict
cd api
npm install @nestjs/config @nestjs/jwt @nestjs/passport @nestjs/platform-socket.io @nestjs/swagger swagger-ui-express
npm install @prisma/client passport passport-jwt bcryptjs class-validator class-transformer
npm install bullmq ioredis helmet @nestjs/throttler
npm install uuid
npm install -D prisma @types/passport-jwt @types/bcryptjs

# 4. Create Next.js web dashboard
cd ../
npx create-next-app@latest web --typescript --tailwind --app --src-dir
cd web
npm install @tanstack/react-query axios zustand socket.io-client
npm install recharts date-fns
npx shadcn@latest init

# 5. Create React Native mobile app
cd ../
npx create-expo-app mobile --template blank-typescript
cd mobile
npx expo install expo-location expo-sqlite expo-secure-store expo-notifications
npx expo install expo-camera expo-image-picker
npm install @react-navigation/native @react-navigation/bottom-tabs
npm install socket.io-client zustand axios

# 6. Create shared package
cd ../../packages
mkdir shared && cd shared
npm init -y
# Set "main": "src/index.ts"

# 7. Initialize Prisma
cd ../../apps/api
npx prisma init

# 8. Start infrastructure
cd ../../
# Create docker-compose.yml (PostgreSQL + Redis)
docker-compose up -d

# 9. Set up Base44 patient portal (done on base44.com — Phase 3):
#   a. Create workspace "Alora Health"
#   b. Export portal-only OpenAPI spec from NestJS
#   c. Create Project: "Patient Portal"
#   d. Import OpenAPI spec as Custom OpenAPI integration
#   e. Build 7 portal screens via Base44 builder
#   f. Configure custom domain (portal.youragency.com)
```

### 16.3 docker-compose.yml

See the root [docker-compose.yml](../docker-compose.yml). The original draft also defined `api` and `web`
services; those are added back once `apps/api` and `apps/web` exist (task P1-01).

### 16.4 .env.example

See the root [.env.example](../.env.example).

### 16.5 AGENTS.md

See the root [AGENTS.md](../AGENTS.md). It extends the original draft with the multi-agent handoff protocol.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **HIPAA breach** | Legal liability, fines up to $1.5M | Encryption everywhere, audit logging, 2FA, regular security audits, BAAs with all vendors |
| **EDI complexity** | Claims rejected by payers | Use established clearinghouse (Availity), comprehensive pre-billing QA, start with single payer type |
| **Offline data loss** | Lost EVV/documentation | SQLite queue with persistence, background sync with retry, conflict detection |
| **State EVV mandate changes** | Non-compliance | Configurable `evv_state_config` per agency, abstract aggregator interface for easy additions |
| **Performance at scale** | Slow dashboards | Materialized views, Redis caching, database read replicas, pagination everywhere |
| **Twilio/SendGrid outage** | Notifications delayed | Multi-provider fallback, queue with retry, in-app notifications always work |
| **Base44 patient portal vendor risk** | If Base44 shuts down, portal lost | Low impact — portal is 7 simple screens; can rebuild in Next.js in 1 week. All data lives in NestJS/PostgreSQL. |

---

## Alternatives Considered

| Decision | Alternative | Why Chosen Approach Wins |
|----------|-------------|--------------------------|
| **Next.js admin + Base44 portal vs. Base44 for everything** | Use Base44 for both admin dashboard and portal | Admin dashboard needs real-time Socket.IO, complex UI (drag-drop scheduling, data tables), full HIPAA control — Base44 can't deliver this. Portal is simple/read-mostly — Base44 is perfect. Best of both worlds. |
| **Next.js admin + Base44 portal vs. Next.js for everything** | Build portal in Next.js too | Portal is 7 read-mostly screens that patients check weekly. Building and maintaining a full Next.js app for this is overkill. Base44 ships it in days, frees engineering time for the admin dashboard and mobile app. |
| **Modular monolith vs. microservices** | Microservices from day 1 | Monolith is faster to build, simpler to deploy, sufficient for v1. Clean module boundaries allow future extraction. |
| **Prisma vs. TypeORM** | TypeORM | Prisma has better type safety, schema-as-code, and migration UX. TypeORM has more features but less ergonomic. |
| **Socket.IO vs. Server-Sent Events** | SSE for live monitor | Socket.IO supports bi-directional communication needed for messaging; SSE is one-way only. |
| **Expo vs. bare React Native** | Bare RN with custom native modules | Expo provides OTA updates, managed build service, and sufficient native module coverage via expo-location/sqlite. |
| **Custom EDI parser vs. library** | Use `x12-parser` npm library | Custom parser gives full control over 837/835 format nuances specific to home health; libraries are generic and may not cover all edge cases. |
| **PostgreSQL vs. MongoDB** | MongoDB for clinical forms | PostgreSQL JSONB gives document-like flexibility for forms while maintaining relational integrity for billing/scheduling. |
