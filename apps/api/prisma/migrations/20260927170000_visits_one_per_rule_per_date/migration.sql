-- CreateIndex
CREATE UNIQUE INDEX "visits_recurrence_rule_id_scheduled_date_key" ON "visits"("recurrence_rule_id", "scheduled_date");
