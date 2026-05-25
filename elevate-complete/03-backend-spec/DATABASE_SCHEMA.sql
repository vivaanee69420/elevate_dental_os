-- ============================================================================
-- Elevate Dental OS · Database Schema
-- PostgreSQL 14+
-- Version 1.1 · 25 May 2026
-- ============================================================================
--
-- Run order: extensions → core (orgs/users/auth) → integrations → ingest →
-- clinical → accounting → CRM → reconciliation → KPI → audit
--
-- Convention: snake_case · UUID primary keys · created_at/updated_at on every table
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================================
-- CORE: organizations / entities / practices / users / auth
-- ============================================================================

CREATE TABLE organizations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text NOT NULL,
  slug         text UNIQUE NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'GB',
  base_currency char(3) NOT NULL DEFAULT 'GBP',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entities (
  -- Legal entities (Ltd companies). One org may have several.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_name      text NOT NULL,
  companies_house_no text,
  vat_number      text,
  accounting_basis text NOT NULL CHECK (accounting_basis IN ('cash','accrual')),
  fiscal_year_end date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, legal_name)
);

CREATE TABLE practices (
  -- A clinical site. Many practices can roll up under one entity.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id       uuid NOT NULL REFERENCES entities(id),
  code            text NOT NULL,        -- e.g. 'ASH' for Ashford
  name            text NOT NULL,
  address_line1   text,
  address_line2   text,
  city            text,
  postcode        text,
  region          text,
  chairs          int NOT NULL DEFAULT 1,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        text UNIQUE NOT NULL,    -- 'owner','practice_manager','reception','clinician','finance_lead'
  label       text NOT NULL,
  owner_only_pages_visible boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           citext UNIQUE NOT NULL,
  password_hash   text NOT NULL,        -- bcrypt
  first_name      text,
  last_name       text,
  role_id         uuid NOT NULL REFERENCES roles(id),
  mfa_secret      text,                 -- TOTP shared secret · NULL means MFA not yet set up
  mfa_enrolled    boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_org ON users(organization_id);

CREATE TABLE user_practice_access (
  -- Which practices a non-owner user can see. Owners see all.
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, practice_id)
);

