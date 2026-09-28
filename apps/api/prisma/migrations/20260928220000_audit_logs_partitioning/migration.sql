-- Monthly partitioning of audit_logs (D-067/P4-08). Hand-written: Prisma cannot express
-- declarative partitioning. Preserves existing rows; also works on an empty database.

-- 1. Detach the identity sequence from the old table, then rename the table, its pkey and its
--    indexes aside so the partitioned replacement can reuse the exact names Prisma expects.
ALTER SEQUENCE audit_logs_id_seq OWNED BY NONE;
ALTER TABLE audit_logs RENAME TO audit_logs_old;
ALTER TABLE audit_logs_old RENAME CONSTRAINT audit_logs_pkey TO audit_logs_old_pkey;
ALTER INDEX audit_logs_agency_id_created_at_idx RENAME TO audit_logs_old_agency_id_created_at_idx;
ALTER INDEX audit_logs_user_id_created_at_idx RENAME TO audit_logs_old_user_id_created_at_idx;
ALTER INDEX audit_logs_resource_type_resource_id_idx RENAME TO audit_logs_old_resource_type_resource_id_idx;

-- 2. Partitioned replacement: same columns/types/defaults as the init migration, but the primary
--    key includes the partition key (created_at), as Postgres requires.
CREATE TABLE "audit_logs" (
    "id" BIGINT NOT NULL DEFAULT nextval('audit_logs_id_seq'),
    "agency_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(100),
    "resource_id" UUID,
    "details" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

ALTER SEQUENCE audit_logs_id_seq OWNED BY audit_logs.id;

CREATE INDEX "audit_logs_agency_id_created_at_idx" ON "audit_logs"("agency_id", "created_at");
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- 3. One monthly partition per month from the oldest existing row (or the current month when the
--    table is empty) through current month + 3, so there is always headroom. Bounds are UTC.
DO $$
DECLARE
    start_month date;
    end_month date;
    m date;
BEGIN
    SELECT date_trunc('month', min(created_at))::date INTO start_month FROM audit_logs_old;
    IF start_month IS NULL THEN
        start_month := date_trunc('month', now())::date;
    END IF;
    end_month := (date_trunc('month', now()) + interval '3 months')::date;
    m := start_month;
    WHILE m <= end_month LOOP
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF "audit_logs" FOR VALUES FROM (%L) TO (%L)',
            'audit_logs_y' || to_char(m, 'YYYY') || 'm' || to_char(m, 'MM'),
            to_char(m, 'YYYY-MM-DD') || ' 00:00:00+00',
            to_char(m + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
        );
        m := (m + interval '1 month')::date;
    END LOOP;
END $$;

-- A row dated outside every monthly partition lands here instead of failing; the
-- audit-partitions job moves such rows once it creates their month.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- 4. Copy all existing rows into the partitioned table (Postgres routes each to its partition),
--    then drop the old table.
INSERT INTO audit_logs (id, agency_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
SELECT id, agency_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at
FROM audit_logs_old;

DROP TABLE audit_logs_old;

-- 5. Append-only guard. UPDATE is always refused; DELETE (row-level) and TRUNCATE
--    (statement-level) are refused unless the transaction opted in with
--    set_config('alora.audit_purge', 'on', true) — used only by the retention job and the
--    FAKE-data purge helper. Row triggers on a partitioned table are cloned to every current
--    and future partition, so deleting straight from a partition is blocked too.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR current_setting('alora.audit_purge', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'audit_logs is append-only: % refused', TG_OP USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER audit_logs_no_truncate
    BEFORE TRUNCATE ON audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
