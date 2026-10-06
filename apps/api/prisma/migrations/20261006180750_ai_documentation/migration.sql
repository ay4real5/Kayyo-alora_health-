-- AlterTable
ALTER TABLE "visit_notes" ADD COLUMN     "incident_flag_reason" VARCHAR(500),
ADD COLUMN     "incident_flag_status" VARCHAR(15),
ADD COLUMN     "incident_flag_type" VARCHAR(30),
ADD COLUMN     "incident_flagged_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "care_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "mood" VARCHAR(10),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "care_updates_visit_id_key" ON "care_updates"("visit_id");

-- CreateIndex
CREATE INDEX "care_updates_patient_id_created_at_idx" ON "care_updates"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "care_updates_agency_id_idx" ON "care_updates"("agency_id");

-- AddForeignKey
ALTER TABLE "care_updates" ADD CONSTRAINT "care_updates_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_updates" ADD CONSTRAINT "care_updates_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_updates" ADD CONSTRAINT "care_updates_staff_profile_id_fkey" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
