# Open questions

Things that need the owner's decision. Agents: add new items here instead of guessing, then work on
something unblocked. When answered, record the answer as a decision in [DECISIONS.md](DECISIONS.md) and
move the item to "Resolved".

## Open

### Q-004 — Product name
Repo is "Kayyo-alora_health", design says "Alora". What's the product/brand name for the UI, emails and
the package scope (`@alora/...` is assumed for now)?
**Heads-up (2026-09-29, Claude Code):** "Alora Health" is already the name of an existing home health software
company (alorahealth.com) that sells EVV software to Virginia agencies — the same market. Using the name would very
likely be a trademark problem; please pick a different brand (or check with a lawyer) before launch. Renaming the UI
text is easy; the `@alora/` package scope is internal and can stay.

### Q-006 — Hosting
Where does production run (AWS, Azure, GCP, other)? Must be HIPAA-eligible with a signed BAA. Needed
before P4-10/P4-11. *Owner deferred this on 2026-09-28 — ask again before P4-10.*

### Q-009 — Track caregivers' location during visits?
The design mentions background location during an active visit (P2-10). EVV only needs the location at clock-in and
clock-out, and continuous tracking is invasive (needs "Always" permission, drains batteries). Default chosen: **no
background tracking**, plus a phone reminder to clock out (DECISIONS D-049). Do you want tracking anyway (e.g. for
safety or disputes)?

### Q-010 — Payroll policy details (for the agency's accountant)
2026-09-28 · Claude Code · affects P4-03 (D-064)
Payroll pays verified visit time and FLSA overtime over 40 hours per workweek. Please confirm with your accountant:
1. Is **travel time between clients** paid (it is compensable under FLSA for aides)? At what rate?
2. Do per-visit clinicians (RN/PT) ever get overtime? (We treat them as fee-basis — no overtime.)
3. Do bonuses need to be folded into the overtime "regular rate"? (We don't do that yet.)
4. Which provider do you use (ADP, Gusto, QuickBooks, Paychex)? We can match their import format exactly.
Default until answered: as described in D-064.

### Q-011 — How long to keep the audit log
2026-09-28 · Devin · affects P4-08 (D-067)
HIPAA requires 6 years. The API now permanently deletes audit-log months older than `AUDIT_RETENTION_MONTHS` (default
72 = 6 years; it refuses anything lower). Do Virginia rules, your payers (Medicaid/MCO contracts) or your lawyer want
longer (7 or 10 years is common)? Should old months be archived (e.g. to S3 Glacier) instead of deleted?
Default until answered: keep 6 years, then delete.

### Q-012 — Virginia EVV: payers and live-in/overnight care
2026-09-29 · Claude Code · affects P4-04 (D-069)
EVV now goes on Virginia claims the way the DMAS companion guides describe (no aggregator in Virginia).
1. Which **MCOs** do you bill (Anthem HealthKeepers Plus, Aetna Better Health, Humana, Molina, Sentara/Optima,
   UnitedHealthcare)? Some use their own EVV portals (reported: Humana → HHAeXchange, Anthem → Netsmart/Tellus). If
   an MCO requires its portal instead of claim fields, we'll add an adapter for it.
2. Do you have **live-in** personal care clients (they need the UB modifier)? Overnight shifts are already split at
   midnight. Does your biller round personal care hours **per month** (DMAS rule: whole hours, leftover 30+ minutes
   round up at month end)? Today hours bill in quarter hours per visit.
3. Your caregivers' **employee IDs** go on every Virginia claim (DMAS rule: unique, letters/digits, not the SSN).
   Make sure every aide has one in Staff.
Default until answered: claim fields for all Virginia Medicaid payers with "EVV on claims" set.

## Resolved

### Q-002 — Base44 portal authentication
Resolved 2026-09-28: the portal is built in this repo instead of Base44 (per-patient sessions, no third party
handling PHI). See DECISIONS D-044.

### Q-003 — Single agency or multi-agency
Resolved 2026-09-28: multi-agency SaaS. See DECISIONS D-044.

### Q-005 — Launch state
Resolved 2026-09-28: Virginia first (EVV vendor/format still to be researched). See DECISIONS D-044.

### Q-008 — Which roles must use 2FA
Resolved 2026-09-28: agency admins and super admins only. See DECISIONS D-044, D-045.

### Q-007 — Development database
Resolved 2026-09-27: Neon (database `alora` in the owner's existing Neon project) + Upstash Redis. See DECISIONS D-018.

### Q-001 — Repo is public
Resolved 2026-09-27: made private, then made public again for the build phase — see DECISIONS D-012.
