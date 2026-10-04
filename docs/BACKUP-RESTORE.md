# Backups and restoring them

This is the contingency plan for the database: HIPAA §164.308(a)(7), which covers data backup, disaster recovery and
testing. It is written so the owner, or anyone helping them, can follow it under pressure.

## What is backed up

| What | How | Kept for |
|---|---|---|
| The database (all agency, patient, visit, billing data, and uploaded documents, which are stored encrypted in the database, D-056) | Azure PostgreSQL automatic backups: daily full backups plus continuous transaction logs, so any moment can be restored | **14 days** (`infra/azure/main.bicep`) |
| The application | Container images in the private registry, and the code on GitHub | Every deployed version |
| **The encryption key** (`PHI_ENCRYPTION_KEY`), JWT secret, database password | **Only in the owner's password manager** and in the API app's settings | Forever |

**Without `PHI_ENCRYPTION_KEY`, a restored database is unreadable**: patient details, messages and documents stay
encrypted. Keep it in the password manager, and make sure a second trusted person can reach it in an emergency.

Backups stay in the same Azure region (Central US; geo-redundant backup is off to keep costs down). A region-wide
Azure outage would mean waiting for Azure. Turning on geo-redundant backup (roughly doubles backup storage cost) is
the upgrade when the agency grows.

## Proving it works: the restore drill

Azure's backups are only useful if they restore. **Actions → Backup restore drill → Run workflow** does this:

1. It restores the latest backup to a **new, temporary** server. Production is not touched.
2. It compares the copy with production: the same tables, the same migrations, and row counts that are close. The
   backup is a few minutes old, so busy tables can differ by a few rows.
3. It **deletes the temporary server**, even if a check fails.

The run's **Summary** page is the drill record. It shows the date, how long the restore took, and a table of row
counts (numbers only, never any data). It also runs by itself every three months (3 January, April, July and October).
GitHub emails you if a run fails. It costs a few cents per run.

After each drill, add a line to the log at the bottom of this page.

## Restoring for real

Use this when data was deleted or damaged by mistake, or the database is broken.

1. **Stop further damage.** If something is actively corrupting data, stop the API: portal → `primordial-api-…` →
   **Stop**.
2. **Pick the moment to restore to.** This is the last time you know the data was good, in UTC; the portal shows your
   local time.
3. **Restore to a new server.** Portal → the database `primordial-db-…` → **Overview → Restore**.
   - Choose **Select a custom restore point** and the time from step 2.
   - New server name: `primordial-db-restored-YYYYMMDD`.
   - It takes about 10–30 minutes, and production is untouched while it runs.
4. **Check the restored copy.** Point a temporary deploy at it, or ask the agent to run the drill's checks against it.
5. **Switch over.** In the API app's **Environment variables**, change the server name inside `DATABASE_URL` to the new
   server. Then update the GitHub secret `AZURE_DATABASE_URL` and the variable `AZURE_POSTGRES_SERVER` the same way,
   and click **Apply**. The API restarts on the restored data.
6. **Afterwards.** Keep the old server stopped (not deleted) for a week in case anything is missing. Then delete it,
   and update `infra/azure/main.bicep` or the notes if the name changed.
7. **Record it.** Add a line to the incident log (Compliance → Incidents in the dashboard) and to the log below.

The **recovery point** (how much data can be lost) is a few minutes, from the continuous logs. The **recovery time** is
about 30–60 minutes: the restore plus the switch-over.

## Drill log

| Date | Who | Result | Restore time | Notes |
|---|---|---|---|---|
| 2026-10-03 | Scheduled run ([#37138899608](https://github.com/ay4real5/Kayyo-alora_health-/actions/runs/37138899608)) | **Passed** | 6 min (checks 3 min) | First drill. Same tables and migrations as production; temporary server deleted afterwards. |
