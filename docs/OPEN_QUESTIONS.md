# Open questions

Things that need the owner's decision. Agents: add new items here instead of guessing, then work on
something unblocked. When answered, record the answer as a decision in [DECISIONS.md](DECISIONS.md) and
move the item to "Resolved".

## Open

### Q-001 — Repo is public
The GitHub repo `ay4real5/Kayyo-alora_health-` is **public**. No PHI or secrets will ever be committed, but
the full architecture, security design, and later the code of a healthcare system will be visible to
anyone. Recommendation: make it private (Settings → General → Danger Zone → Change visibility). Devin and
Claude Code both work with private repos once connected to your GitHub account.

### Q-002 — Base44 portal authentication is unsafe as designed  ⚠ blocks P3-14/P3-16
DESIGN.md §3.3 and §7.1 say the portal stores the patient's JWT in **Base44 Secrets**. Secrets are app-wide
environment variables, not per-user storage — so every patient would share one token (patient A sees
patient B's data) or keep overwriting each other's. The portal needs per-user sessions instead. Options:
1. Base44's own per-user auth + a server-side mapping from Base44 user → NestJS portal token, stored per
   user and never in Secrets.
2. The browser calls NestJS directly with the patient's own token (then CORS for the exact portal origin).
3. Build the portal in Next.js inside this repo (design estimates about a week; removes the Base44 BAA issue too).
Related: because Base44 **proxies** API calls through its backend, PHI passes through Base44's servers even if
it's never stored there. That usually makes Base44 a business associate needing a BAA, so the design's
"low risk without a BAA" reasoning needs a compliance/legal check.

### Q-003 — Single agency or multi-agency SaaS?
The schema is multi-tenant (`agency_id` everywhere, `super_admin` "platform owner"). Is this one agency's
internal system, or a product sold to many agencies? It affects onboarding, billing and hosting.

### Q-004 — Product name
Repo is "Kayyo-alora_health", design says "Alora". What's the product/brand name for the UI, emails and
the package scope (`@alora/...` is assumed for now)?

### Q-005 — Launch state(s)
Which US state(s) first? That decides the EVV aggregator (Sandata / HHAeXchange / other), Medicaid
billing rules, and which payers to set up first. Needed before P4-04, useful earlier.

### Q-006 — Hosting
Where does production run (AWS, Azure, GCP, other)? Must be HIPAA-eligible with a signed BAA. Needed
before P4-10/P4-11.

## Resolved

(none yet)
