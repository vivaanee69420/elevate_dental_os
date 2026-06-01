-- Manual-entry fallback for business-health metrics that have no data source
-- (NPS, retention, recall compliance, lead response time, aged debtors, etc.).
-- Shape: { "<metric_key>": { "value": <number>, "asof": "YYYY-MM-DD" }, ... }
ALTER TABLE business_health
  ADD COLUMN IF NOT EXISTS manual JSONB NOT NULL DEFAULT '{}';
