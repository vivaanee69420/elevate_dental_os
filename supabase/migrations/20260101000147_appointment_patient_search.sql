-- ============================================================================
-- Appointments patient search — search the appointments list by patient name,
-- email or phone.
--
-- WHY THIS SHAPE. The obvious query (join appointments -> contacts, ILIKE the
-- name/email/phone columns) plans as a nested loop over the org's appointments
-- probing contacts by primary key, and measured 1,473ms for a single page of 25
-- on Plan4growth (113,786 appointments, 50,873 contacts). Filtering contacts
-- FIRST and semi-joining appointments through (organisation_id, contact_id)
-- brought the same page to 265ms — of which 246ms was the contacts ILIKE alone,
-- because no index could serve it:
--
--   * idx_contacts_name_trgm is on (first_name || ' ' || last_name), which is
--     NULL for the 5,443 contacts missing either half (|| propagates NULL), and
--     no query ever wrote that exact expression, so it was never used at all.
--     It is dropped below: dead index, live write cost on every sync.
--   * idx_contacts_email / idx_contacts_phone are btrees. A leading-wildcard
--     ILIKE '%term%' cannot use a btree.
--
-- So: one STORED blob column holding every searchable field, one trigram GIN
-- index over it, and an RPC that keeps the contacts-first plan. Text matches
-- at word starts (see v_head/v_word below); phone fragments match anywhere.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

-- pg_trgm is already installed (idx_contacts_name_trgm used it). btree_gin lets
-- organisation_id lead the GIN index, so the trigram scan is tenant-scoped in
-- the index rather than filtered after the fact — one org's search never walks
-- another's postings.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ----------------------------------------------------------------------------
-- contacts.search_blob — everything searchable, lowercased, in one column.
--
-- One blob (rather than three indexes) means one predicate, one index, and one
-- place for the term to match: a receptionist types into a single box and does
-- not tell us which field they meant.
--
-- The trailing term is the phone reduced to its last 10 digits. Phones are
-- stored in mixed formats — both '07572605935' and '+447563525289' are live in
-- this database — so without it, searching a number in the format the caller
-- has fails against the format Dentally stored. This is the same normalisation
-- as contacts.phone10 (000139), repeated inline because a generated column may
-- not reference another generated column.
-- ----------------------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS search_blob text
  GENERATED ALWAYS AS (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '')  || ' ' ||
      coalesce(email, '')      || ' ' ||
      coalesce(phone, '')      || ' ' ||
      right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_contacts_org_search_trgm
  ON public.contacts USING gin (organisation_id, search_blob gin_trgm_ops);

-- Superseded by the above, and never usable in the first place (see header).
DROP INDEX IF EXISTS public.idx_contacts_name_trgm;

-- ----------------------------------------------------------------------------
-- appointments_search — one page of appointments whose patient matches p_term.
--
-- Deliberately takes no date bounds. A search is "find this patient's
-- appointments", not "find them inside the window I happen to be looking at" —
-- searching from the Upcoming view would otherwise silently hide every past
-- visit. Practice and associate filters DO still apply, as does patients_only.
--
-- Ordered starts_at DESC (the unsearched list is ASC): with no date bounds,
-- ascending would open on the patient's oldest appointment, so newest-first
-- puts their next and most recent visits on page 1.
--
-- Returns each row as jsonb shaped exactly like the PostgREST embed the
-- unsearched list returns, so the repository hands both paths to the client
-- unchanged. total is the full match count, repeated on every row.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS appointments_search(uuid, text, uuid, uuid, boolean, integer, integer);

