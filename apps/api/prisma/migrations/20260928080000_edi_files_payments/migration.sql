-- CreateTable
CREATE TABLE "edi_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "file_type" VARCHAR(10) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "file_name" VARCHAR(255),
    "s3_key" VARCHAR(500),
    "content" TEXT,
    "content_hash" VARCHAR(64) NOT NULL,
    "interchange_control_number" VARCHAR(20),
    "record_count" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'received',
    "error_details" JSONB,
    "processed_at" TIMESTAMPTZ(6),
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edi_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "payer_id" UUID,
    "edi_file_id" UUID,
    "check_number" VARCHAR(50),
    "payment_date" DATE,
    "payment_amount" DECIMAL(12,2) NOT NULL,
    "payment_method" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'received',
    "provider_adjustments" JSONB,
    "notes" TEXT,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_details" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "claim_id" UUID,
    "claim_number" VARCHAR(38) NOT NULL,
    "status_code" VARCHAR(3) NOT NULL,
    "charge_amount" DECIMAL(10,2) NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL,
    "adjustment_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "patient_responsibility" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "payer_claim_number" VARCHAR(100),
    "adjustment_reason_codes" JSONB,
    "remark_codes" JSONB,
    "lines" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edi_files_agency_id_content_hash_key" ON "edi_files"("agency_id", "content_hash");

-- CreateIndex
CREATE INDEX "payments_agency_id_status_idx" ON "payments"("agency_id", "status");

-- CreateIndex
CREATE INDEX "payment_details_payment_id_idx" ON "payment_details"("payment_id");

-- CreateIndex
CREATE INDEX "payment_details_claim_id_idx" ON "payment_details"("claim_id");

-- AddForeignKey
ALTER TABLE "edi_files" ADD CONSTRAINT "edi_files_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edi_files" ADD CONSTRAINT "edi_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_edi_file_id_fkey" FOREIGN KEY ("edi_file_id") REFERENCES "edi_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_details" ADD CONSTRAINT "payment_details_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_details" ADD CONSTRAINT "payment_details_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

