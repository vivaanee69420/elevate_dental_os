-- ============================================================================
-- Re-enable Row Level Security on every public table (defence in depth).
-- ============================================================================
-- Context (CSO audit 2026-08-25): the hosted project had RLS switched OFF by
-- hand on the 26 tables that migration 000002 protects (and their 54 policies
-- dropped), plus 20 later tables that never had RLS. Migration 000129 already
-- removed every grant from anon/authenticated, so this layer is the second
-- fence: if a grant ever comes back, tenants still cannot see each other.
--
-- Roles that bypass RLS (service_role, postgres) are unaffected — the backend
-- uses service_role everywhere. The out-of-band `gm_referral_reader` role
-- keeps its own USING(true) SELECT policies on contacts/appointments/invoices/
-- practices (owner-confirmed internal referral feed).
--
-- Policies use current_org_id()/current_user_role() (JWT claims). Until the
-- Custom Access Token Hook is enabled in Supabase Auth those return NULL /
-- 'member', so the policies deny — fail-closed, never fail-open.
--
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY.
-- Applied on hosted 2026-08-26 via the Supabase MCP.

-- ---------------------------------------------------------------------------
-- 0. Leftover June dedup backup: stale PII copy, never read by code. Remove.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.contacts_dedup_backup_20260609;

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on every table this migration governs
-- ---------------------------------------------------------------------------
ALTER TABLE public.organisations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practices                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_health            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_health_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.associates                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_runs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_run_lines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions          ENABLE ROW LEVEL SECURITY;
-- tables added after 000002 that never had RLS
ALTER TABLE public.ad_accounts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_metrics                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_reach_cache             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_context_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_decision_lens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_report_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chair_utilisation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_templates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_appointments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_email_aliases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_sources             ENABLE ROW LEVEL SECURITY;
-- no organisation_id column: RLS on with no policy = deny-all for API roles
ALTER TABLE public.notification_deliveries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppression_list           ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. The original 000002 policies, re-applied idempotently
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "org_read"   ON public.organisations;
DROP POLICY IF EXISTS "org_update" ON public.organisations;
CREATE POLICY "org_read"   ON public.organisations FOR SELECT USING (id = current_org_id());
CREATE POLICY "org_update" ON public.organisations FOR UPDATE USING (id = current_org_id() AND current_user_role() = 'owner');

DROP POLICY IF EXISTS "users_read_own_org" ON public.users;
DROP POLICY IF EXISTS "users_self_update"  ON public.users;
DROP POLICY IF EXISTS "users_owner_insert" ON public.users;
DROP POLICY IF EXISTS "users_owner_delete" ON public.users;
CREATE POLICY "users_read_own_org" ON public.users FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "users_self_update"  ON public.users FOR UPDATE USING (id = auth.uid() OR (organisation_id = current_org_id() AND current_user_role() = 'owner'));
CREATE POLICY "users_owner_insert" ON public.users FOR INSERT WITH CHECK (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "users_owner_delete" ON public.users FOR DELETE USING (organisation_id = current_org_id() AND current_user_role() = 'owner' AND id != auth.uid());

DROP POLICY IF EXISTS "practices_read"   ON public.practices;
DROP POLICY IF EXISTS "practices_modify" ON public.practices;
CREATE POLICY "practices_read"   ON public.practices FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "practices_modify" ON public.practices FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

DROP POLICY IF EXISTS "health_read_owner"  ON public.business_health;
DROP POLICY IF EXISTS "health_write_owner" ON public.business_health;
CREATE POLICY "health_read_owner"  ON public.business_health FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "health_write_owner" ON public.business_health FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

DROP POLICY IF EXISTS "snapshots_read_owner"  ON public.business_health_snapshots;
DROP POLICY IF EXISTS "snapshots_write_owner" ON public.business_health_snapshots;
CREATE POLICY "snapshots_read_owner"  ON public.business_health_snapshots FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));
CREATE POLICY "snapshots_write_owner" ON public.business_health_snapshots FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

