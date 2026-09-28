-- CreateTable
CREATE TABLE "visit_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "note_type" VARCHAR(50) NOT NULL,
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "narrative" TEXT,
    "form_data" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "amends_note_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "signed_at" TIMESTAMPTZ(6),
    "signed_by" UUID,
    "qa_reviewed_by" UUID,
    "qa_reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "visit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_vitals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "recorded_by" UUID NOT NULL,
    "blood_pressure_systolic" INTEGER,
    "blood_pressure_diastolic" INTEGER,
    "heart_rate" INTEGER,
    "respiratory_rate" INTEGER,
    "temperature" DECIMAL(5,2),
    "temperature_unit" VARCHAR(1) NOT NULL DEFAULT 'F',
    "oxygen_saturation" DECIMAL(5,2),
    "weight" DECIMAL(6,2),
    "weight_unit" VARCHAR(3) NOT NULL DEFAULT 'lbs',
    "pain_level" INTEGER,
    "blood_glucose" INTEGER,
    "notes" TEXT,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entered_in_error_at" TIMESTAMPTZ(6),
    "entered_in_error_by" UUID,
    "entered_in_error_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "task_name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "completed_by" UUID,
    "not_done_reason" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_notes_visit_id_idx" ON "visit_notes"("visit_id");

-- CreateIndex
CREATE INDEX "visit_vitals_visit_id_idx" ON "visit_vitals"("visit_id");

-- CreateIndex
CREATE INDEX "visit_tasks_visit_id_sort_order_idx" ON "visit_tasks"("visit_id", "sort_order");

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_signed_by_fkey" FOREIGN KEY ("signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_qa_reviewed_by_fkey" FOREIGN KEY ("qa_reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_amends_note_id_fkey" FOREIGN KEY ("amends_note_id") REFERENCES "visit_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_entered_in_error_by_fkey" FOREIGN KEY ("entered_in_error_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_tasks" ADD CONSTRAINT "visit_tasks_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_tasks" ADD CONSTRAINT "visit_tasks_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

