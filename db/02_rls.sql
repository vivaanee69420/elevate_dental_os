-- ============================================================================
-- ELEVATE DENTAL OS — Row Level Security (RLS) Policies
-- ============================================================================
-- CRITICAL: These policies enforce tenant isolation. Without them, any user
-- could read any organisation's data.
--
-- PRE-REQUISITE: The Supabase Custom Access Token Hook MUST be enabled
-- to inject `organisation_id` and `role` into the JWT claims.
-- Without this hook, current_org_id() returns NULL and ALL queries return zero rows.
--
-- Run after 01_schema.sql
-- ============================================================================

-- Enable RLS on every table
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE associates ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_run_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ORGANISATIONS
-- ============================================================================
-- Users can only see their own org
CREATE POLICY "org_read" ON organisations
  FOR SELECT USING (id = current_org_id());

-- Only owner can update org
CREATE POLICY "org_update" ON organisations
  FOR UPDATE USING (id = current_org_id() AND current_user_role() = 'owner');

-- ============================================================================
-- USERS
-- ============================================================================
CREATE POLICY "users_read_own_org" ON users
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "users_self_update" ON users
  FOR UPDATE USING (id = auth.uid() OR (organisation_id = current_org_id() AND current_user_role() = 'owner'));

CREATE POLICY "users_owner_insert" ON users
  FOR INSERT WITH CHECK (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "users_owner_delete" ON users
  FOR DELETE USING (organisation_id = current_org_id() AND current_user_role() = 'owner' AND id != auth.uid());

-- ============================================================================
-- PRACTICES — all users in org can read, only owner+manager can modify
-- ============================================================================
CREATE POLICY "practices_read" ON practices
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "practices_modify" ON practices
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

-- ============================================================================
-- BUSINESS HEALTH — owner only
-- ============================================================================
CREATE POLICY "health_read_owner" ON business_health
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "health_write_owner" ON business_health
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "snapshots_read_owner" ON business_health_snapshots
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

CREATE POLICY "snapshots_write_owner" ON business_health_snapshots
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

-- ============================================================================
-- ASSOCIATES
-- ============================================================================
CREATE POLICY "associates_read" ON associates
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "associates_modify" ON associates
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

-- ============================================================================
-- STAFF
-- ============================================================================
CREATE POLICY "staff_read" ON staff
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

CREATE POLICY "staff_modify" ON staff
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

-- ============================================================================
-- CONTACTS — all 3 roles can read (CRM is reception's job)
-- ============================================================================
CREATE POLICY "contacts_read" ON contacts
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "contacts_write" ON contacts
  FOR ALL USING (organisation_id = current_org_id());

-- ============================================================================
-- LEADS — all roles can manage (CRM core)
-- ============================================================================
CREATE POLICY "leads_read" ON leads
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "leads_write" ON leads
  FOR ALL USING (organisation_id = current_org_id());

-- ============================================================================
-- COMMUNICATIONS
-- ============================================================================
CREATE POLICY "comms_read" ON communications
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "comms_write" ON communications
  FOR ALL USING (organisation_id = current_org_id());

-- ============================================================================
-- APPOINTMENTS
-- ============================================================================
CREATE POLICY "appts_read" ON appointments
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "appts_write" ON appointments
  FOR ALL USING (organisation_id = current_org_id());

-- ============================================================================
-- TASKS
-- ============================================================================
CREATE POLICY "tasks_read" ON tasks
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "tasks_write" ON tasks
  FOR ALL USING (organisation_id = current_org_id());

-- ============================================================================
-- WORKFLOWS — manager+ only
-- ============================================================================
CREATE POLICY "workflows_read" ON workflows
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

CREATE POLICY "workflows_write" ON workflows
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

CREATE POLICY "wf_runs_read" ON workflow_runs
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "wf_runs_write" ON workflow_runs
  FOR ALL USING (organisation_id = current_org_id());

-- ============================================================================
-- PAYMENTS — sensitive, role-aware
-- ============================================================================
CREATE POLICY "payments_read" ON payments
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() != 'reception');

CREATE POLICY "payments_write" ON payments
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() != 'reception');

-- ============================================================================
-- LAB INVOICES — owner + manager
-- ============================================================================
CREATE POLICY "lab_inv_read" ON lab_invoices
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

CREATE POLICY "lab_inv_write" ON lab_invoices
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

-- ============================================================================
-- PAY RUNS — owner only by default; can grant to PM
-- ============================================================================
CREATE POLICY "pay_runs_read_owner" ON pay_runs
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "pay_runs_write_owner" ON pay_runs
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "pay_run_lines_read" ON pay_run_lines
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "pay_run_lines_write" ON pay_run_lines
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

-- ============================================================================
-- MEMBERSHIP PLANS
-- ============================================================================
CREATE POLICY "plans_read" ON membership_plans
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "plans_write" ON membership_plans
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

CREATE POLICY "memberships_read" ON memberships
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "memberships_write" ON memberships
  FOR ALL USING (organisation_id = current_org_id());

-- ============================================================================
-- REVIEWS
-- ============================================================================
CREATE POLICY "reviews_read" ON reviews
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "reviews_write" ON reviews
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

-- ============================================================================
-- INTEGRATIONS — owner only
-- ============================================================================
CREATE POLICY "integrations_read" ON integrations
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "integrations_write" ON integrations
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

-- ============================================================================
-- AUDIT LOG — owner read-only, system can insert
-- ============================================================================
CREATE POLICY "audit_read_owner" ON audit_log
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "audit_insert_any" ON audit_log
  FOR INSERT WITH CHECK (organisation_id = current_org_id());

-- ============================================================================
-- FILES
-- ============================================================================
CREATE POLICY "files_read" ON files
  FOR SELECT USING (organisation_id = current_org_id());

CREATE POLICY "files_write" ON files
  FOR ALL USING (organisation_id = current_org_id());

-- ============================================================================
-- BANK ACCOUNTS + TRANSACTIONS — owner only (financial)
-- ============================================================================
CREATE POLICY "bank_accts_read_owner" ON bank_accounts
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "bank_accts_write_owner" ON bank_accounts
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "bank_tx_read_owner" ON bank_transactions
  FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

CREATE POLICY "bank_tx_write_owner" ON bank_transactions
  FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

-- ============================================================================
-- SERVICE ROLE BYPASS
-- ============================================================================
-- The backend service role (Fastify API) uses the Supabase service key
-- which bypasses RLS. The backend is responsible for enforcing tenant isolation
-- via the auth middleware before any query is run.
--
-- For background workers (cron jobs), they MUST set the JWT claims explicitly
-- before running queries on behalf of an org.
-- ============================================================================

-- ============================================================================
-- DENTALLY/CSV/XERO tables (migration 20260101000014) — tenant isolation
-- ============================================================================
ALTER TABLE monthly_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_account_map   ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_import_rows    ENABLE ROW LEVEL SECURITY;

CREATE POLICY monthly_financials_org ON monthly_financials
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
CREATE POLICY xero_account_map_org ON xero_account_map
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
CREATE POLICY csv_import_batches_org ON csv_import_batches
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
CREATE POLICY csv_import_rows_org ON csv_import_rows
  USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