CREATE TABLE permissions (
  -- Per-role override of which pages are accessible.
  -- Mirrors the prototype's PAGE_META map.
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  page_id    text NOT NULL,             -- e.g. 'launch-reconciliation'
  can_view   boolean NOT NULL DEFAULT false,
  can_edit   boolean NOT NULL DEFAULT false,
  UNIQUE (role_id, page_id)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  ip            inet,
  user_agent    text,
  mfa_verified  boolean NOT NULL DEFAULT false,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ============================================================================
-- INTEGRATIONS: tokens / sync jobs / raw events
-- ============================================================================

CREATE TABLE integrations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id       uuid REFERENCES entities(id),   -- NULL when integration is org-wide
  system          text NOT NULL CHECK (system IN ('dentally','xero','quickbooks','ghl','stripe','gocardless','open_banking','meta_ads','google_ads')),
  account_label   text,
  status          text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','disconnected','error','revoked')),
  connected_at    timestamptz NOT NULL DEFAULT now(),
  last_sync_at    timestamptz,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- e.g. base_url, tenant_id, realm_id
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integration_tokens (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id  uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  -- Encrypted at rest with envelope encryption (use AWS KMS / Azure Key Vault).
  access_token_ciphertext  bytea NOT NULL,
  refresh_token_ciphertext bytea,
  token_type      text,
  scope           text,
  expires_at      timestamptz,
  rotated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_jobs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id  uuid NOT NULL REFERENCES integrations(id),
  job_type        text NOT NULL,           -- 'webhook_recv','nightly_backfill','token_refresh','reports_p_and_l',...
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed','retrying')),
  started_at      timestamptz,
  finished_at     timestamptz,
  records_in      int NOT NULL DEFAULT 0,
  records_out     int NOT NULL DEFAULT 0,
  error_message   text,
  payload         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_jobs_integration ON sync_jobs(integration_id, created_at DESC);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status) WHERE status IN ('queued','running','retrying');

CREATE TABLE raw_events (
  -- Every webhook payload stored raw before any processing.
  -- Allows replay / debugging / forensics.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id  uuid NOT NULL REFERENCES integrations(id),
  event_type      text NOT NULL,           -- e.g. 'appointment.created'
  external_id     text,                    -- the source system's ID for the object
  payload         jsonb NOT NULL,
  signature       text,                    -- if provided
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  processing_error text
);
CREATE INDEX idx_raw_events_integration ON raw_events(integration_id, received_at DESC);
CREATE INDEX idx_raw_events_unprocessed ON raw_events(integration_id) WHERE processed_at IS NULL;

-- ============================================================================
-- MANUAL FEED LAYER
-- ============================================================================

CREATE TABLE manual_uploads (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  practice_id     uuid REFERENCES practices(id),
  template        text NOT NULL CHECK (template IN ('monthly_financials','appointments','payments','treatment_plans','leads')),
  period_start    date,
  period_end      date,
  filename        text NOT NULL,
  row_count       int NOT NULL DEFAULT 0,
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid REFERENCES users(id),
  approved_at     timestamptz,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  rejection_reason text
);

CREATE TABLE manual_upload_rows (
  -- Validated, parsed rows from each upload, kept in staging until approved.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_id       uuid NOT NULL REFERENCES manual_uploads(id) ON DELETE CASCADE,
  row_index       int NOT NULL,
  data            jsonb NOT NULL,
  validation_errors jsonb,                 -- NULL if row passed validation
  promoted        boolean NOT NULL DEFAULT false  -- true when copied to normalized tables
);

-- ============================================================================
-- CLINICAL: from Dentally (or manual feed)
-- ============================================================================

CREATE TABLE patients (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  practice_id     uuid NOT NULL REFERENCES practices(id),
  external_id     text NOT NULL,           -- Dentally patient ID
  source_system   text NOT NULL DEFAULT 'dentally',
  source_type     text NOT NULL DEFAULT 'api' CHECK (source_type IN ('api','manual')),
  first_name      text,
  last_name       text,
  email           citext,
  phone           text,
  date_of_birth   date,
  nhs_number      text,
  consent_marketing boolean,
  consent_sms     boolean,
  consent_email   boolean,
  acquisition_source text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id, practice_id)
);
CREATE INDEX idx_patients_practice ON patients(practice_id);
CREATE INDEX idx_patients_email ON patients(email) WHERE email IS NOT NULL;

CREATE TABLE practitioners (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid REFERENCES practices(id),
  external_id     text NOT NULL,
  source_system   text NOT NULL DEFAULT 'dentally',
  first_name      text,
  last_name       text,
  gdc_number      text,
  type            text,                    -- 'associate','principal','hygienist','therapist','nurse'
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);

CREATE TABLE rooms (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  practice_id     uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  external_id     text,
  name            text NOT NULL,
  type            text DEFAULT 'surgery',
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE appointments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid NOT NULL REFERENCES practices(id),
  patient_id      uuid REFERENCES patients(id),
  practitioner_id uuid REFERENCES practitioners(id),
  room_id         uuid REFERENCES rooms(id),
  external_id     text NOT NULL,
  source_system   text NOT NULL DEFAULT 'dentally',
  source_type     text NOT NULL DEFAULT 'api',
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  duration_minutes int GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (ends_at - starts_at))/60) STORED,
  status          text NOT NULL,           -- 'scheduled','confirmed','arrived','in_progress','completed','no_show','cancelled'
  treatment_description text,
  cancellation_reason text,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);
CREATE INDEX idx_appts_practice_starts ON appointments(practice_id, starts_at);
CREATE INDEX idx_appts_practitioner ON appointments(practitioner_id, starts_at);
CREATE INDEX idx_appts_status ON appointments(status, practice_id);

