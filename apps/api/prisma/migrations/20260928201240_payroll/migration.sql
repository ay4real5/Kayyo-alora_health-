-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "payroll_mileage_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.70,
ADD COLUMN     "workweek_start_day" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "pay_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "pay_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "calculated_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "exported_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pay_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_stubs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pay_period_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "regular_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "overtime_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "regular_pay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtime_pay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "per_visit_pay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "mileage_miles" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "mileage_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "bonus_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gross_pay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pay_stubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_stub_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pay_stub_id" UUID NOT NULL,
    "visit_id" UUID,
    "service_date" DATE NOT NULL,
    "patient_label" VARCHAR(100),
    "hours" DECIMAL(6,2),
    "rate" DECIMAL(10,2),
    "amount" DECIMAL(10,2) NOT NULL,
    "pay_type" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_stub_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mileage_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_profile_id" UUID NOT NULL,
    "visit_id" UUID,
    "travel_date" DATE NOT NULL,
    "description" VARCHAR(255),
    "miles" DECIMAL(8,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mileage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pay_periods_agency_id_period_start_idx" ON "pay_periods"("agency_id", "period_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pay_periods_agency_id_period_start_key" ON "pay_periods"("agency_id", "period_start");

-- CreateIndex
CREATE INDEX "pay_stubs_staff_profile_id_idx" ON "pay_stubs"("staff_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_stubs_pay_period_id_staff_profile_id_key" ON "pay_stubs"("pay_period_id", "staff_profile_id");

-- CreateIndex
CREATE INDEX "pay_stub_lines_pay_stub_id_idx" ON "pay_stub_lines"("pay_stub_id");

-- CreateIndex
CREATE INDEX "mileage_logs_staff_profile_id_travel_date_idx" ON "mileage_logs"("staff_profile_id", "travel_date");

-- AddForeignKey
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_stubs" ADD CONSTRAINT "pay_stubs_pay_period_id_fkey" FOREIGN KEY ("pay_period_id") REFERENCES "pay_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_stubs" ADD CONSTRAINT "pay_stubs_staff_profile_id_fkey" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_stub_lines" ADD CONSTRAINT "pay_stub_lines_pay_stub_id_fkey" FOREIGN KEY ("pay_stub_id") REFERENCES "pay_stubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_stub_lines" ADD CONSTRAINT "pay_stub_lines_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_logs" ADD CONSTRAINT "mileage_logs_staff_profile_id_fkey" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_logs" ADD CONSTRAINT "mileage_logs_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_logs" ADD CONSTRAINT "mileage_logs_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
