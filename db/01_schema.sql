-- ============================================================================
-- ELEVATE DENTAL OS — Production Schema
-- ============================================================================
-- Database: PostgreSQL 15+ on Supabase
-- Run order: 01_schema.sql → 02_rls.sql → 03_seed.sql (dev only)
-- All monetary values stored as INTEGER (pence). Display divides by 100.
-- All timestamps UTC. Display in Europe/London.
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy search

-- Helper function: get current organisation_id from JWT
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'organisation_id', '')::UUID;
$$ LANGUAGE SQL STABLE;

-- Helper function: get current user role from JWT
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('request.jwt.claims', true)::json->>'role', 'member');
$$ LANGUAGE SQL STABLE;

-- Helper: updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ORGANISATIONS (tenants)
-- ============================================================================
CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  companies_house_number TEXT,
  vat_number TEXT,
  timezone TEXT DEFAULT 'Europe/London',
  currency TEXT DEFAULT 'GBP',
  subscription_plan TEXT DEFAULT 'trial' CHECK (subscription_plan IN ('trial', 'starter', 'group', 'enterprise', 'cancelled')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  brand_colour TEXT DEFAULT '#0E7C7B',
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER orgs_updated_at BEFORE UPDATE ON organisations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_orgs_slug ON organisations(slug);
CREATE INDEX idx_orgs_stripe ON organisations(stripe_customer_id);

-- ============================================================================
-- USERS (linked 1-1 to auth.users via shared UUID)
-- ============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY, -- matches Supabase auth.users.id
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'reception' CHECK (role IN ('owner', 'practice_manager', 'reception')),
  permissions JSONB DEFAULT '{}', -- granular overrides set by owner
  avatar_url TEXT,
  phone TEXT,
  practice_ids UUID[] DEFAULT '{}', -- which practices this user has access to (NULL/empty = all)
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_users_org ON users(organisation_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================================
-- PRACTICES (each org has 1+)
-- ============================================================================
CREATE TABLE practices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  postcode TEXT,
  phone TEXT,
  email TEXT,
  chairs INTEGER NOT NULL DEFAULT 1,
  opening_hours JSONB DEFAULT '{}',
  nhs_contract_uda INTEGER DEFAULT 0,
  nhs_uda_rate_pence INTEGER DEFAULT 2850, -- £28.50 default
  active BOOLEAN DEFAULT TRUE,
  pms_site_id TEXT, -- Dentally site_id / CSV practice_code -> this practice
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER practices_updated_at BEFORE UPDATE ON practices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_practices_org ON practices(organisation_id);
CREATE INDEX idx_practices_pms_site ON practices(organisation_id, pms_site_id) WHERE pms_site_id IS NOT NULL;

-- ============================================================================
-- BUSINESS HEALTH (setup data + targets)
-- ============================================================================
CREATE TABLE business_health (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID UNIQUE NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  setup_step INTEGER NOT NULL DEFAULT 0,
  setup_completed BOOLEAN NOT NULL DEFAULT FALSE,
  setup_completed_at TIMESTAMPTZ,
  baseline JSONB NOT NULL DEFAULT '{}',
  targets JSONB NOT NULL DEFAULT '{}',
  manual          JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER health_updated_at BEFORE UPDATE ON business_health FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Monthly auto-snapshots
CREATE TABLE business_health_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  label TEXT,
  metrics JSONB NOT NULL,
  inputs JSONB,  -- point-in-time copy of owner manual inputs {baseline,targets,manual}; see 000054
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organisation_id, snapshot_date)
);
CREATE INDEX idx_snapshots_org_date ON business_health_snapshots(organisation_id, snapshot_date DESC);
CREATE INDEX idx_snapshots_inputs_org_date ON business_health_snapshots(organisation_id, snapshot_date DESC) WHERE inputs IS NOT NULL;

-- ============================================================================
-- ASSOCIATES (clinicians)
-- ============================================================================
CREATE TABLE associates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  primary_practice_id UUID REFERENCES practices(id),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  joined_date DATE,
  pay_pct INTEGER NOT NULL DEFAULT 4500, -- 45.00% stored as basis points (4500 = 45%)
  lab_split_pct INTEGER NOT NULL DEFAULT 5000, -- 50%
  gdc_number TEXT,
  specialty TEXT,
  pms_external_id TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER associates_updated_at BEFORE UPDATE ON associates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_associates_org ON associates(organisation_id);
CREATE INDEX idx_associates_practice ON associates(primary_practice_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_associates_org_pms ON associates(organisation_id, pms_external_id);

-- ============================================================================
-- STAFF (non-clinical)
-- ============================================================================
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id),
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reception', 'nurse', 'hygienist', 'therapist', 'manager', 'tco', 'other')),
  hourly_rate_pence INTEGER,
  weekly_hours INTEGER,
  start_date DATE,
  active BOOLEAN DEFAULT TRUE,
  -- Dentally sync fields (migration 000029). `/users` is the team roster; HR
  -- data (rate/hours) is not in Dentally and stays owner-entered.
  source TEXT,
  pms_external_id TEXT,
  pms_role TEXT, -- raw Dentally role string, e.g. "Dentist" / "Receptionist"
  email TEXT,
  phone TEXT,
  title TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_staff_org ON staff(organisation_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_src_ext
  ON staff(organisation_id, source, pms_external_id);

-- ============================================================================
-- CONTACTS (unified: leads + patients + lapsed)
-- ============================================================================
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id),
  type TEXT NOT NULL DEFAULT 'lead' CHECK (type IN ('lead', 'patient', 'lapsed')),
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  date_of_birth DATE,
  address TEXT,
  postcode TEXT,
  source TEXT,
  marketing_consent BOOLEAN DEFAULT FALSE,
  sms_consent BOOLEAN DEFAULT FALSE,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  pms_external_id TEXT, -- link to Dentally / SOE record
  ltv_pence INTEGER DEFAULT 0,
  last_visit_date DATE,
  next_recall_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_contacts_org ON contacts(organisation_id);
CREATE INDEX idx_contacts_practice ON contacts(practice_id);
CREATE INDEX idx_contacts_type ON contacts(type);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_name_trgm ON contacts USING gin ((first_name || ' ' || last_name) gin_trgm_ops);

-- ============================================================================
-- LEADS (CRM pipeline records linked to contacts)
-- ============================================================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id),
  treatment TEXT NOT NULL,
  estimated_value_pence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'contact_attempted', 'contact_made', 'consultation_booked',
    'consultation_attended', 'treatment_started', 'treatment_completed',
    'not_proceeding', 'failed_to_attend'
  )),
  assigned_to UUID REFERENCES users(id),
  source TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  last_response_minutes INTEGER, -- response time to first contact
  expected_close_date DATE,
  actual_close_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_leads_org ON leads(organisation_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_practice ON leads(practice_id);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);
