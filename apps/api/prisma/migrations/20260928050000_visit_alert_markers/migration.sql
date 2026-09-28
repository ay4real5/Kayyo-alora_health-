-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "late_alerted_at" TIMESTAMPTZ(6),
ADD COLUMN     "no_show_alerted_at" TIMESTAMPTZ(6);

