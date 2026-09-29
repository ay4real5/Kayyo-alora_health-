-- P4-04c (D-077): optional Virginia billing rules — monthly hour rounding per payer, live-in flag per patient.
-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "live_in" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "payers" ADD COLUMN     "hour_rounding" VARCHAR(10);