CREATE INDEX idx_leads_created ON leads(created_at DESC);

-- ============================================================================
-- COMMUNICATIONS (email, SMS, calls — unified)
-- ============================================================================
CREATE TABLE communications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id),
  lead_id UUID REFERENCES leads(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'call', 'in_person')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  subject TEXT,
  body TEXT,
  from_address TEXT,
  to_address TEXT,
  delivery_status TEXT DEFAULT 'pending',
  read_at TIMESTAMPTZ,
  external_id TEXT, -- Twilio/Postmark message ID
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_comms_org ON communications(organisation_id);
CREATE INDEX idx_comms_contact ON communications(contact_id);
CREATE INDEX idx_comms_lead ON communications(lead_id);
CREATE INDEX idx_comms_created ON communications(created_at DESC);

-- ============================================================================
-- APPOINTMENTS
-- ============================================================================
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL REFERENCES practices(id),
  contact_id UUID REFERENCES contacts(id),
  associate_id UUID REFERENCES associates(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  appointment_type TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  deposit_pence INTEGER DEFAULT 0,
  deposit_paid BOOLEAN DEFAULT FALSE,
  pms_external_id TEXT,
  pms_patient_id TEXT, -- raw Dentally patient id, so contact_id can be relinked across syncs
  pms_practitioner_id TEXT, -- raw Dentally practitioner id, so associate_id can be relinked across syncs
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_appts_org_date ON appointments(organisation_id, starts_at);
CREATE INDEX idx_appts_associate ON appointments(associate_id, starts_at);
CREATE INDEX idx_appts_practice ON appointments(practice_id, starts_at);
CREATE INDEX idx_appts_status ON appointments(status);
-- relink indexes for raw Dentally ids (partial: only synced rows carry them)
CREATE INDEX idx_appts_pms_patient_id ON appointments(organisation_id, pms_patient_id) WHERE pms_patient_id IS NOT NULL;
CREATE INDEX idx_appts_pms_practitioner_id ON appointments(organisation_id, pms_practitioner_id) WHERE pms_practitioner_id IS NOT NULL;

-- ============================================================================
-- CHAIR UTILISATION (manual owner-entered booked vs available minutes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS chair_utilisation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  chair_name TEXT NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- ISO 1=Mon..7=Sun
  slot TEXT NOT NULL CHECK (slot IN ('morning','midday','afternoon','evening')),
  booked_minutes INT NOT NULL DEFAULT 0 CHECK (booked_minutes >= 0),
  available_minutes INT NOT NULL DEFAULT 0 CHECK (available_minutes >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER chair_utilisation_updated_at BEFORE UPDATE ON chair_utilisation FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX IF NOT EXISTS uq_chair_util_cell ON chair_utilisation(organisation_id, practice_id, chair_name, weekday, slot);

-- Chair-utilisation history: per-practice grid snapshot on every change (000055)
CREATE TABLE IF NOT EXISTS chair_utilisation_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  cells JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organisation_id, practice_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_chair_snapshots_org_practice_date ON chair_utilisation_snapshots(organisation_id, practice_id, snapshot_date DESC);

-- ============================================================================
-- TASKS (todos linked to leads, contacts, or standalone)
-- ============================================================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES users(id),
  due_date DATE,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  related_lead_id UUID REFERENCES leads(id),
  related_contact_id UUID REFERENCES contacts(id),
  completed_at TIMESTAMPTZ,
  reminder_count INT NOT NULL DEFAULT 0,
  last_reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_tasks_org ON tasks(organisation_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ============================================================================
-- WORKFLOWS (automated sequences)
-- ============================================================================
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- 'lead_created', 'status_change', 'tag_added', etc.
  trigger_config JSONB DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]', -- array of step definitions
  active BOOLEAN DEFAULT TRUE,
  total_runs INTEGER DEFAULT 0,
  successful_runs INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_workflows_org ON workflows(organisation_id);

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id),
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  next_step_at TIMESTAMPTZ,
  log JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_wf_runs_org ON workflow_runs(organisation_id);
CREATE INDEX idx_wf_runs_next ON workflow_runs(next_step_at) WHERE status = 'running';

-- ============================================================================
-- PAYMENTS (patient transactions)
-- ============================================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL REFERENCES practices(id),
  contact_id UUID REFERENCES contacts(id),
  lead_id UUID REFERENCES leads(id),
  amount_pence INTEGER NOT NULL,
  currency TEXT DEFAULT 'GBP',
  method TEXT CHECK (method IN ('card', 'apple_pay', 'google_pay', 'bank_transfer', 'cash', 'direct_debit', 'finance', 'card_on_file', 'pay_link')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'settled', 'failed', 'refunded', 'disputed')),
  description TEXT,
  stripe_payment_intent_id TEXT,
  gocardless_payment_id TEXT,
  source TEXT,
  external_id TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_payments_org ON payments(organisation_id);
CREATE INDEX idx_payments_practice ON payments(practice_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_created ON payments(created_at DESC);

-- ============================================================================
-- LAB INVOICES (for associate pay calc + financial tracking)
-- ============================================================================
CREATE TABLE lab_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id),
  supplier_name TEXT NOT NULL,
  invoice_number TEXT,
  invoice_date DATE NOT NULL,
  total_pence INTEGER NOT NULL,
  vat_pence INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'extracted', 'approved', 'paid', 'disputed')),
  line_items JSONB DEFAULT '[]', -- {patient, associate_id, cost, treatment}
  file_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER lab_inv_updated_at BEFORE UPDATE ON lab_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_lab_org ON lab_invoices(organisation_id);

