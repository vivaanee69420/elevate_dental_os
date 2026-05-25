-- Phase 3: per-org integrations table. Stores OAuth tokens + broker-key
-- secrets encrypted at rest. Decrypt only inside lib/<provider>.js — never
-- return secrets via API.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  -- 'stripe' | 'xero' | 'quickbooks' | 'google_calendar' | 'google_ads'
  -- 'meta_ads' | 'mailchimp' | 'slack' | 'docusign' | 'dropbox' | 'zoom'
  -- 'dentally' | 'soe' | 'ses' | 'sns_sms'
  config JSONB NOT NULL DEFAULT '{}',
  -- Encrypted secrets (pgp_sym_encrypt). Plain config in `config`, secrets in `secrets`.
  secrets BYTEA,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verifying', 'active', 'failed', 'revoked')),
  verified_at TIMESTAMPTZ,
  last_error TEXT,
  last_sync_at TIMESTAMPTZ,
  scopes TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, provider)
);

CREATE TRIGGER integrations_updated_at BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_integrations_org      ON integrations(organisation_id);
CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
CREATE INDEX IF NOT EXISTS idx_integrations_status   ON integrations(status);

-- Email/SMS provider event log (bounces, complaints, delivery, opens).
CREATE TABLE IF NOT EXISTS provider_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT,                   -- SES MessageId / Twilio SID / Stripe event id
  event_type TEXT NOT NULL,           -- 'delivered' | 'bounce' | 'complaint' | 'open' | 'click' | 'subscription' | ...
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_events_org     ON provider_events(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_events_extid   ON provider_events(external_id);

-- Phase 6: intra-org email visibility — who inside the org can see this row.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'org',
  -- 'org' | 'role:owner' | 'role:practice_manager' | 'role:reception' | 'user:<uuid>'
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_comms_visibility ON communications(organisation_id, visibility);
CREATE INDEX IF NOT EXISTS idx_comms_assigned   ON communications(assigned_user_id) WHERE assigned_user_id IS NOT NULL;

-- Phase 6: alias → role/user routing for inbound messages.
CREATE TABLE IF NOT EXISTS org_email_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  local_part TEXT NOT NULL,           -- 'accounts' for accounts@theirdental.co.uk
  visibility TEXT NOT NULL,           -- same enum as communications.visibility
  assigned_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, local_part)
);

CREATE INDEX IF NOT EXISTS idx_aliases_org ON org_email_aliases(organisation_id);

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
