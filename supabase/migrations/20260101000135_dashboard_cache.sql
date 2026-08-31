-- Durable dashboard payload cache.
--
-- The in-process TTL cache added alongside the Business Hub fan-out fix is
-- lost on every deploy (and is per-instance), so the first load after each
-- push pays the full 16-aggregate cost again. This table is the second tier:
-- it survives restarts and is shared by every backend instance.
--
-- Rows are pure derived data — safe to truncate at any time.

create table if not exists public.dashboard_cache (
  organisation_id UUID not null references public.organisations(id) on delete cascade,
  cache_key TEXT not null,
  payload JSONB not null,
  expires_at TIMESTAMPTZ not null,
  created_at TIMESTAMPTZ not null default NOW(),
  primary key (organisation_id, cache_key)
);

-- Sweep support for expired rows.
create index if not exists idx_dashboard_cache_expires
  on public.dashboard_cache(expires_at);

alter table public.dashboard_cache enable row level security;
-- Service-role-only table: RLS enabled with NO policies (same idiom as
-- org_features / platform_admins). The app path is serviceClient with an
-- explicit organisation_id filter; anon/authenticated are default-denied.

notify pgrst, 'reload schema';
