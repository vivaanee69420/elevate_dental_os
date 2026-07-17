-- ============================================================================
-- practice_cost_model — the per-practice fixed-cost / breakeven / working-days
-- / revenue-target inputs behind the cockpit's "Profit vs Breakeven" section
-- (§6) and its "Daily target" card (§1). Manual inputs; no feed supplies these.
--
-- HISTORISED: one row per (practice, effective_from). Reads take the latest row
-- where effective_from <= the window's start, so a rent rise in July does not
-- rewrite March's profit. Same model as the business-health baseline/targets
-- (migration 000054); chair_utilisation's overwrite-in-place is the anti-pattern
-- this deliberately avoids.
--
-- Money is INTEGER PENCE (rule 2). Every row carries organisation_id (rule 3);
-- repositories filter on it explicitly — the serviceClient path they use has NO
-- automatic isolation.
--
-- RLS is enabled with no policies, matching the other Emergent-era tables: the
-- repositories read via serviceClient (which bypasses RLS), and nothing reaches
-- this table over the tenantClient path.
--
-- Idempotent + additive; re-applies cleanly on a local `supabase db reset`.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
create table if not exists public.practice_cost_model (
  id                         uuid primary key default gen_random_uuid(),
  organisation_id            uuid not null references public.organisations(id) on delete cascade,
  practice_id                uuid not null references public.practices(id) on delete cascade,
  effective_from             date not null,
  fixed_cost_pence_month     bigint,
  breakeven_low_pence        bigint,
  breakeven_high_pence       bigint,
  working_days_per_month     int not null default 20,
  revenue_target_pence_month bigint,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (practice_id, effective_from),
  constraint practice_cost_model_working_days_chk
    check (working_days_per_month between 1 and 31),
  constraint practice_cost_model_breakeven_order_chk
    check (breakeven_low_pence is null or breakeven_high_pence is null
           or breakeven_low_pence <= breakeven_high_pence),
  constraint practice_cost_model_non_negative_chk
    check (coalesce(fixed_cost_pence_month, 0) >= 0
       and coalesce(breakeven_low_pence, 0) >= 0
       and coalesce(breakeven_high_pence, 0) >= 0
       and coalesce(revenue_target_pence_month, 0) >= 0)
);

-- The as-of read: latest effective_from <= window start, per org+practice.
create index if not exists practice_cost_model_org_practice_from_idx
  on public.practice_cost_model (organisation_id, practice_id, effective_from desc);

drop trigger if exists practice_cost_model_updated_at on public.practice_cost_model;
create trigger practice_cost_model_updated_at
  before update on public.practice_cost_model
  for each row execute function set_updated_at();

alter table public.practice_cost_model enable row level security;

-- Reload PostgREST cache after applying:
NOTIFY pgrst, 'reload schema';
