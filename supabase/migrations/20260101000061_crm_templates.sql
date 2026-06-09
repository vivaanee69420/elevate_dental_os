-- ============================================================================
-- crm_templates — per-org reusable SMS/email message templates. Bodies carry
-- {{var}} placeholders (first_name, treatment, practice, …) rendered at send
-- time by lib/crm-templates.renderTemplate. Referenced by CRM nurturing
-- sequence steps (B3) and counted by CRM Settings (B2).
-- MULTI-TENANT: every row carries organisation_id; repos write via serviceClient
-- with an explicit organisation_id filter. Soft-delete via is_archived.
-- Idempotent. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS crm_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  name TEXT NOT NULL,
  subject TEXT,                          -- null for sms
  body TEXT NOT NULL,                    -- {{var}} placeholders
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS crm_templates_updated_at ON crm_templates;
CREATE TRIGGER crm_templates_updated_at BEFORE UPDATE ON crm_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_crm_templates_org_channel
  ON crm_templates(organisation_id, channel) WHERE NOT is_archived;
