-- ============================================================================
-- data_integrity_alerts(p_org) — per-tenant detection of the data problems that
-- a constraint cannot decide, so the next one is found by the system rather than
-- by an owner noticing a number looks about 30% too high.
--
-- WHY THIS EXISTS. Migration 000149 made duplicate Emergent records impossible
-- at the storage layer. That closes one specific hole; it does not tell a tenant
-- when its data is suspect for a reason a unique index is not entitled to judge.
-- The £1,014,647 overstatement that prompted all of this was invisible for
-- months because nothing looked for it. Every tenant now gets the same check.
--
-- SCOPE OF WHAT A CONSTRAINT CAN AND CANNOT DO:
--   * a constraint REJECTS what is definitely wrong (the same record twice);
--   * this RPC REPORTS what is probably wrong but might be legitimate, and
--     leaves the judgement to the person who knows the practice.
--
-- Findings are advisory. Nothing here deletes or rewrites data.
--
-- Tenant-scoped by p_org on every branch, so one tenant can never see another's
-- findings. plpgsql + EXECUTE ... USING because a LANGUAGE sql body with
-- SECURITY DEFINER never inlines and gets planned with p_org unknown (see the
-- 11.1s-vs-55ms RPC planning trap).
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

DROP FUNCTION IF EXISTS data_integrity_alerts(uuid);

CREATE FUNCTION data_integrity_alerts(p_org uuid)
RETURNS TABLE (
  kind text,
  severity text,
  subject text,
  detail text,
  item_count bigint,
  value_pence bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    -- 1. The same patient, treatment and date reported by MORE THAN ONE
    -- business. The natural key deliberately keeps these separate: merging
    -- across businesses would corrupt per-practice P&L, and only a human knows
    -- which business truthfully owns the treatment. So it is reported, not
    -- resolved. Each extra copy inflates the GROUP total.
    SELECT 'accepted_cross_business_duplicate'::text,
           'high'::text,
           t.patient_norm || ' · ' || coalesce(nullif(t.treatment_norm, ''), 'no treatment')
             || ' · ' || to_char(t.accepted_date, 'DD Mon YYYY'),
           'Reported by ' || count(DISTINCT t.business_id)::text
             || ' businesses, so the group total counts it more than once. Fix at source.',
           count(*) - 1,
           (sum(t.value_pence) - max(t.value_pence))::bigint
    FROM treatment_accepted t
    WHERE t.organisation_id = $1
      AND t.status = 'accepted'
      AND t.patient_norm <> ''
    GROUP BY t.patient_norm, t.treatment_norm, t.accepted_date
    HAVING count(DISTINCT t.business_id) > 1

    UNION ALL

    -- 2. Accepted treatments carrying no value. They inflate the accepted COUNT
    -- while contributing nothing to accepted VALUE, which reads as a collapse in
    -- average case value. Usually a plan logged before it was priced — now that
    -- amount is not part of the record identity, pricing it later UPDATES the
    -- row, so these should drain rather than accumulate.
    SELECT 'accepted_unpriced'::text,
           CASE WHEN count(*) > 20 THEN 'medium' ELSE 'low' END::text,
           'Accepted treatments with no value'::text,
           count(*)::text || ' accepted treatment(s) recorded at £0. They raise the '
             || 'accepted count without raising accepted value.',
           count(*),
           0::bigint
    FROM treatment_accepted
    WHERE organisation_id = $1 AND status = 'accepted' AND coalesce(value_pence, 0) = 0
    HAVING count(*) > 0

    UNION ALL

    -- 3. Cash-up rows whose business was never mapped to a practice. Their money
    -- lands in the group total but in no practice, so per-practice revenue
    -- silently under-reports while the group figure looks right — the hardest
    -- kind of wrong to spot by eye.
    SELECT 'cashup_unmapped_practice'::text,
           'high'::text,
           coalesce(business_name, 'unnamed business')::text,
           'Cash-up money is in the group total but attributed to no practice, so '
             || 'per-practice revenue under-reports. Map the business on the '
             || 'Integrations page.',
           count(*),
           sum(coalesce(cash_up_money_taken_pence, 0))::bigint
    FROM emergent_daily_cashup
    WHERE organisation_id = $1 AND practice_id IS NULL
    GROUP BY business_name
    HAVING sum(coalesce(cash_up_money_taken_pence, 0)) > 0

    UNION ALL

    -- 4. Accepted treatments attributed to no practice. Same shape as (3):
    -- counted at group level, missing from every practice breakdown.
    SELECT 'accepted_unmapped_practice'::text,
           'medium'::text,
           'Accepted treatments with no practice'::text,
           count(*)::text || ' accepted treatment(s) are in the group total but '
             || 'attributed to no practice.',
           count(*),
           sum(coalesce(value_pence, 0))::bigint
    FROM treatment_accepted
    WHERE organisation_id = $1 AND status = 'accepted' AND practice_id IS NULL
    HAVING count(*) > 0

    ORDER BY 2, 5 DESC
  $q$ USING p_org;
END;
$fn$;

-- Tenant data: service_role only, same as every other p_org RPC. An anon or
-- authenticated caller must never be able to pass an arbitrary p_org.
REVOKE ALL ON FUNCTION data_integrity_alerts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_integrity_alerts(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
