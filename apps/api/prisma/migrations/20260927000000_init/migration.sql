-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "npi" VARCHAR(10),
    "tax_id" VARCHAR(20),
    "phone" VARCHAR(20),
    "fax" VARCHAR(20),
    "email" VARCHAR(255),
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(2),
    "zip" VARCHAR(10),
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
    "medicare_provider_number" VARCHAR(20),
    "medicaid_provider_number" VARCHAR(20),
    "evv_state_config" JSONB,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_2fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_fa_secret" VARCHAR(255),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "pin_hash" VARCHAR(255),
    "push_token" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource" VARCHAR(100) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "device_info" VARCHAR(255),
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(100),
    "resource_id" UUID,
    "details" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "mrn" VARCHAR(50),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" VARCHAR(10),
    "ssn_encrypted" BYTEA,
    "phone_home" VARCHAR(20),
    "phone_cell" VARCHAR(20),
    "email" VARCHAR(255),
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(2),
    "zip" VARCHAR(10),
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "geo_fence_radius_meters" INTEGER NOT NULL DEFAULT 200,
    "emergency_contact_name" VARCHAR(200),
    "emergency_contact_phone" VARCHAR(20),
    "emergency_contact_relation" VARCHAR(50),
    "primary_physician_id" UUID,
    "primary_diagnosis_code" VARCHAR(10),
    "admission_date" DATE,
    "discharge_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "payer_primary_id" UUID,
    "payer_secondary_id" UUID,
    "insurance_member_id" VARCHAR(50),
    "insurance_group_number" VARCHAR(50),
    "medicare_beneficiary_id" VARCHAR(20),
    "medicaid_id" VARCHAR(20),
    "notes" TEXT,
    "portal_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physicians" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "npi" VARCHAR(10),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20),
    "fax" VARCHAR(20),
    "email" VARCHAR(255),
    "practice_name" VARCHAR(255),
    "address_line1" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(2),
    "zip" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "physicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_diagnoses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "icd10_code" VARCHAR(10) NOT NULL,
    "description" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sequence_order" INTEGER NOT NULL DEFAULT 1,
    "onset_date" DATE,
    "resolved_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_allergies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "allergen" VARCHAR(255) NOT NULL,
    "reaction" TEXT,
    "severity" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "payer_type" VARCHAR(30) NOT NULL,
    "payer_id_code" VARCHAR(50),
    "address_line1" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(2),
    "zip" VARCHAR(10),
    "phone" VARCHAR(20),
    "claims_address" VARCHAR(255),
    "edi_submitter_id" VARCHAR(50),
    "edi_receiver_id" VARCHAR(50),
    "timely_filing_days" INTEGER NOT NULL DEFAULT 365,
    "requires_authorization" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "employee_id" VARCHAR(50),
    "discipline" VARCHAR(20) NOT NULL,
    "hire_date" DATE,
    "termination_date" DATE,
    "employment_type" VARCHAR(20) NOT NULL DEFAULT 'full_time',
    "hourly_rate" DECIMAL(10,2),
    "per_visit_rate" DECIMAL(10,2),
    "overtime_rate" DECIMAL(10,2),
    "mileage_rate" DECIMAL(6,4),
    "ssn_encrypted" BYTEA,
    "tax_filing_status" VARCHAR(20),
    "address_line1" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(2),
    "zip" VARCHAR(10),
    "service_area_zip_codes" TEXT[],
    "max_patients" INTEGER,
    "skills" TEXT[],
    "languages" TEXT[],
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_profile_id" UUID NOT NULL,
    "credential_type" VARCHAR(100) NOT NULL,
    "credential_name" VARCHAR(255) NOT NULL,
    "credential_number" VARCHAR(100),
    "issuing_authority" VARCHAR(255),
    "issue_date" DATE,
    "expiry_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "document_id" UUID,
    "alert_days_before" INTEGER NOT NULL DEFAULT 30,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_availability" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_profile_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "effective_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_time_off" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_profile_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "approved_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "staff_id" UUID,
    "authorization_id" UUID,
    "visit_type" VARCHAR(50) NOT NULL,
    "service_code" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    "scheduled_date" DATE NOT NULL,
    "scheduled_start" TIME(6) NOT NULL,
    "scheduled_end" TIME(6) NOT NULL,
    "actual_start" TIMESTAMPTZ(6),
    "actual_end" TIMESTAMPTZ(6),
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrence_rule_id" UUID,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "missed_reason" TEXT,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'normal',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "staff_id" UUID,
    "visit_type" VARCHAR(50) NOT NULL,
    "service_code" VARCHAR(20),
    "frequency" VARCHAR(20) NOT NULL,
    "days_of_week" SMALLINT[],
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "max_occurrences" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "authorization_number" VARCHAR(50),
    "service_code" VARCHAR(20),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "authorized_visits" INTEGER,
    "used_visits" INTEGER NOT NULL DEFAULT 0,
    "authorized_hours" DECIMAL(8,2),
    "used_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "patient_id" UUID,
    "staff_id" UUID,
    "visit_id" UUID,
    "uploaded_by" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER,
    "mime_type" VARCHAR(100),
    "s3_key" VARCHAR(500) NOT NULL,
    "s3_version_id" VARCHAR(100),
    "is_signed" BOOLEAN NOT NULL DEFAULT false,
    "signature_data" JSONB,
    "is_faxed" BOOLEAN NOT NULL DEFAULT false,
    "faxed_to" VARCHAR(20),
    "faxed_at" TIMESTAMPTZ(6),
    "tags" TEXT[],
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "channels" TEXT[],
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "sent_via_push" BOOLEAN NOT NULL DEFAULT false,
    "sent_via_sms" BOOLEAN NOT NULL DEFAULT false,
    "sent_via_email" BOOLEAN NOT NULL DEFAULT false,
    "delivery_status" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agencies_npi_key" ON "agencies"("npi");

