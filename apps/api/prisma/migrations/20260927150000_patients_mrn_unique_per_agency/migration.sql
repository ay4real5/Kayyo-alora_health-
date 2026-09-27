-- CreateIndex
CREATE UNIQUE INDEX "patients_agency_id_mrn_key" ON "patients"("agency_id", "mrn");