CREATE TABLE treatment_plans (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid NOT NULL REFERENCES practices(id),
  patient_id      uuid REFERENCES patients(id),
  practitioner_id uuid REFERENCES practitioners(id),
  external_id     text NOT NULL,
  source_system   text NOT NULL DEFAULT 'dentally',
  status          text NOT NULL,           -- 'draft','presented','accepted','in_progress','completed','declined'
  quoted_value    numeric(12,2),
  accepted_at     timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);

CREATE TABLE treatment_plan_items (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  treatment_plan_id uuid NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  external_id       text,
  treatment_code    text,                  -- BSA code or local code
  description       text,
  quantity          int NOT NULL DEFAULT 1,
  unit_value        numeric(10,2),
  total_value       numeric(12,2),
  status            text,                  -- 'planned','completed','removed'
  completed_at      timestamptz
);

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid NOT NULL REFERENCES practices(id),
  patient_id      uuid REFERENCES patients(id),
  external_id     text NOT NULL,
  source_system   text NOT NULL DEFAULT 'dentally',
  invoice_number  text,
  issued_at       timestamptz NOT NULL,
  due_at          timestamptz,
  total_amount    numeric(12,2) NOT NULL,
  paid_amount     numeric(12,2) NOT NULL DEFAULT 0,
  balance         numeric(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  status          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);

CREATE TABLE invoice_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id      uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  treatment_code  text,
  description     text,
  quantity        int NOT NULL DEFAULT 1,
  unit_value      numeric(10,2),
  total_value     numeric(12,2)
);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid NOT NULL REFERENCES practices(id),
  invoice_id      uuid REFERENCES invoices(id),
  patient_id      uuid REFERENCES patients(id),
  external_id     text NOT NULL,
  source_system   text NOT NULL DEFAULT 'dentally',
  paid_at         timestamptz NOT NULL,
  amount          numeric(12,2) NOT NULL,
  method          text,                    -- 'cash','card','bank','finance','online'
  reference       text,
  reversed        boolean NOT NULL DEFAULT false,
  reversed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);
CREATE INDEX idx_payments_practice_date ON payments(practice_id, paid_at);
CREATE INDEX idx_payments_invoice ON payments(invoice_id) WHERE invoice_id IS NOT NULL;

CREATE TABLE accounts_receivable (
  -- Snapshot per patient per practice. Recomputed nightly from invoices + payments.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid NOT NULL REFERENCES practices(id),
  patient_id      uuid NOT NULL REFERENCES patients(id),
  balance         numeric(12,2) NOT NULL,
  days_overdue    int NOT NULL DEFAULT 0,
  oldest_invoice_date date,
  snapshot_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, patient_id, snapshot_at)
);

-- ============================================================================
-- ACCOUNTING: from Xero or QuickBooks (one master per entity)
-- ============================================================================

CREATE TABLE accounting_accounts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id       uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_system   text NOT NULL CHECK (source_system IN ('xero','quickbooks')),
  external_id     text NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  type            text,                    -- 'revenue','cogs','expense','asset','liability','equity'
  -- Elevate dental bucket mapping (set during onboarding)
  dental_bucket   text,                    -- 'revenue.private','revenue.nhs','revenue.implants','cos.lab','cos.materials','cos.associate','overhead.staff','overhead.rent','overhead.utilities','overhead.marketing','overhead.software','overhead.insurance','overhead.professional'
  active          boolean NOT NULL DEFAULT true,
  UNIQUE (source_system, external_id, entity_id)
);

CREATE TABLE accounting_tracking_categories (
  -- Xero tracking categories or QB classes/locations. Maps a transaction line to a practice.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id       uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_system   text NOT NULL,
  external_id     text NOT NULL,
  category_name   text NOT NULL,
  option_value    text NOT NULL,
  practice_id     uuid REFERENCES practices(id),
  UNIQUE (source_system, external_id, option_value)
);

