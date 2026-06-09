-- ============================================================================
-- board_report_schedules — recurring delivery config for the Board Report
-- Generator (DentaCFO gap module, Phase 2). One row per scheduled email pack.
-- MULTI-TENANT: every row carries organisation_id; the worker reads/writes via
-- serviceClient with an explicit organisation_id filter (CLAUDE.md rule 3).
--
--   frequency      — 'daily' | 'weekly' | 'monthly' delivery cadence.
--   recipient_email— free-text address the AI pack is emailed to (SES send).
--   report_type    — pack flavour ('board' exec summary by default).
--   active         — soft on/off without deleting the row.
--   last_sent_at   — drives due-detection (a daily job is due when last send
--                    was a different day; weekly >7d; monthly >28d).
--
-- The report itself is computed live at send time from the same analytics
-- rollups the dashboard uses (no stored snapshot). Idempotent + additive.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS board_report_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  recipient_email TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'board'
    CHECK (report_type IN ('board', 'financial', 'operational')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_report_schedules_org
  ON board_report_schedules(organisation_id);
-- The worker scans all active schedules across orgs each tick.
CREATE INDEX IF NOT EXISTS idx_board_report_schedules_active
  ON board_report_schedules(active) WHERE active;

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
