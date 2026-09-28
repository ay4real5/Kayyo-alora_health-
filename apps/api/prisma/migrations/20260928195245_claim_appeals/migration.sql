-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "appeal_deadline" DATE,
ADD COLUMN     "denied_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "payers" ADD COLUMN     "appeal_window_days" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "claim_appeals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "claim_id" UUID NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'filed',
    "filed_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" VARCHAR(100),
    "outcome_notes" TEXT,
    "decided_on" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "claim_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_appeals_claim_id_idx" ON "claim_appeals"("claim_id");

-- AddForeignKey
ALTER TABLE "claim_appeals" ADD CONSTRAINT "claim_appeals_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_appeals" ADD CONSTRAINT "claim_appeals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