CREATE FUNCTION appointments_search(
  p_org uuid,
  p_term text,
  p_practice uuid DEFAULT NULL,
  p_associate uuid DEFAULT NULL,
  p_patients_only boolean DEFAULT true,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (appointment jsonb, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  -- search_blob is already lowercased, so lowercase the term and use LIKE, not
  -- ILIKE: the operator then matches the indexed expression exactly.
  -- %, _ and \ are escaped so a patient whose name contains one is searched
  -- literally instead of turning into a wildcard.
  v_esc    text := replace(replace(replace(
                     lower(btrim(p_term)), '\', '\\'), '%', '\%'), '_', '\_');
  -- Text matches at WORD STARTS, not anywhere: the blob either begins with the
  -- term, or the term follows a space. "smi" still finds Smith; "ann" no longer
  -- drags in Joanne, Hannah and Susanna. On the worst-case term that is 414
  -- matching contacts instead of 1,559, and 6ms instead of 46ms — and the
  -- results are the ones the typist meant. The cost, accepted deliberately, is
  -- that the MIDDLE of a word no longer matches ("mith" will not find Smith).
  v_head   text := v_esc || '%';
  v_word   text := '% ' || v_esc || '%';
  v_digits text := regexp_replace(coalesce(p_term, ''), '[^0-9]', '', 'g');
  -- Phone is the exception that still matches ANYWHERE, because people quote
  -- the tail of a number ("the one ending 605935") at least as often as the
  -- head. Reduced to its last 10 digits so a number stored as '+447572605935'
  -- is found when typed as '07572 605935'; four digits is enough to be a
  -- deliberate fragment rather than a stray digit inside a name or email.
  v_phone  text := CASE WHEN length(v_digits) >= 4
                        THEN '%' || right(v_digits, 10) || '%' END;
BEGIN
  -- plpgsql + EXECUTE ... USING is deliberate and load-bearing. SECURITY
  -- DEFINER and SET search_path both block SQL-function inlining, so a
  -- LANGUAGE sql body would be planned GENERICALLY with p_org unknown and
  -- would not choose the per-contact index probes. Do NOT "simplify" this
  -- back to LANGUAGE sql.
  RETURN QUERY EXECUTE $q$
    WITH matched AS MATERIALIZED (
      -- Contacts first. This is the whole point of the function: it is the
      -- small, selective side, and the GIN index answers it outright.
      SELECT c.id
      FROM contacts c
      WHERE c.organisation_id = $1
        AND (c.search_blob LIKE $2
          OR c.search_blob LIKE $3
          OR ($4 IS NOT NULL AND c.search_blob LIKE $4))
    ),
    hits AS (
      SELECT a.id, a.starts_at, count(*) OVER () AS total
      FROM appointments a
      JOIN matched m ON m.id = a.contact_id
      WHERE a.organisation_id = $1
        AND ($5::uuid IS NULL OR a.practice_id = $5::uuid)
        AND ($6::uuid IS NULL OR a.associate_id = $6::uuid)
        AND (NOT $7::boolean OR a.pms_patient_id IS NOT NULL)
      ORDER BY a.starts_at DESC
      LIMIT $8 OFFSET $9
    )
    SELECT
      to_jsonb(a)
        || jsonb_build_object(
             'contact', to_jsonb(c),
             'associate', CASE WHEN ass.id IS NULL THEN NULL
                               ELSE jsonb_build_object('id', ass.id, 'full_name', ass.full_name) END,
             'practice', CASE WHEN p.id IS NULL THEN NULL
                              ELSE jsonb_build_object('id', p.id, 'name', p.name) END
           ),
      h.total
    FROM hits h
    JOIN appointments a ON a.id = h.id
    -- The contact is guaranteed present (hits came from the join above), and is
    -- narrowed to the display fields here rather than spread across the row.
    JOIN LATERAL (
      SELECT c0.id, c0.first_name, c0.last_name, c0.email, c0.phone
      FROM contacts c0 WHERE c0.id = a.contact_id
    ) c ON true
    LEFT JOIN associates ass ON ass.id = a.associate_id AND ass.organisation_id = $1
    LEFT JOIN practices  p   ON p.id   = a.practice_id  AND p.organisation_id  = $1
    ORDER BY h.starts_at DESC
  $q$ USING p_org, v_head, v_word, v_phone, p_practice, p_associate, p_patients_only, p_limit, p_offset;
END;
$fn$;

REVOKE ALL ON FUNCTION appointments_search(uuid, text, uuid, uuid, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION appointments_search(uuid, text, uuid, uuid, boolean, integer, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