CREATE TABLE accounting_transactions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id       uuid NOT NULL REFERENCES entities(id),
  practice_id     uuid REFERENCES practices(id),
  account_id      uuid REFERENCES accounting_accounts(id),
  source_system   text NOT NULL,
  external_id     text NOT NULL,
  txn_type        text NOT NULL,           -- 'invoice','bill','payment','journal','bank_transaction'
  txn_date        date NOT NULL,
  description     text,
  reference       text,
  amount          numeric(14,2) NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'GBP',
  fx_rate         numeric(12,6) NOT NULL DEFAULT 1,
  amount_base     numeric(14,2) GENERATED ALWAYS AS (amount * fx_rate) STORED,
  status          text,                    -- 'authorised','draft','voided','reconciled'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);
CREATE INDEX idx_acc_txn_entity_date ON accounting_transactions(entity_id, txn_date);
CREATE INDEX idx_acc_txn_account ON accounting_transactions(account_id, txn_date);
CREATE INDEX idx_acc_txn_practice ON accounting_transactions(practice_id, txn_date) WHERE practice_id IS NOT NULL;

CREATE TABLE monthly_financials (
  -- Frozen monthly snapshot used by dashboards and board packs.
  -- One row per entity per practice per month.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id       uuid NOT NULL REFERENCES entities(id),
  practice_id     uuid REFERENCES practices(id),     -- NULL = entity-level rollup
  period          date NOT NULL,                     -- first day of the month
  source_system   text NOT NULL,                     -- 'xero','quickbooks','manual'
  revenue_private numeric(14,2) NOT NULL DEFAULT 0,
  revenue_nhs     numeric(14,2) NOT NULL DEFAULT 0,
  revenue_implants numeric(14,2) NOT NULL DEFAULT 0,
  revenue_hygiene numeric(14,2) NOT NULL DEFAULT 0,
  revenue_orthodontics numeric(14,2) NOT NULL DEFAULT 0,
  revenue_other   numeric(14,2) NOT NULL DEFAULT 0,
  revenue_total   numeric(14,2) GENERATED ALWAYS AS (revenue_private + revenue_nhs + revenue_implants + revenue_hygiene + revenue_orthodontics + revenue_other) STORED,
  cos_lab         numeric(14,2) NOT NULL DEFAULT 0,
  cos_materials   numeric(14,2) NOT NULL DEFAULT 0,
  cos_associate   numeric(14,2) NOT NULL DEFAULT 0,
  cos_finance     numeric(14,2) NOT NULL DEFAULT 0,
  cos_total       numeric(14,2) GENERATED ALWAYS AS (cos_lab + cos_materials + cos_associate + cos_finance) STORED,
  gross_profit    numeric(14,2) GENERATED ALWAYS AS ((revenue_private + revenue_nhs + revenue_implants + revenue_hygiene + revenue_orthodontics + revenue_other) - (cos_lab + cos_materials + cos_associate + cos_finance)) STORED,
  overhead_staff  numeric(14,2) NOT NULL DEFAULT 0,
  overhead_rent   numeric(14,2) NOT NULL DEFAULT 0,
  overhead_utilities numeric(14,2) NOT NULL DEFAULT 0,
  overhead_marketing numeric(14,2) NOT NULL DEFAULT 0,
  overhead_software numeric(14,2) NOT NULL DEFAULT 0,
  overhead_insurance numeric(14,2) NOT NULL DEFAULT 0,
  overhead_professional numeric(14,2) NOT NULL DEFAULT 0,
  overhead_other  numeric(14,2) NOT NULL DEFAULT 0,
  overhead_total  numeric(14,2) GENERATED ALWAYS AS (overhead_staff + overhead_rent + overhead_utilities + overhead_marketing + overhead_software + overhead_insurance + overhead_professional + overhead_other) STORED,
  cash_in         numeric(14,2) NOT NULL DEFAULT 0,
  cash_out        numeric(14,2) NOT NULL DEFAULT 0,
  closing_bank_balance numeric(14,2),
  closed_at       timestamptz,
  closed_by       uuid REFERENCES users(id),
  source_type     text NOT NULL DEFAULT 'api' CHECK (source_type IN ('api','manual','derived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, practice_id, period)
);
CREATE INDEX idx_mfin_period ON monthly_financials(period);

-- ============================================================================
-- CRM: from GoHighLevel (mirror, not master)
-- ============================================================================

CREATE TABLE crm_contacts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid REFERENCES practices(id),
  patient_id      uuid REFERENCES patients(id),        -- matched at ingest time
  external_id     text NOT NULL,
  source_system   text NOT NULL DEFAULT 'ghl',
  first_name      text,
  last_name       text,
  email           citext,
  phone           text,
  tags            text[],
  source          text,                                -- 'meta_lead_ad','google_ads','website_form',...
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);
CREATE INDEX idx_crm_contacts_patient ON crm_contacts(patient_id) WHERE patient_id IS NOT NULL;

CREATE TABLE crm_opportunities (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid REFERENCES practices(id),
  contact_id      uuid REFERENCES crm_contacts(id),
  external_id     text NOT NULL,
  source_system   text NOT NULL DEFAULT 'ghl',
  pipeline        text,
  stage           text,
  treatment       text,
  value           numeric(12,2),
  status          text,                                -- 'open','won','lost','abandoned'
  won_at          timestamptz,
  lost_reason     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);
CREATE INDEX idx_crm_opps_practice ON crm_opportunities(practice_id, status);

CREATE TABLE crm_conversations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id      uuid REFERENCES crm_contacts(id),
  external_id     text NOT NULL,
  source_system   text NOT NULL DEFAULT 'ghl',
  channel         text,                                -- 'sms','whatsapp','email','phone'
  direction       text CHECK (direction IN ('inbound','outbound')),
  body_preview    text,
  occurred_at     timestamptz NOT NULL,
  UNIQUE (source_system, external_id)
);

