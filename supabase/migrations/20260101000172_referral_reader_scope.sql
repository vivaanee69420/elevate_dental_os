-- Scope the referral app's database role to the organisations it actually serves.
--
-- `gm_referral_reader` is our own referral app: it pays commission when a
-- treatment completes, so it reads appointments, invoices, contacts and
-- practices directly from this database. Its RLS policies were created with
-- USING (true), which exempts it from row-level security entirely.
--
-- Today that means it reads all four organisations, though only Plan4growth
-- holds any of the data it needs (114,025 appointments and 11,302 invoices;
-- the others have none). The 47,309 contacts it can currently read from
-- `developer` and `Ruhith Companies` serve no purpose.
--
-- The reason to change it is not today's exposure — it is the direction of the
-- default. USING (true) means every organisation onboarded from now on has its
-- patient names, contact details, appointments and invoices readable by this
-- role the moment the tenant is created, silently and with no decision taken.
-- This inverts that: an organisation is readable only once someone enables the
-- `referral_app` feature for it, so a new tenant is excluded by default and
-- inclusion is a recorded act.
--
-- `org_features` is reused rather than adding a column: it is already the
-- per-organisation feature switch this product uses (agency model, phase A1),
-- so enabling the referral app for a client is the same gesture as enabling
-- any other module.
--
-- Note the predicate constrains `organisation_id` only. It deliberately does
-- not wrap `updated_at`, which the referral app orders and filters on, so the
-- idx_appointments_updated_at / idx_contacts_updated_at indexes added in
-- 000166 still serve its polling query.

-- 1. Record which organisations the referral app may read. Idempotent, and
--    seeded ONLY with the org that has the data — this must not widen anything
--    on the way in.
insert into public.org_features (organisation_id, feature, enabled)
select o.id, 'referral_app', true
from public.organisations o
where o.name = 'Plan4growth'
on conflict (organisation_id, feature) do update set enabled = true;

-- 2. Replace the blanket policies. Same role, same four tables, same SELECT —
--    only the row set narrows.
do $$
declare t text;
begin
  foreach t in array array['appointments', 'contacts', 'invoices', 'practices']
  loop
    execute format('drop policy if exists gm_referral_reader_select on public.%I', t);
    execute format($f$
      create policy gm_referral_reader_select on public.%I
        for select to gm_referral_reader
        using (
          organisation_id in (
            select f.organisation_id from public.org_features f
            where f.feature = 'referral_app' and f.enabled
          )
        )
    $f$, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
