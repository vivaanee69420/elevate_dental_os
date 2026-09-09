-- Restore the referral app's read access, which RLS had silently taken away.
--
-- `gm_referral_reader` is our own referral app: it polls this database directly
-- for completed treatments so it can pay commission. Since the RLS lockdown it
-- has been returning NOTHING — and not as an empty result. Every statement it
-- ran in the 24 hours before this migration failed outright:
--
--   215x  select c.id, c.phone, p.pms_site_id, c.updated_at
--         from contacts c left join practices p on p.id = c.practice_id
--         where c.updated_at > $1 ...        -> 42501 permission denied
--                                               for function current_org_id
--
-- plus single probes against appointments and invoices, same SQLSTATE. The
-- feed was fully down, not partly.
--
-- TWO causes, both of which this file addresses. Neither is a missing policy:
-- 000172's `gm_referral_reader_select` policies are present and correct on all
-- four tables, the role holds SELECT on them, and org_features carries the
-- enabled `referral_app` row for the one organisation that may be read.
--
-- 1. The tenant policies from 000130 (appts_read, contacts_read, invoices_read,
--    practices_read, and the ALL-command write policies) were created with no
--    TO clause, so they target PUBLIC -- which includes gm_referral_reader.
--    Postgres evaluates every applicable permissive policy, so it calls
--    current_org_id(), and 000129 had stripped that function's PUBLIC EXECUTE.
--    The privilege check fires before a single row is considered and aborts the
--    whole query.
--
--    Granting EXECUTE gives the role no data. Both functions read
--    request.jwt.claims with missing_ok => true, and a direct Postgres
--    connection never sets that GUC, so they return NULL / 'member'. Every
--    tenant predicate then evaluates to NULL or false:
--      organisation_id = NULL                                  -> NULL
--      organisation_id = NULL AND current_user_role() <> ...    -> NULL
--      organisation_id = NULL AND role IN (owner, pm)           -> false
--    This grants evaluability, not access. The role's row set is still decided
--    solely by its own 000172 policy.
--
-- 2. That 000172 policy subqueries public.org_features, and policy expressions
--    are evaluated with the privileges of the role running the query AND under
--    the referenced table's own RLS. The role had no SELECT on org_features,
--    and org_features has RLS enabled with zero policies -- so the subquery
--    would have failed even once cause 1 was fixed.
--
--    The row policy below limits what that grant can see to the referral_app
--    rows only: exactly the organisation-id list the role's own policy is
--    already keyed on. No other tenant's feature flags become readable.
--
-- The scope decision from 000172 is unchanged and deliberately not touched: an
-- organisation is readable only once someone enables `referral_app` for it, so
-- a new tenant stays excluded by default. Today that is one organisation.
--
-- Everything here is additive and read-only -- SELECT and EXECUTE, no writes,
-- no table the role did not already have, no existing policy dropped or
-- rewritten.
--
-- Note the structural issue this works around rather than fixes: the 000130
-- policies target PUBLIC across all ~46 tables, not just these four. Any
-- future table granted to this role will hit the same wall. Retargeting them
-- to `TO authenticated` is the correct fix and is a separate decision, since
-- it means recreating live RLS on the busiest tables in the database.

-- 1. Let the PUBLIC-targeted tenant policies evaluate for this role.
grant execute on function public.current_org_id()    to gm_referral_reader;
grant execute on function public.current_user_role() to gm_referral_reader;

-- 2. Let the role's own policy read the org list it is keyed on.
grant select on public.org_features to gm_referral_reader;

drop policy if exists gm_referral_reader_features on public.org_features;
create policy gm_referral_reader_features on public.org_features
  for select to gm_referral_reader
  using (feature = 'referral_app' and enabled);

notify pgrst, 'reload schema';