-- ============================================================================
-- PATIENT INVOICES (synced from Dentally; powers Debt Recovery)
-- ============================================================================
CREATE TABLE invoices (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id               UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  contact_id                UUID REFERENCES contacts(id) ON DELETE SET NULL,
  source                    TEXT NOT NULL DEFAULT 'dentally',
  external_id               TEXT,
  amount_pence              INTEGER NOT NULL DEFAULT 0,
  amount_outstanding_pence  INTEGER NOT NULL DEFAULT 0,
  dated_on                  DATE,
  due_on                    DATE,
  paid                      BOOLEAN NOT NULL DEFAULT FALSE,
  treatment                 TEXT,
  patient_name              TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX uq_invoices_src_ext ON invoices(organisation_id, source, external_id);
CREATE INDEX idx_invoices_org_practice ON invoices(organisation_id, practice_id);

-- ============================================================================
-- ASSOCIATE PAY RUNS
-- ============================================================================
CREATE TABLE pay_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  total_gross_pence INTEGER NOT NULL DEFAULT 0,
  total_lab_deductions_pence INTEGER NOT NULL DEFAULT 0,
  total_net_pence INTEGER NOT NULL DEFAULT 0,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER pay_runs_updated_at BEFORE UPDATE ON pay_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_pay_runs_org ON pay_runs(organisation_id);

CREATE TABLE pay_run_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pay_run_id UUID NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  associate_id UUID NOT NULL REFERENCES associates(id),
  production_pence INTEGER NOT NULL DEFAULT 0,
  lab_cost_pence INTEGER NOT NULL DEFAULT 0,
  gross_pence INTEGER NOT NULL DEFAULT 0,
  lab_deduction_pence INTEGER NOT NULL DEFAULT 0,
  prev_balance_pence INTEGER DEFAULT 0,
  net_pence INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_pay_lines_run ON pay_run_lines(pay_run_id);
CREATE INDEX idx_pay_lines_assoc ON pay_run_lines(associate_id);

-- ============================================================================
-- MEMBERSHIP PLANS (loyalty)
-- ============================================================================
CREATE TABLE membership_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  monthly_price_pence INTEGER NOT NULL,
  benefits JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_plans_org ON membership_plans(organisation_id);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id),
  plan_id UUID NOT NULL REFERENCES membership_plans(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'past_due')),
  started_at DATE NOT NULL,
  cancelled_at DATE,
  gocardless_mandate_id TEXT,
  next_payment_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_mem_org ON memberships(organisation_id);
