-- CreateTable
CREATE TABLE "open_shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "claimed_by" UUID,
    "claimed_at" TIMESTAMPTZ(6),
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(6),
    "broadcast_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "open_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_swap_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "requesting_staff_id" UUID NOT NULL,
    "target_staff_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "decision_note" TEXT,
    "approved_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shift_swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "open_shifts_agency_id_status_idx" ON "open_shifts"("agency_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "open_shifts_one_open_per_visit" ON "open_shifts"("visit_id") WHERE (status = 'open');

-- CreateIndex
CREATE INDEX "shift_swap_requests_agency_id_status_idx" ON "shift_swap_requests"("agency_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shift_swaps_one_pending_per_visit" ON "shift_swap_requests"("visit_id") WHERE (status = 'pending');

-- AddForeignKey
ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requesting_staff_id_fkey" FOREIGN KEY ("requesting_staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_staff_id_fkey" FOREIGN KEY ("target_staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

