-- Rename the agency organisation to the group it actually is.
--
-- `Plan4growth` was the name the account was created under. Everything it
-- parents is GM Dental — the practices are GM Dental And Implant Centre, GM
-- Dental Ashford, GM Dental Barnet, and the one sub-account is gm dental
-- Rochester — so the name in the topbar, the account switcher and the
-- delete-confirmation prompt named something nobody in the business calls it.
--
-- `organisations.name` is display only: nothing joins on it and nothing is
-- keyed by it. The one place a name is load-bearing is the sub-account delete
-- confirmation, which echoes the row's CURRENT name back, so it follows this
-- automatically.
--
-- Ordering note: 20260101000172_referral_reader_scope.sql seeds org_features
-- by matching `name = 'Plan4growth'`. It runs BEFORE this file on a fresh
-- reset, and on hosted it has already run and stored an organisation_id, so
-- the rename cannot strand that grant either way.

update public.organisations
set name = 'GM Dental Group'
where name = 'Plan4growth'
  and is_agency;

notify pgrst, 'reload schema';