CREATE INDEX idx_mem_contact ON memberships(contact_id);
CREATE INDEX idx_mem_status ON memberships(status);

-- ============================================================================
-- REVIEWS (aggregated from external sources)
-- ============================================================================
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id),
  source TEXT NOT NULL CHECK (source IN ('google', 'trustpilot', 'facebook', 'treatwell', 'direct')),
  external_id TEXT,
  author_name TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  published_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  response_body TEXT,
  flagged_for_recovery BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_reviews_org ON reviews(organisation_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);

-- ============================================================================
-- INTEGRATIONS (OAuth tokens + config)
-- ============================================================================
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'xero', 'dentally', 'truelayer', 'stripe', 'twilio', etc.
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error', 'expired')),
  encrypted_credentials TEXT, -- encrypted via KMS
  config JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organisation_id, provider)
);
CREATE TRIGGER integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- AUDIT LOG (every mutation tracked)
-- ============================================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL, -- 'create', 'update', 'delete', 'login', 'export'
  entity_type TEXT NOT NULL, -- 'lead', 'payment', etc.
  entity_id UUID,
  diff JSONB, -- before/after state
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_org_time ON audit_log(organisation_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- ============================================================================
-- FILES (uploaded documents, lab invoices, etc.)
-- ============================================================================
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id),
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  s3_key TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_files_org ON files(organisation_id);

-- ============================================================================
-- BANK ACCOUNTS + TRANSACTIONS (via TrueLayer)
-- ============================================================================
CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  display_name TEXT,
  account_type TEXT,
  truelayer_account_id TEXT,
  balance_pence INTEGER,
  currency TEXT DEFAULT 'GBP',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bank_accts_org ON bank_accounts(organisation_id);

CREATE TABLE bank_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  truelayer_transaction_id TEXT,
  amount_pence INTEGER NOT NULL, -- negative for debits
  description TEXT,
  category TEXT,
  transaction_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(truelayer_transaction_id)
);
CREATE INDEX idx_bank_tx_org_date ON bank_transactions(organisation_id, transaction_date DESC);

