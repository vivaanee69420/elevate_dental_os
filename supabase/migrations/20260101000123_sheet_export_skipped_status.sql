-- Conversion export: telephone-consultation appointments are excluded from the
-- sheet by owner decision. They need a TERMINAL queue status distinct from
-- no_match (which is revisited for 30 days) and exported (which implies a row
-- was written): 'skipped'.

alter table public.sheet_export_queue
  drop constraint if exists sheet_export_queue_status_check;
alter table public.sheet_export_queue
  add constraint sheet_export_queue_status_check
  check (status in ('pending','processing','exported','no_match','failed','skipped'));

notify pgrst, 'reload schema';