CREATE TABLE ghl_deep_links (
  -- Configurable deep-links per sub-account / module.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid REFERENCES practices(id),
  module          text NOT NULL,                       -- 'inbox','pipeline','calls','calendar','workflows'
  url             text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- RECONCILIATION
-- ============================================================================

CREATE TABLE reconciliation_runs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_id       uuid REFERENCES entities(id),
  practice_id     uuid REFERENCES practices(id),
  control_code    text NOT NULL,                       -- 'cash_received','revenue_by_practice','aged_debt','treatment_starts','entity_totals'
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  source_value    numeric(14,2),                       -- e.g. Dentally side
  target_value    numeric(14,2),                       -- e.g. accounting side
  variance        numeric(14,2) GENERATED ALWAYS AS (COALESCE(source_value,0) - COALESCE(target_value,0)) STORED,
  variance_pct    numeric(10,4),
  tolerance_pct   numeric(10,4) NOT NULL,
  status          text NOT NULL CHECK (status IN ('green','amber','red')),
  ran_at          timestamptz NOT NULL DEFAULT now(),
  signed_off_by   uuid REFERENCES users(id),
  signed_off_at   timestamptz
);
CREATE INDEX idx_recon_runs_org_date ON reconciliation_runs(organization_id, ran_at DESC);

CREATE TABLE reconciliation_exceptions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          uuid REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid REFERENCES practices(id),
  category        text NOT NULL CHECK (category IN (
    'timing_difference',
    'unmapped_account_code',
    'missing_practice_mapping',
    'duplicate_payment',
    'deleted_or_reversed',
    'manual_override_pending',
    'crm_patient_match_failure'
  )),
  control_code    text NOT NULL,
  source          text,
  amount          numeric(12,2),
  description     text NOT NULL,
  reference_ids   jsonb,                               -- IDs from each system
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','routed','resolved','dismissed')),
  routed_to       uuid REFERENCES users(id),
  resolved_by     uuid REFERENCES users(id),
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recon_exc_open ON reconciliation_exceptions(organization_id, status) WHERE status = 'open';