-- CreateIndex
CREATE INDEX "users_agency_id_idx" ON "users"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_agency_id_email_key" ON "users"("agency_id", "email");

-- CreateIndex
CREATE INDEX "roles_agency_id_idx" ON "roles"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_agency_id_name_key" ON "roles"("agency_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_resource_action_key" ON "permissions"("resource", "action");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "audit_logs_agency_id_created_at_idx" ON "audit_logs"("agency_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "patients_agency_id_idx" ON "patients"("agency_id");

-- CreateIndex
CREATE INDEX "patients_agency_id_status_idx" ON "patients"("agency_id", "status");

-- CreateIndex
CREATE INDEX "patients_agency_id_last_name_first_name_idx" ON "patients"("agency_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "patients_portal_user_id_idx" ON "patients"("portal_user_id");

-- CreateIndex
CREATE INDEX "physicians_agency_id_idx" ON "physicians"("agency_id");

-- CreateIndex
CREATE INDEX "patient_diagnoses_patient_id_idx" ON "patient_diagnoses"("patient_id");

-- CreateIndex
CREATE INDEX "patient_allergies_patient_id_idx" ON "patient_allergies"("patient_id");

-- CreateIndex
CREATE INDEX "payers_agency_id_idx" ON "payers"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles"("user_id");

-- CreateIndex
CREATE INDEX "staff_profiles_agency_id_idx" ON "staff_profiles"("agency_id");

-- CreateIndex
CREATE INDEX "staff_profiles_agency_id_discipline_idx" ON "staff_profiles"("agency_id", "discipline");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_agency_id_employee_id_key" ON "staff_profiles"("agency_id", "employee_id");

-- CreateIndex
CREATE INDEX "staff_credentials_staff_profile_id_idx" ON "staff_credentials"("staff_profile_id");

-- CreateIndex
CREATE INDEX "staff_credentials_expiry_date_idx" ON "staff_credentials"("expiry_date");

-- CreateIndex
CREATE INDEX "staff_availability_staff_profile_id_idx" ON "staff_availability"("staff_profile_id");

-- CreateIndex
CREATE INDEX "staff_time_off_staff_profile_id_idx" ON "staff_time_off"("staff_profile_id");

-- CreateIndex
CREATE INDEX "visits_agency_id_scheduled_date_idx" ON "visits"("agency_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "visits_patient_id_scheduled_date_idx" ON "visits"("patient_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "visits_staff_id_scheduled_date_idx" ON "visits"("staff_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "visits_agency_id_status_scheduled_date_idx" ON "visits"("agency_id", "status", "scheduled_date");

-- CreateIndex
CREATE INDEX "visits_recurrence_rule_id_idx" ON "visits"("recurrence_rule_id");

-- CreateIndex
CREATE INDEX "recurrence_rules_agency_id_idx" ON "recurrence_rules"("agency_id");

-- CreateIndex
CREATE INDEX "recurrence_rules_patient_id_idx" ON "recurrence_rules"("patient_id");

-- CreateIndex
CREATE INDEX "authorizations_patient_id_idx" ON "authorizations"("patient_id");

-- CreateIndex
CREATE INDEX "authorizations_payer_id_idx" ON "authorizations"("payer_id");

-- CreateIndex
CREATE INDEX "authorizations_end_date_idx" ON "authorizations"("end_date");

-- CreateIndex
CREATE INDEX "documents_patient_id_idx" ON "documents"("patient_id");

-- CreateIndex
CREATE INDEX "documents_agency_id_document_type_idx" ON "documents"("agency_id", "document_type");

-- CreateIndex
CREATE INDEX "documents_staff_id_idx" ON "documents"("staff_id");

-- CreateIndex
CREATE INDEX "documents_visit_id_idx" ON "documents"("visit_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_agency_id_created_at_idx" ON "notifications"("agency_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_primary_physician_id_fkey" FOREIGN KEY ("primary_physician_id") REFERENCES "physicians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_payer_primary_id_fkey" FOREIGN KEY ("payer_primary_id") REFERENCES "payers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_payer_secondary_id_fkey" FOREIGN KEY ("payer_secondary_id") REFERENCES "payers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physicians" ADD CONSTRAINT "physicians_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payers" ADD CONSTRAINT "payers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_staff_profile_id_fkey" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_staff_profile_id_fkey" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_staff_profile_id_fkey" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "authorizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_recurrence_rule_id_fkey" FOREIGN KEY ("recurrence_rule_id") REFERENCES "recurrence_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
