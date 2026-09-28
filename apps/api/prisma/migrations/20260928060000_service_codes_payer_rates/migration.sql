-- CreateTable
CREATE TABLE "service_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "code_type" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "default_rate" DECIMAL(10,2),
    "unit_type" VARCHAR(20) NOT NULL DEFAULT 'visit',
    "requires_auth" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payer_id" UUID NOT NULL,
    "service_code_id" UUID NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "effective_date" DATE NOT NULL,
    "end_date" DATE,
    "modifier1" VARCHAR(5),
    "modifier2" VARCHAR(5),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payer_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_codes_agency_id_code_code_type_key" ON "service_codes"("agency_id", "code", "code_type");

-- CreateIndex
CREATE INDEX "payer_rates_payer_id_service_code_id_effective_date_idx" ON "payer_rates"("payer_id", "service_code_id", "effective_date");

-- AddForeignKey
ALTER TABLE "service_codes" ADD CONSTRAINT "service_codes_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_rates" ADD CONSTRAINT "payer_rates_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_rates" ADD CONSTRAINT "payer_rates_service_code_id_fkey" FOREIGN KEY ("service_code_id") REFERENCES "service_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

