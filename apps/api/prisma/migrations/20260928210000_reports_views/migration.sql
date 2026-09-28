-- Reports (DECISIONS D-065): daily visit totals per agency and visit type, refreshed by the reports job.
-- Kept outside the Prisma schema (Prisma doesn't model materialized views); read with $queryRaw.
CREATE MATERIALIZED VIEW mv_daily_visit_summary AS
SELECT
    agency_id,
    scheduled_date,
    visit_type,
    COUNT(*)::int AS scheduled,
    (COUNT(*) FILTER (WHERE status = 'completed'))::int AS completed,
    (COUNT(*) FILTER (WHERE status = 'missed'))::int AS missed,
    (COUNT(*) FILTER (WHERE status = 'cancelled'))::int AS cancelled,
    (COUNT(*) FILTER (WHERE status IN ('scheduled', 'in_progress')))::int AS open
FROM visits
GROUP BY agency_id, scheduled_date, visit_type;

-- Unique index: required for REFRESH MATERIALIZED VIEW CONCURRENTLY (reads keep working during a refresh).
CREATE UNIQUE INDEX mv_daily_visit_summary_key ON mv_daily_visit_summary (agency_id, scheduled_date, visit_type);