-- ============================================================================
-- KPI SNAPSHOTS: published to dashboards once reconciled
-- ============================================================================

CREATE TABLE kpi_snapshots (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  practice_id     uuid REFERENCES practices(id),
  snapshot_date   date NOT NULL,
  granularity     text NOT NULL CHECK (granularity IN ('daily','weekly','monthly')),
  revenue         numeric(14,2),
  patients_seen   int,
  appointments    int,
  appointments_completed int,
  appointments_no_show   int,
  chair_utilisation_pct  numeric(5,2),
  fta_rate_pct    numeric(5,2),
  new_leads       int,
  conversions     int,
  conversion_rate_pct numeric(5,2),
  cash_in         numeric(14,2),
  cash_out        numeric(14,2),
  closing_balance numeric(14,2),
  computed_at     timestamptz NOT NULL DEFAULT now(),
  source_quality  text DEFAULT 'reconciled' CHECK (source_quality IN ('reconciled','provisional','manual')),
  UNIQUE (practice_id, snapshot_date, granularity)
);
CREATE INDEX idx_kpi_org_date ON kpi_snapshots(organization_id, snapshot_date DESC);

-- ============================================================================
-- BOARD PACK / QoE
-- ============================================================================

CREATE TABLE board_packs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period          date NOT NULL,                       -- first day of the closed month
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','final')),
  created_by      uuid REFERENCES users(id),
  signed_off_by   uuid REFERENCES users(id),
  signed_off_at   timestamptz,
  pdf_url         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period)
);

CREATE TABLE qoe_addbacks (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  board_pack_id   uuid REFERENCES board_packs(id),
  period          date NOT NULL,
  label           text NOT NULL,
  category        text NOT NULL CHECK (category IN ('add_back','exceptional','run_rate_adjustment','one_off')),
  amount          numeric(14,2) NOT NULL,
  notes           text,
  evidence_url    text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- AUDIT
-- ============================================================================

CREATE TABLE audit_logs (
  -- Immutable audit trail. INSERT ONLY · no UPDATE · no DELETE.
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid REFERENCES organizations(id),
  actor_type      text NOT NULL CHECK (actor_type IN ('user','system','integration')),
  actor_id        uuid,                                -- user_id or integration_id
  action          text NOT NULL,                       -- 'login','upload','approve','export','sync','permission_change','token_refresh',...
  object_type     text,                                -- 'manual_upload','reconciliation_exception','kpi_snapshot',...
  object_id       uuid,
  outcome         text,                                -- 'success','failure','partial'
  ip              inet,
  user_agent      text,
  metadata        jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_date ON audit_logs(organization_id, occurred_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, occurred_at DESC);
CREATE INDEX idx_audit_object ON audit_logs(object_type, object_id) WHERE object_id IS NOT NULL;

-- Prevent updates/deletes on audit_logs at the DB level
CREATE OR REPLACE FUNCTION block_audit_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION block_audit_changes();
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION block_audit_changes();

-- ============================================================================
-- SEED: default roles + permissions
-- ============================================================================

INSERT INTO roles (code, label, owner_only_pages_visible) VALUES
  ('owner',            'Owner',             true),
  ('practice_manager', 'Practice Manager',  false),
  ('reception',        'Reception',         false),
  ('clinician',        'Clinician',         false),
  ('finance_lead',     'Finance Lead',      false);

-- ============================================================================
-- updated_at trigger helper
-- ============================================================================

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to every table that has updated_at
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('CREATE TRIGGER %I_touch_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at();', r.table_name, r.table_name);
  END LOOP;
END $$;

-- END
