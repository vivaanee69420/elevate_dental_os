-- 000036  Per-practice assumed chair occupancy (GM Intelligence OS — Chair view)
--
-- Chair economics need a per-practice occupancy %. No derived occupancy source
-- exists (chair_utilisation is a manual grid; appointments are stale), so utilPct
-- is an owner-editable assumption, persisted here and surfaced as a labelled
-- input in the Chair view. NULL => fall back to the group benchmark in code.
-- See GM-INTELLIGENCE-OS-PLAN.md (Chair utilPct data-lineage decision).
--
-- Idempotent.

alter table public.practices
  add column if not exists assumed_util_pct integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'practices_assumed_util_pct_check') then
    alter table public.practices
      add constraint practices_assumed_util_pct_check
      check (assumed_util_pct is null or (assumed_util_pct between 0 and 100));
  end if;
end $$;

notify pgrst, 'reload schema';
