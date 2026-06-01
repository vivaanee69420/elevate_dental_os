-- ============================================================================
-- Store the raw GoHighLevel pipeline stage on each lead, so the Pipeline screen
-- can render GHL's actual pipeline stages dynamically (instead of mapping every
-- stage onto the fixed Elevate status enum). `status` is still maintained for
-- the other screens (funnel/Leads) via the name heuristic / stage mapping.
-- Idempotent + additive.
-- ============================================================================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_pipeline_stage_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_stage_name TEXT;
