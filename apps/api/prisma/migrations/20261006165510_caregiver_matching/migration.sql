-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "preferred_caregiver_gender" VARCHAR(10),
ADD COLUMN     "preferred_language" VARCHAR(50);

-- AlterTable
ALTER TABLE "staff_profiles" ADD COLUMN     "gender" VARCHAR(10),
ADD COLUMN     "latitude" DECIMAL(10,8),
ADD COLUMN     "longitude" DECIMAL(11,8);

-- CreateTable
CREATE TABLE "patient_caregiver_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "note" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_caregiver_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_caregiver_preferences_staff_profile_id_idx" ON "patient_caregiver_preferences"("staff_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_caregiver_preferences_patient_id_staff_profile_id_key" ON "patient_caregiver_preferences"("patient_id", "staff_profile_id");

-- AddForeignKey
ALTER TABLE "patient_caregiver_preferences" ADD CONSTRAINT "patient_caregiver_preferences_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_caregiver_preferences" ADD CONSTRAINT "patient_caregiver_preferences_staff_profile_id_fkey" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
