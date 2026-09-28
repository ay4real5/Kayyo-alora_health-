# Open questions

Things that need the owner's decision. Agents: add new items here instead of guessing, then work on
something unblocked. When answered, record the answer as a decision in [DECISIONS.md](DECISIONS.md) and
move the item to "Resolved".

## Open

### Q-004 — Product name
Repo is "Kayyo-alora_health", design says "Alora". What's the product/brand name for the UI, emails and
the package scope (`@alora/...` is assumed for now)?

### Q-006 — Hosting
Where does production run (AWS, Azure, GCP, other)? Must be HIPAA-eligible with a signed BAA. Needed
before P4-10/P4-11. *Owner deferred this on 2026-09-28 — ask again before P4-10.*

### Q-009 — Track caregivers' location during visits?
The design mentions background location during an active visit (P2-10). EVV only needs the location at clock-in and
clock-out, and continuous tracking is invasive (needs "Always" permission, drains batteries). Default chosen: **no
background tracking**, plus a phone reminder to clock out (DECISIONS D-049). Do you want tracking anyway (e.g. for
safety or disputes)?

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