DROP POLICY IF EXISTS "associates_read"   ON public.associates;
DROP POLICY IF EXISTS "associates_modify" ON public.associates;
CREATE POLICY "associates_read"   ON public.associates FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "associates_modify" ON public.associates FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

DROP POLICY IF EXISTS "staff_read"   ON public.staff;
DROP POLICY IF EXISTS "staff_modify" ON public.staff;
CREATE POLICY "staff_read"   ON public.staff FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));
CREATE POLICY "staff_modify" ON public.staff FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

DROP POLICY IF EXISTS "contacts_read"  ON public.contacts;
DROP POLICY IF EXISTS "contacts_write" ON public.contacts;
CREATE POLICY "contacts_read"  ON public.contacts FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "contacts_write" ON public.contacts FOR ALL USING (organisation_id = current_org_id());

DROP POLICY IF EXISTS "leads_read"  ON public.leads;
DROP POLICY IF EXISTS "leads_write" ON public.leads;
CREATE POLICY "leads_read"  ON public.leads FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "leads_write" ON public.leads FOR ALL USING (organisation_id = current_org_id());

DROP POLICY IF EXISTS "comms_read"  ON public.communications;
DROP POLICY IF EXISTS "comms_write" ON public.communications;
CREATE POLICY "comms_read"  ON public.communications FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "comms_write" ON public.communications FOR ALL USING (organisation_id = current_org_id());

DROP POLICY IF EXISTS "appts_read"  ON public.appointments;
DROP POLICY IF EXISTS "appts_write" ON public.appointments;
CREATE POLICY "appts_read"  ON public.appointments FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "appts_write" ON public.appointments FOR ALL USING (organisation_id = current_org_id());

DROP POLICY IF EXISTS "tasks_read"  ON public.tasks;
DROP POLICY IF EXISTS "tasks_write" ON public.tasks;
CREATE POLICY "tasks_read"  ON public.tasks FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "tasks_write" ON public.tasks FOR ALL USING (organisation_id = current_org_id());

DROP POLICY IF EXISTS "workflows_read"  ON public.workflows;
DROP POLICY IF EXISTS "workflows_write" ON public.workflows;
CREATE POLICY "workflows_read"  ON public.workflows FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));
CREATE POLICY "workflows_write" ON public.workflows FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

DROP POLICY IF EXISTS "wf_runs_read"  ON public.workflow_runs;
DROP POLICY IF EXISTS "wf_runs_write" ON public.workflow_runs;
CREATE POLICY "wf_runs_read"  ON public.workflow_runs FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "wf_runs_write" ON public.workflow_runs FOR ALL USING (organisation_id = current_org_id());

DROP POLICY IF EXISTS "payments_read"  ON public.payments;
DROP POLICY IF EXISTS "payments_write" ON public.payments;
CREATE POLICY "payments_read"  ON public.payments FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() != 'reception');
CREATE POLICY "payments_write" ON public.payments FOR ALL USING (organisation_id = current_org_id() AND current_user_role() != 'reception');

DROP POLICY IF EXISTS "lab_inv_read"  ON public.lab_invoices;
DROP POLICY IF EXISTS "lab_inv_write" ON public.lab_invoices;
CREATE POLICY "lab_inv_read"  ON public.lab_invoices FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));
CREATE POLICY "lab_inv_write" ON public.lab_invoices FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

DROP POLICY IF EXISTS "pay_runs_read_owner"  ON public.pay_runs;
DROP POLICY IF EXISTS "pay_runs_write_owner" ON public.pay_runs;
CREATE POLICY "pay_runs_read_owner"  ON public.pay_runs FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "pay_runs_write_owner" ON public.pay_runs FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

DROP POLICY IF EXISTS "pay_run_lines_read"  ON public.pay_run_lines;
DROP POLICY IF EXISTS "pay_run_lines_write" ON public.pay_run_lines;
CREATE POLICY "pay_run_lines_read"  ON public.pay_run_lines FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "pay_run_lines_write" ON public.pay_run_lines FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

