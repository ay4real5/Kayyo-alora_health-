-- P2-13 (D-073): caregiver phone check-in code, unique per agency.
-- AlterTable
ALTER TABLE "staff_profiles" ADD COLUMN     "ivr_code" VARCHAR(8);
-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_agency_id_ivr_code_key" ON "staff_profiles"("agency_id", "ivr_code");
