-- CreateTable
CREATE TABLE "eligibility_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "trace_number" VARCHAR(30) NOT NULL,
    "service_date" DATE NOT NULL,
    "member_id" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "request_270" TEXT NOT NULL,
    "response_data" JSONB,
    "coverage_active" BOOLEAN,
    "plan_name" VARCHAR(100),
    "coverage_start" DATE,
    "coverage_end" DATE,
    "copay" DECIMAL(10,2),
    "coinsurance_percent" DECIMAL(5,2),
    "deductible" DECIMAL(10,2),
    "deductible_remaining" DECIMAL(10,2),
    "error_message" TEXT,
    "responded_at" TIMESTAMPTZ(6),
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eligibility_checks_patient_id_created_at_idx" ON "eligibility_checks"("patient_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_checks_agency_id_trace_number_key" ON "eligibility_checks"("agency_id", "trace_number");

-- AddForeignKey
ALTER TABLE "eligibility_checks" ADD CONSTRAINT "eligibility_checks_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_checks" ADD CONSTRAINT "eligibility_checks_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_checks" ADD CONSTRAINT "eligibility_checks_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_checks" ADD CONSTRAINT "eligibility_checks_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