DROP POLICY IF EXISTS "plans_read"  ON public.membership_plans;
DROP POLICY IF EXISTS "plans_write" ON public.membership_plans;
CREATE POLICY "plans_read"  ON public.membership_plans FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "plans_write" ON public.membership_plans FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

DROP POLICY IF EXISTS "memberships_read"  ON public.memberships;
DROP POLICY IF EXISTS "memberships_write" ON public.memberships;
CREATE POLICY "memberships_read"  ON public.memberships FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "memberships_write" ON public.memberships FOR ALL USING (organisation_id = current_org_id());

DROP POLICY IF EXISTS "reviews_read"  ON public.reviews;
DROP POLICY IF EXISTS "reviews_write" ON public.reviews;
CREATE POLICY "reviews_read"  ON public.reviews FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "reviews_write" ON public.reviews FOR ALL USING (organisation_id = current_org_id() AND current_user_role() IN ('owner', 'practice_manager'));

DROP POLICY IF EXISTS "integrations_read"  ON public.integrations;
DROP POLICY IF EXISTS "integrations_write" ON public.integrations;
CREATE POLICY "integrations_read"  ON public.integrations FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "integrations_write" ON public.integrations FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

DROP POLICY IF EXISTS "audit_read_owner" ON public.audit_log;
DROP POLICY IF EXISTS "audit_insert_any" ON public.audit_log;
CREATE POLICY "audit_read_owner" ON public.audit_log FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "audit_insert_any" ON public.audit_log FOR INSERT WITH CHECK (organisation_id = current_org_id());

DROP POLICY IF EXISTS "files_read"  ON public.files;
DROP POLICY IF EXISTS "files_write" ON public.files;
CREATE POLICY "files_read"  ON public.files FOR SELECT USING (organisation_id = current_org_id());
CREATE POLICY "files_write" ON public.files FOR ALL USING (organisation_id = current_org_id());

DROP POLICY IF EXISTS "bank_accts_read_owner"  ON public.bank_accounts;
DROP POLICY IF EXISTS "bank_accts_write_owner" ON public.bank_accounts;
CREATE POLICY "bank_accts_read_owner"  ON public.bank_accounts FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "bank_accts_write_owner" ON public.bank_accounts FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

DROP POLICY IF EXISTS "bank_tx_read_owner"  ON public.bank_transactions;
DROP POLICY IF EXISTS "bank_tx_write_owner" ON public.bank_transactions;
CREATE POLICY "bank_tx_read_owner"  ON public.bank_transactions FOR SELECT USING (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "bank_tx_write_owner" ON public.bank_transactions FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner');

-- ---------------------------------------------------------------------------
-- 3. Tables added after 000002. Org isolation everywhere; role ceiling follows
--    project rule 5 (Reception = CRM only; integrations/settings = owner).
-- ---------------------------------------------------------------------------
-- CRM surfaces: every role in the org
DROP POLICY IF EXISTS "crm_settings_org"     ON public.crm_settings;
DROP POLICY IF EXISTS "crm_templates_org"    ON public.crm_templates;
DROP POLICY IF EXISTS "notifications_org"    ON public.notifications;
DROP POLICY IF EXISTS "ghl_appointments_org" ON public.ghl_appointments;
CREATE POLICY "crm_settings_org"     ON public.crm_settings     FOR ALL USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
CREATE POLICY "crm_templates_org"    ON public.crm_templates    FOR ALL USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
CREATE POLICY "notifications_org"    ON public.notifications    FOR ALL USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());
CREATE POLICY "ghl_appointments_org" ON public.ghl_appointments FOR ALL USING (organisation_id = current_org_id()) WITH CHECK (organisation_id = current_org_id());