-- ============================================================================
-- DEFAULT MEMBERSHIP PLANS (seed insert for new orgs)
-- ============================================================================
-- Run this after creating a new org:
-- INSERT INTO membership_plans (organisation_id, name, monthly_price_pence, benefits) VALUES
-- (org_id, 'Smile Club Essential', 1495, '["2 hygiene visits", "Annual exam", "10% off treatments"]'),
-- (org_id, 'Smile Club Plus', 2495, '["4 hygiene visits", "Annual exam", "15% off treatments", "Emergency cover"]'),
-- (org_id, 'Smile Club Family', 3995, '["Family of 4", "All Plus benefits"]');

-- ============================================================================
-- DENTALLY SYNC + CSV FEED + XERO (migration 20260101000014) — kept in sync
-- ============================================================================
-- Composite-unique upsert keys (idempotent Dentally poll + CSV import; source namespaces)
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_src_ext
  ON contacts (organisation_id, source, pms_external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_src_ext
  ON appointments (organisation_id, source, pms_external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_src_ext
  ON payments (organisation_id, source, external_id);

CREATE TABLE IF NOT EXISTS monthly_financials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id),
  period TEXT NOT NULL,
  account_code TEXT NOT NULL,
  dental_bucket TEXT CHECK (dental_bucket IN ('revenue','staff','lab','materials','overhead','tax','other')),
  amount_pence INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'xero',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financials
  ON monthly_financials (organisation_id, period, account_code, COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid), source);
CREATE TRIGGER monthly_financials_updated_at BEFORE UPDATE ON monthly_financials FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS xero_account_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL,
  dental_bucket TEXT NOT NULL CHECK (dental_bucket IN ('revenue','staff','lab','materials','overhead','tax','other')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_xero_account_map ON xero_account_map (organisation_id, account_code);

CREATE TABLE IF NOT EXISTS csv_import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  dataset TEXT NOT NULL CHECK (dataset IN ('payments','appointments','patients')),
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  uploaded_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  row_count INTEGER DEFAULT 0,
  valid_count INTEGER DEFAULT 0,
  rejected_count INTEGER DEFAULT 0,
  reject_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_csv_batches_org_status ON csv_import_batches (organisation_id, status);

CREATE TABLE IF NOT EXISTS csv_import_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES csv_import_batches(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw JSONB NOT NULL,
  valid BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_csv_rows_batch ON csv_import_rows (batch_id);

-- Dentally treatment plans = per-practitioner production (see migration 000027).
CREATE TABLE IF NOT EXISTS treatment_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'dentally',
  pms_external_id TEXT NOT NULL,
  pms_practitioner_id TEXT,
  pms_patient_id TEXT,
  associate_id UUID REFERENCES associates(id),
  contact_id UUID REFERENCES contacts(id),
  practice_id UUID REFERENCES practices(id),
  private_value_pence INTEGER NOT NULL DEFAULT 0,
  nhs_uda_value NUMERIC,
  nhs_completed_uda_value NUMERIC,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_treatment_plans_src_ext ON treatment_plans(organisation_id, source, pms_external_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_org ON treatment_plans(organisation_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_assoc ON treatment_plans(organisation_id, associate_id);

-- Notification system (migration 000052): in-app inbox, per-user prefs,
-- outbox deliveries, SES bounce/complaint suppression.
CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  is_platform     boolean NOT NULL DEFAULT false,
  category        text NOT NULL,
  title           text NOT NULL,
  body            text,
  link_url        text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id   uuid NOT NULL,
  category  text NOT NULL,
  in_app    boolean NOT NULL DEFAULT true,
  email     boolean NOT NULL DEFAULT true,
  sms       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text NOT NULL,
  to_address      text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        int  NOT NULL DEFAULT 0,
  last_error      text,
  external_id     text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_drain
  ON notification_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS suppression_list (
  address    text PRIMARY KEY,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ai_context_snapshots — period-keyed cache of the aggregated AI context bundle.
--   One row per (organisation_id, period_key). period_key is 'YYYY-MM' for a
--   month or 'YYYY' for a yearly rollup. is_final=true marks a closed period
--   that is never recomputed. snapshot holds the aggregated, sanitized JSON the
--   AI features read instead of re-running ~10 live rollups per call.
CREATE TABLE IF NOT EXISTS ai_context_snapshots (
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_key      TEXT NOT NULL,
  snapshot        JSONB NOT NULL,
  is_final        BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id, period_key)
);

COMMENT ON SCHEMA public IS 'Elevate Dental OS — Production schema v1.0';
