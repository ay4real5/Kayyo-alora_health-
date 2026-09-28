-- CreateTable
CREATE TABLE "evv_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "service_type" VARCHAR(50) NOT NULL,
    "service_date" DATE NOT NULL,
    "clock_in_time" TIMESTAMPTZ(6),
    "clock_out_time" TIMESTAMPTZ(6),
    "clock_in_method" VARCHAR(20) NOT NULL,
    "clock_out_method" VARCHAR(20),
    "clock_in_latitude" DECIMAL(10,8),
    "clock_in_longitude" DECIMAL(11,8),
    "clock_out_latitude" DECIMAL(10,8),
    "clock_out_longitude" DECIMAL(11,8),
    "clock_in_accuracy_meters" INTEGER,
    "clock_out_accuracy_meters" INTEGER,
    "clock_in_phone_number" VARCHAR(20),
    "clock_out_phone_number" VARCHAR(20),
    "clock_in_within_geofence" BOOLEAN,
    "clock_out_within_geofence" BOOLEAN,
    "clock_in_distance_meters" INTEGER,
    "clock_out_distance_meters" INTEGER,
    "patient_signature_url" VARCHAR(500),
    "caregiver_signature_url" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    "flags" TEXT[],
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "verification_note" TEXT,
    "aggregator_submitted_at" TIMESTAMPTZ(6),
    "aggregator_confirmation_id" VARCHAR(100),
    "aggregator_status" VARCHAR(20),
    "device_id" VARCHAR(100),
    "device_model" VARCHAR(100),
    "app_version" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evv_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evv_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evv_record_id" UUID NOT NULL,
    "exception_type" VARCHAR(50) NOT NULL,
    "original_value" TEXT,
    "corrected_value" TEXT,
    "reason" TEXT NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evv_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evv_records_visit_id_key" ON "evv_records"("visit_id");

-- CreateIndex
CREATE INDEX "evv_records_agency_id_service_date_idx" ON "evv_records"("agency_id", "service_date");

-- CreateIndex
CREATE INDEX "evv_records_staff_id_service_date_idx" ON "evv_records"("staff_id", "service_date");

-- CreateIndex
CREATE INDEX "evv_records_agency_id_status_idx" ON "evv_records"("agency_id", "status");

-- CreateIndex
CREATE INDEX "evv_exceptions_evv_record_id_idx" ON "evv_exceptions"("evv_record_id");

-- AddForeignKey
ALTER TABLE "evv_records" ADD CONSTRAINT "evv_records_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evv_records" ADD CONSTRAINT "evv_records_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evv_records" ADD CONSTRAINT "evv_records_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evv_records" ADD CONSTRAINT "evv_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evv_records" ADD CONSTRAINT "evv_records_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evv_exceptions" ADD CONSTRAINT "evv_exceptions_evv_record_id_fkey" FOREIGN KEY ("evv_record_id") REFERENCES "evv_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evv_exceptions" ADD CONSTRAINT "evv_exceptions_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evv_exceptions" ADD CONSTRAINT "evv_exceptions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