-- Growth / intelligence surfaces: not Reception
DROP POLICY IF EXISTS "ad_accounts_org"                ON public.ad_accounts;
DROP POLICY IF EXISTS "ad_metrics_org"                 ON public.ad_metrics;
DROP POLICY IF EXISTS "ad_reach_cache_org"             ON public.ad_reach_cache;
DROP POLICY IF EXISTS "ai_context_snapshots_org"       ON public.ai_context_snapshots;
DROP POLICY IF EXISTS "ai_decision_lens_org"           ON public.ai_decision_lens;
DROP POLICY IF EXISTS "board_report_schedules_org"     ON public.board_report_schedules;
DROP POLICY IF EXISTS "chair_utilisation_snapshots_org" ON public.chair_utilisation_snapshots;
DROP POLICY IF EXISTS "review_sources_org"             ON public.review_sources;
CREATE POLICY "ad_accounts_org"                ON public.ad_accounts                FOR ALL USING (organisation_id = current_org_id() AND current_user_role() <> 'reception') WITH CHECK (organisation_id = current_org_id() AND current_user_role() <> 'reception');
CREATE POLICY "ad_metrics_org"                 ON public.ad_metrics                 FOR ALL USING (organisation_id = current_org_id() AND current_user_role() <> 'reception') WITH CHECK (organisation_id = current_org_id() AND current_user_role() <> 'reception');
CREATE POLICY "ad_reach_cache_org"             ON public.ad_reach_cache             FOR ALL USING (organisation_id = current_org_id() AND current_user_role() <> 'reception') WITH CHECK (organisation_id = current_org_id() AND current_user_role() <> 'reception');
CREATE POLICY "ai_context_snapshots_org"       ON public.ai_context_snapshots       FOR ALL USING (organisation_id = current_org_id() AND current_user_role() <> 'reception') WITH CHECK (organisation_id = current_org_id() AND current_user_role() <> 'reception');
CREATE POLICY "ai_decision_lens_org"           ON public.ai_decision_lens           FOR ALL USING (organisation_id = current_org_id() AND current_user_role() <> 'reception') WITH CHECK (organisation_id = current_org_id() AND current_user_role() <> 'reception');
CREATE POLICY "board_report_schedules_org"     ON public.board_report_schedules     FOR ALL USING (organisation_id = current_org_id() AND current_user_role() <> 'reception') WITH CHECK (organisation_id = current_org_id() AND current_user_role() <> 'reception');
CREATE POLICY "chair_utilisation_snapshots_org" ON public.chair_utilisation_snapshots FOR ALL USING (organisation_id = current_org_id() AND current_user_role() <> 'reception') WITH CHECK (organisation_id = current_org_id() AND current_user_role() <> 'reception');
CREATE POLICY "review_sources_org"             ON public.review_sources             FOR ALL USING (organisation_id = current_org_id() AND current_user_role() <> 'reception') WITH CHECK (organisation_id = current_org_id() AND current_user_role() <> 'reception');

-- Integrations / org configuration: owner only (mirrors integrations_*)
DROP POLICY IF EXISTS "integration_accounts_owner" ON public.integration_accounts;
DROP POLICY IF EXISTS "org_settings_owner"         ON public.org_settings;
DROP POLICY IF EXISTS "org_email_aliases_owner"    ON public.org_email_aliases;
DROP POLICY IF EXISTS "provider_events_owner"      ON public.provider_events;
CREATE POLICY "integration_accounts_owner" ON public.integration_accounts FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner') WITH CHECK (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "org_settings_owner"         ON public.org_settings         FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner') WITH CHECK (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "org_email_aliases_owner"    ON public.org_email_aliases    FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner') WITH CHECK (organisation_id = current_org_id() AND current_user_role() = 'owner');
CREATE POLICY "provider_events_owner"      ON public.provider_events      FOR ALL USING (organisation_id = current_org_id() AND current_user_role() = 'owner') WITH CHECK (organisation_id = current_org_id() AND current_user_role() = 'owner');

-- notification_deliveries / notification_preferences / suppression_list have
-- no organisation_id: RLS on, no policy → API roles denied; worker uses
-- service_role.

NOTIFY pgrst, 'reload schema';
