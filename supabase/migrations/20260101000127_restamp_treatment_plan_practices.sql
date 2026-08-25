-- 20260101000127_restamp_treatment_plan_practices.sql
-- treatment_plans.practice_id was never stamped by the Dentally sync (the
-- /treatment_plans feed carries practitioner_id but no site), so every row
-- was NULL and any per-practice view (Data Room practice pills, per-practice
-- production) showed nothing. Same attribution as treatment items
-- (restamp_treatment_item_practices, 000103): the practitioner's home site,
-- associates.primary_practice_id. The sync now stamps new rows and calls this
-- after every run as a self-heal; this migration also backfills once.
DROP FUNCTION IF EXISTS restamp_treatment_plan_practices(UUID);
CREATE OR REPLACE FUNCTION restamp_treatment_plan_practices(p_org UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n BIGINT;
BEGIN
  UPDATE treatment_plans tp
  SET practice_id = a.primary_practice_id
  FROM associates a
  WHERE tp.organisation_id = p_org
    AND a.organisation_id = p_org
    AND a.pms_external_id = tp.pms_practitioner_id::text
    AND a.primary_practice_id IS NOT NULL
    AND tp.practice_id IS DISTINCT FROM a.primary_practice_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION restamp_treatment_plan_practices(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION restamp_treatment_plan_practices(UUID) TO service_role;

-- One-time backfill for every org.
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM organisations LOOP
    PERFORM restamp_treatment_plan_practices(o.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
