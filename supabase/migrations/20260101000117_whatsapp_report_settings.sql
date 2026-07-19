-- ============================================================================
-- whatsapp_report_settings — per-organisation configuration for the daily
-- WhatsApp report delivered via a GoHighLevel Inbound Webhook.
--
-- WHY THIS EXISTS:
-- The owner had no daily pulse on leads/spend/CPL without logging in. A cron
-- job at 18:00 Europe/London POSTs a single-line summary of the PREVIOUS full
-- day to a GHL webhook, which fans it out to WhatsApp. Recipients are managed
-- entirely inside GHL, so this table deliberately stores no phone numbers.
--
-- webhook_url is ENCRYPTED (lib/crypto encryptSecret, AES-256-GCM base64).
-- Possession of the raw URL lets anyone push an arbitrary message to the
-- owner's WhatsApp, so it is treated as a secret, not a config value.
-- ============================================================================

create table if not exists public.whatsapp_report_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  webhook_url     text        not null,
  enabled         boolean     not null default false,
  last_sent_at    timestamptz,
  last_status     text,
  last_error      text,
  last_payload    jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.whatsapp_report_settings enable row level security;

drop policy if exists whatsapp_report_settings_org_isolation on public.whatsapp_report_settings;
create policy whatsapp_report_settings_org_isolation
  on public.whatsapp_report_settings
  for all
  using (organisation_id = current_org_id())
  with check (organisation_id = current_org_id());
