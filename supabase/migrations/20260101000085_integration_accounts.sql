-- Multi-subaccount support for GoHighLevel: one credential row per GHL Location,
-- each mapped 1:1 to a practice. The existing integrations row stays a connected
-- marker. Single-account providers (Dentally, Xero) are unaffected.
create table if not exists integration_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  provider text not null,                 -- 'gohighlevel'
  external_account_id text not null,      -- GHL locationId
  practice_id uuid references practices(id) on delete set null,
  label text,
  secrets text,                           -- encrypted PIT (base64), same TEXT format as integrations.secrets on hosted
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active',  -- active | failed | revoked
  webhook_token text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organisation_id, provider, external_account_id)
);

create index if not exists idx_integration_accounts_org_provider
  on integration_accounts(organisation_id, provider);

-- 1 subaccount : 1 practice (only for gohighlevel, only when mapped).
create unique index if not exists idx_integration_accounts_practice
  on integration_accounts(organisation_id, practice_id)
  where practice_id is not null and provider = 'gohighlevel';

-- Fast webhook routing by the random per-account token.
create unique index if not exists idx_integration_accounts_webhook_token
  on integration_accounts(webhook_token) where webhook_token is not null;

-- updated_at trigger.
create or replace function set_integration_accounts_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_integration_accounts_updated_at on integration_accounts;
create trigger trg_integration_accounts_updated_at
  before update on integration_accounts
  for each row execute function set_integration_accounts_updated_at();

-- Backfill: move each existing GHL integrations row into one account row.
-- practice_id is set ONLY when the org has exactly one practice (unambiguous);
-- otherwise NULL and the owner maps it in the UI. webhook_token random per row.
insert into integration_accounts
  (organisation_id, provider, external_account_id, practice_id, label, secrets, config, status, webhook_token)
select
  i.organisation_id,
  'gohighlevel',
  coalesce(i.config->>'locationId', i.id::text),
  (select p.id from practices p
     where p.organisation_id = i.organisation_id
       and (select count(*) from practices p2 where p2.organisation_id = i.organisation_id) = 1
     limit 1),
  'GoHighLevel',
  i.secrets::text,
  coalesce(i.config, '{}'::jsonb),
  coalesce(i.status, 'active'),
  gen_random_uuid()::text
from integrations i
where i.provider = 'gohighlevel'
on conflict (organisation_id, provider, external_account_id) do nothing;

-- Backfill practice_id onto already-synced GHL data, but ONLY for orgs whose
-- single account resolved a practice (safe / unambiguous).
update contacts c
set practice_id = a.practice_id
from integration_accounts a
where a.provider = 'gohighlevel'
  and a.practice_id is not null
  and c.organisation_id = a.organisation_id
  and c.source = 'gohighlevel'
  and c.practice_id is null;

update leads l
set practice_id = a.practice_id
from integration_accounts a
where a.provider = 'gohighlevel'
  and a.practice_id is not null
  and l.organisation_id = a.organisation_id
  and l.ghl_opportunity_id is not null
  and l.practice_id is null;

notify pgrst, 'reload schema';
