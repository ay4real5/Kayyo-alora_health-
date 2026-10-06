-- CreateTable
CREATE TABLE "referral_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "contact_name" VARCHAR(200),
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referral_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "source_id" UUID,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "status" VARCHAR(30) NOT NULL DEFAULT 'new',
    "lost_reason" VARCHAR(500),
    "client_first_name" VARCHAR(100) NOT NULL,
    "client_last_name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "city" VARCHAR(100),
    "zip" VARCHAR(10),
    "payer_type" VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "care_needs" TEXT,
    "contact_name" VARCHAR(200),
    "contact_relationship" VARCHAR(50),
    "contact_phone" VARCHAR(20),
    "contact_email" VARCHAR(255),
    "assigned_to" UUID,
    "next_follow_up" DATE,
    "patient_id" UUID,
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referral_id" UUID NOT NULL,
    "event_type" VARCHAR(20) NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30),
    "note" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_sources_agency_id_name_key" ON "referral_sources"("agency_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_patient_id_key" ON "referrals"("patient_id");

-- CreateIndex
CREATE INDEX "referrals_agency_id_status_idx" ON "referrals"("agency_id", "status");

-- CreateIndex
CREATE INDEX "referrals_agency_id_created_at_idx" ON "referrals"("agency_id", "created_at");

-- CreateIndex
CREATE INDEX "referral_events_referral_id_created_at_idx" ON "referral_events"("referral_id", "created_at");

-- AddForeignKey
ALTER TABLE "referral_sources" ADD CONSTRAINT "referral_sources_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "referral_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
