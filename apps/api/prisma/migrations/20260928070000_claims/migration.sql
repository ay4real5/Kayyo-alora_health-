-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "claim_number" VARCHAR(20) NOT NULL,
    "claim_type" VARCHAR(10) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "frequency_code" VARCHAR(1) NOT NULL DEFAULT '1',
    "billing_period_start" DATE NOT NULL,
    "billing_period_end" DATE NOT NULL,
    "total_charges" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_adjustments" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "patient_responsibility" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "member_id" VARCHAR(50),
    "diagnosis_codes" TEXT[],
    "original_claim_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "payer_claim_number" VARCHAR(100),
    "denial_reason_code" VARCHAR(20),
    "denial_reason" TEXT,
    "qa_passed" BOOLEAN,
    "qa_errors" JSONB,
    "qa_reviewed_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "claim_id" UUID NOT NULL,
    "visit_id" UUID,
    "line_number" INTEGER NOT NULL,
    "service_code" VARCHAR(20) NOT NULL,
    "revenue_code" VARCHAR(4),
    "modifier1" VARCHAR(5),
    "modifier2" VARCHAR(5),
    "service_date" DATE NOT NULL,
    "units" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "unit_rate" DECIMAL(10,2) NOT NULL,
    "charge_amount" DECIMAL(10,2) NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "adjustment_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "diagnosis_pointers" INTEGER[] DEFAULT ARRAY[1]::INTEGER[],
    "place_of_service" VARCHAR(2) NOT NULL DEFAULT '12',
    "rendering_provider_npi" VARCHAR(10),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claims_agency_id_status_idx" ON "claims"("agency_id", "status");

-- CreateIndex
CREATE INDEX "claims_patient_id_idx" ON "claims"("patient_id");

-- CreateIndex
CREATE INDEX "claims_payer_id_status_idx" ON "claims"("payer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "claims_agency_id_claim_number_key" ON "claims"("agency_id", "claim_number");

-- CreateIndex
CREATE INDEX "claim_lines_claim_id_idx" ON "claim_lines"("claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "claim_lines_one_active_per_visit" ON "claim_lines"("visit_id") WHERE (active);

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_original_claim_id_fkey" FOREIGN KEY ("original_claim_id") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

