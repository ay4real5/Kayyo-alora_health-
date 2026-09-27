-- CreateIndex
CREATE UNIQUE INDEX "roles_system_name_key" ON "roles"("name") WHERE (agency_id IS NULL);
