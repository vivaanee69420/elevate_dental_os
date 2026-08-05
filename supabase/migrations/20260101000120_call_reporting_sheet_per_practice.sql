-- 20260101000120_call_reporting_sheet_per_practice.sql
-- Call Reporting: the client's real layout is ONE spreadsheet with a TAB per
-- practice (Barnet / Ashford / Rochester / …), so uniqueness per
-- (organisation_id, spreadsheet_id) blocked adding the same file for a second
-- practice — the upsert silently renamed the first row instead. One source row
-- per PRACTICE NAME instead: the same spreadsheet may be connected N times,
-- each row pointing at its own tab.
-- Idempotent. After hosted apply run: NOTIFY pgrst, 'reload schema';

drop index if exists public.sheet_sources_org_spreadsheet_key;
create unique index if not exists sheet_sources_org_practice_label_key
  on public.sheet_sources (organisation_id, practice_label);

notify pgrst, 'reload schema';
