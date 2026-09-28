-- P4-04 (D-069): which state's EVV fields go on this payer's claims. 'va_dmas' = Virginia DMAS companion guides.
ALTER TABLE "payers" ADD COLUMN "evv_claim_profile" VARCHAR(20);
