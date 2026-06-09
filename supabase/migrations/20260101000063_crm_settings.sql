-- ============================================================================
-- crm_settings — one config row per org. Stores the CRM's treatment catalogue
-- (name + default case value in PENCE), lead sources, payment-plan options,
-- GDPR lawful-basis default, quiet-hours window (for the B3 drip engine) and
-- the marketing-consent default. Read by CRM Settings (B2) and the sequence
-- engine (B3); seeded from the mock constants on first read.
-- MULTI-TENANT: PK is organisation_id; repos write via serviceClient with an
-- explicit organisation_id filter.
-- Idempotent. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS crm_settings (
  organisation_id UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  treatments JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{name, default_value_pence}]
  sources TEXT[] NOT NULL DEFAULT '{}',
  payment_plans TEXT[] NOT NULL DEFAULT '{}',
  gdpr_default_basis TEXT NOT NULL DEFAULT 'legitimate_interest'
    CHECK (gdpr_default_basis IN ('consent', 'legitimate_interest', 'contract', 'none')),
  quiet_hours_start TIME NOT NULL DEFAULT '21:00',
  quiet_hours_end TIME NOT NULL DEFAULT '08:00',
  quiet_hours_tz TEXT NOT NULL DEFAULT 'Europe/London',
  marketing_default_consent BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

DROP TRIGGER IF EXISTS crm_settings_updated_at ON crm_settings;
CREATE TRIGGER crm_settings_updated_at BEFORE UPDATE ON crm_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
