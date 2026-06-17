-- 20260101000103_restamp_treatment_item_practices.sql
-- Self-heal practice attribution on the Practitioner Activity feed
-- (dentally_treatment_items, migration 000099).
--
-- WHY: treatment_plan_items carry only practitioner_id (no site), so practice_id
-- is denormalised at sync time from the practitioner's home site
-- (associates.primary_practice_id). If an item is pulled BEFORE its practitioner
-- lands in the associates roster, it is stranded with practice_id = null and an
-- idempotent upsert never re-corrects it. The "Treatments Completed" card then
-- reads 0 for an individual practice and undercounts the group, because the RPC
-- treatments_completed_by_practice groups by practice_id and null-practice rows
-- fall out of every practice row.
--
-- This RPC re-derives practice_id from the org's (now-complete) roster. It is
-- called after the treatment_items phase of every Dentally sync + the one-time
-- legacy backfill (dentally-sync.js), so attribution converges as the roster
-- fills in. Org-scoped, set-based, idempotent — only rows whose stamped practice
-- differs from the roster are touched. Returns the number of rows re-stamped.
DROP FUNCTION IF EXISTS restamp_treatment_item_practices(UUID);

CREATE OR REPLACE FUNCTION restamp_treatment_item_practices(p_org UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n BIGINT;
BEGIN
  UPDATE dentally_treatment_items ti
  SET practice_id = a.primary_practice_id
  FROM associates a
  WHERE ti.organisation_id = p_org
    AND a.organisation_id = p_org
    AND a.pms_external_id = ti.pms_practitioner_id
    AND a.primary_practice_id IS NOT NULL
    AND ti.practice_id IS DISTINCT FROM a.primary_practice_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION restamp_treatment_item_practices(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
