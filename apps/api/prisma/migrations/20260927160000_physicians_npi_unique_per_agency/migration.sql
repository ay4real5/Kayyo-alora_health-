-- CreateIndex
CREATE UNIQUE INDEX "physicians_agency_id_npi_key" ON "physicians"("agency_id", "npi");
