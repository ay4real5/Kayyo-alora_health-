-- P4-04b (D-069): Virginia bills a shift that crosses midnight as one line per day. A claim line can now cover part of
-- a visit (evv_start/evv_end), and "one active line per visit" becomes "one active line per visit and service date" —
-- still no double billing.
ALTER TABLE "claim_lines" ADD COLUMN "evv_start" TIMESTAMPTZ(6);
ALTER TABLE "claim_lines" ADD COLUMN "evv_end" TIMESTAMPTZ(6);
DROP INDEX "claim_lines_one_active_per_visit";
CREATE UNIQUE INDEX "claim_lines_one_active_per_visit_day" ON "claim_lines"("visit_id", "service_date") WHERE "active";
