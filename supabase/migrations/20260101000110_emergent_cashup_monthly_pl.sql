-- Emergent Daily Cash-Up + Monthly P&L storage. Sourced from the Emergent ops
-- app (pull endpoints + webhooks). Idempotent, additive-only, re-appliable.
-- After applying on hosted run: NOTIFY pgrst, 'reload schema';
--
-- Money is integer pence (pounds * 100, rounded). Known fields are typed
-- columns; custom (extra="allow") fields land in *_jsonb so a CEO-added form
-- field survives with no migration.

create table if not exists public.emergent_daily_cashup (
  id                              uuid primary key default gen_random_uuid(),
  organisation_id                 uuid not null references public.organisations(id) on delete cascade,
  business_id                     text not null,
  business_name                   text,
  practice_id                     uuid references public.practices(id) on delete set null,
  cashup_date                     date not null,
  external_id                     text not null,
  treatments_accepted             int,
  tx_plans_given                  int,
  tx_plan_given_value_pence       bigint,
  cash_up_money_taken_pence       bigint,
  num_bookings                    int,
  num_new_leads                   int,
  num_follow_ups                  int,
  num_attended                    int,
  total_chairs                    int,
  chairs_used                     int,
  chair_utilisation               numeric(6,2),
  reviews_collected               int,
  before_after_pictures           int,
  video_testimonials              int,
  practice_plan_signups           int,
  total_refunds_pence             bigint,
  source_google                   int default 0,
  source_facebook                 int default 0,
  source_walk_in                  int default 0,
  source_friends_family           int default 0,
  source_wl_website               int default 0,
  source_dentist_referral         int default 0,
  source_instagram                int default 0,
  source_youtube                  int default 0,
  source_other                    int default 0,
  custom_sources                  jsonb not null default '{}'::jsonb,
  refunds                         jsonb not null default '[]'::jsonb,
  appointment_booked_for          text,
  crm_system_notes                text,
  detail_patient_rows_count       int,
  detail_patient_money_total_pence bigint,
  variance_manager_vs_detail      numeric,
  emergent_created_at             timestamptz,
  emergent_created_by             text,
  raw                             jsonb,
  synced_at                       timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (organisation_id, business_id, cashup_date)
);
create index if not exists emergent_daily_cashup_org_date_idx
  on public.emergent_daily_cashup (organisation_id, cashup_date);
alter table public.emergent_daily_cashup enable row level security;

create table if not exists public.emergent_monthly_pl (
  id                              uuid primary key default gen_random_uuid(),
  organisation_id                 uuid not null references public.organisations(id) on delete cascade,
  business_id                     text not null,
  business_name                   text,
  practice_id                     uuid references public.practices(id) on delete set null,
  period_month                    date not null,
  external_id                     text not null,
  notes                           text,
  revenue_pence                   bigint,
  gross_profit_pence              bigint,
  net_profit_pence                bigint,
  total_cost_of_sales_pence       bigint,
  total_operating_expenses_pence  bigint,
  cash_collected_pence            bigint,
  tx_accepted_amount_pence        bigint,
  bank_balance_pence              bigint,
  average_wait_time               numeric,
  principal_fees_pence            bigint,
  hygienist_therapist_pence       bigint,
  lab_fees_pence                  bigint,
  materials_pence                 bigint,
  sedation_services_pence         bigint,
  advertising_marketing_pence     bigint,
  bank_charges_pence              bigint,
  business_rates_rent_pence       bigint,
  salaries_staff_cost_pence       bigint,
  telephone_wifi_pence            bigint,
  utilities_pence                 bigint,
  insurance_pence                 bigint,
  management_fees_pence           bigint,
  subscriptions_pence             bigint,
  it_expenses_pence               bigint,
  card_machine_charges_pence      bigint,
  custom_lines                    jsonb not null default '{}'::jsonb,
  line_notes                      jsonb not null default '{}'::jsonb,
  raw                             jsonb,
  emergent_created_at             timestamptz,
  emergent_created_by             text,
  last_updated_at                 timestamptz,
  last_updated_by                 text,
  last_updated_by_email           text,
  synced_at                       timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (organisation_id, business_id, period_month)
);
create index if not exists emergent_monthly_pl_org_month_idx
  on public.emergent_monthly_pl (organisation_id, period_month);
alter table public.emergent_monthly_pl enable row level security;

-- Enrich treatment_accepted: persist fields previously dropped into raw.
alter table public.treatment_accepted add column if not exists phone        text;
alter table public.treatment_accepted add column if not exists email        text;
alter table public.treatment_accepted add column if not exists quantity     int;
alter table public.treatment_accepted add column if not exists ext_source   text;
alter table public.treatment_accepted add column if not exists ext_campaign text;
