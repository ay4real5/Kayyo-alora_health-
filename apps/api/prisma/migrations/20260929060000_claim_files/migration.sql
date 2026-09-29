-- P3-09a (D-076): outbound 837 files with real control numbers; 999/277CA rejections on claims.
-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "edi_control_number" INTEGER NOT NULL DEFAULT 0;
-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "edi_file_id" UUID,
ADD COLUMN     "rejected_at" TIMESTAMPTZ(6),
ADD COLUMN     "rejection_reason" TEXT;
-- CreateIndex
CREATE INDEX "claims_edi_file_id_idx" ON "claims"("edi_file_id");
-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_edi_file_id_fkey" FOREIGN KEY ("edi_file_id") REFERENCES "edi_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
