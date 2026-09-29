# Go-live checklist (owner)

Everything the software needs from **you** before real patients and real claims. The coding work is done or waiting
on these items. Tick them as you go; ask an agent to wire up anything once you have the account. Technical detail is
in [DEPLOYMENT.md](DEPLOYMENT.md) and the decisions (D-numbers) in [DECISIONS.md](DECISIONS.md).

**Rule for every service below:** if it will see or carry patient information, it needs a signed **Business
Associate Agreement (BAA)** *before* real data goes in. Texts, emails and push messages from Kayo Health never contain
patient details, but the providers still see phone numbers and email addresses.

## 1. Name and legal

- [x] Product name: **Kayo Health** (D-075). Worth a quick trademark search before printing anything.
- [ ] Privacy notice / Notice of Privacy Practices and terms of use for the patient portal (your lawyer).
- [ ] Decide how long to keep the audit log (Q-011; default 6 years) and payroll rules with your accountant (Q-010).

## 2. Accounts and BAAs

| What | Why | Status in the software |
|---|---|---|
| [ ] **Hosting** with a BAA (AWS, Azure or Google Cloud), managed PostgreSQL, a domain + certificate (Q-006, P4-11) | Runs everything | Ready to deploy ([DEPLOYMENT.md](DEPLOYMENT.md)) |
| [ ] **Clearinghouse** (Availity, Waystar, …) + BAA + SFTP login (P3-08) | Sends claims, gets 835 remittances and 271 eligibility | 837P/837I files, 835 import and 270 built; sending waits on the account (P3-09) |
| [ ] **Twilio** + BAA: a phone number for texts and one for visit check-in calls (P2-11) | SMS alerts; clock-in/out by phone | Built, off until keys are set (D-071, D-073) |
| [ ] **SendGrid** + BAA, sending domain verified (P3-19) | Alert emails, "forgot password" | Built, off until keys are set (D-071, D-072) |
| [ ] **Expo (EAS)** account, **Apple Developer** and **Google Play** accounts | Publish the caregiver app; push notifications | App built; push registers once the app has an EAS project id |
| [ ] **Map tiles** for production (Google Maps key, or a paid OpenStreetMap tile provider) | Live monitor map; later, address → map point | Uses free OpenStreetMap tiles now — fine for testing only |

## 3. Security clean-up (P4-12)

- [ ] Make the GitHub repository **private**.
- [ ] Replace every password/key shared during development (database, JWT, encryption key) — production gets new ones.
- [ ] Keep the production **encryption key** in a secrets manager with a backup: losing it makes SSNs, 2FA secrets and
      documents unreadable.
- [ ] Admins turn on two-factor sign-in (the app enforces it for admins).

## 4. Virginia Medicaid set-up (D-069)

- [ ] Agency NPI, tax ID and ZIP+4 in Settings; Medicaid provider enrollment / MCO contracts in place.
- [ ] For each Medicaid payer (DMAS and each MCO): payer ID from the clearinghouse, claim form (837P personal care /
      837I home health), and **"EVV on claims: Virginia Medicaid (DMAS)"** in Billing setup.
- [ ] Which MCOs you bill and whether any require their own EVV portal instead of claim fields (Q-012).
- [ ] Every caregiver has an **employee ID** (letters/digits, never the SSN) — it goes on every Virginia claim.
- [ ] Every patient has a **home phone** (for check-in calls) and a correct address; caregivers who use phone
      check-in have a **phone check-in code** (Staff → edit).
- [ ] Service codes with the right **revenue codes** for home health (0551 nursing, 0571 aide, 0421 PT, …).
- [ ] Live-in clients and month-end hour rounding for personal care — confirm with your biller (Q-012, P4-04c).
- [ ] Note: from **October 1, 2026** Virginia requires EVV for all agency-directed aide shifts, including live-in.

## 5. Before the first real claim

- [ ] Send test claims through the clearinghouse's **test** channel and fix any rejections.
- [ ] Make a test check-in call from a test patient's phone; send yourself a test text, email and push.
- [ ] Create the real agency and first admin — **never** run the demo seed against production.
- [ ] Train staff; a manual accessibility check with a screen reader is recommended (D-074).
