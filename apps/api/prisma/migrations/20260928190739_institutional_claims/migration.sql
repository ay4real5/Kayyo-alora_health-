-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "cbsa_code" VARCHAR(5),
ADD COLUMN     "hipps_code" VARCHAR(5),
ADD COLUMN     "patient_status" VARCHAR(2),
ADD COLUMN     "type_of_bill" VARCHAR(4);

-- AlterTable
ALTER TABLE "payers" ADD COLUMN     "claim_format" VARCHAR(4);

-- AlterTable
ALTER TABLE "service_codes" ADD COLUMN     "revenue_code" VARCHAR(4);
