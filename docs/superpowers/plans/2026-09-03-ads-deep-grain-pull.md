# Ads Deep-Grain Pull — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull and store Meta ad-set/ad and Google ad-group/ad/keyword performance at day grain, so the Facebook and Google reporting pages have data to render, with totals that reconcile exactly to each platform.

**Architecture:** Five new tables — one per grain — sharing an identical core column contract generated from a single definition so they cannot drift. Writes go through one allowlisted replace RPC that deletes and reinserts the 92-day window under an advisory lock; reads go through one allowlisted rollup RPC. No repository ever selects from these tables directly.

**Tech Stack:** Postgres/Supabase (plpgsql RPCs), native-ESM Node backend, vitest, Next.js 14 App Router frontend.

**Spec:** `docs/superpowers/specs/2026-09-03-ads-deep-grain-pull-design.md`

## Global Constraints

- **Money is integer pence.** `spend_pence bigint`. Never floats.
- **`conversions` is `numeric(14,2)`, not integer.** Google reports modelled conversions fractionally; rounding breaks the exact-tally criterion. This deliberately differs from `ad_metrics`.
- **Window is 92 days**, rolling. Constant `DEEP_WINDOW_DAYS = 92`.
- **`parent_id` is `NOT NULL` and part of the unique key.** A Google ad id can appear under several ad groups; without it one ad group's row overwrites another's.
- **Unique key:** `(organisation_id, provider, customer_id, parent_id, entity_id, metric_date)`.
- **No repository may select from these five tables directly.** All reads go through `ad_grain_rollup` / `ad_keyword_rollup`. PostgREST truncates at 1000 rows silently, and keyword grain exceeds that in a single practice-month.
- **RPCs are `LANGUAGE plpgsql` with `RETURN QUERY EXECUTE ... USING`.** A `LANGUAGE sql` function with `SECURITY DEFINER` + `SET search_path` cannot be inlined, is planned with `p_org` UNKNOWN, and degrades from ~55ms to ~11s.
- **Mandatory grant idiom on every RPC:** `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ... TO service_role;`
- **`practice_id` is stamped at the write choke point** from `ad_accounts.practice_id`. Every practice-scoped ad figure in the product read £0 for months when this was missed on `ad_metrics`.
- **Non-GBP accounts are refused, not converted.** Their rows are skipped and the account is flagged.
- **Tenant isolation:** `serviceClient` bypasses RLS, so an explicit `organisation_id` / `p_org` filter on every query IS the only guard.
- **British English in all UI copy** (organisation, colour, optimise, centre).
- **After hosted DDL:** `NOTIFY pgrst, 'reload schema';`
- **Migration number:** `20260101000148_ad_deep_grain.sql`. (`000147` is taken by in-flight appointment-search work.)
- **Google rate limiting arrives as HTTP 403, not 429.** Treat it as retryable, never as an auth failure.

---

### Task 1: Schema — five deep-grain tables

**Files:**
- Create: `supabase/migrations/20260101000148_ad_deep_grain.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `ad_meta_adsets`, `ad_meta_ads`, `ad_google_adgroups`, `ad_google_ads`, `ad_google_keywords`, each with the core contract plus per-grain extras.

- [ ] **Step 1: Write the failing assertion**

Create `/tmp/deep-grain-check.sql`:

```sql
-- Every one of the five tables must exist with the full core contract.
SELECT t.tbl,
       (SELECT count(*) FROM information_schema.columns c
         WHERE c.table_schema='public' AND c.table_name=t.tbl
           AND c.column_name IN ('organisation_id','practice_id','provider','customer_id',
                                 'campaign_id','campaign_name','parent_id','entity_id',
                                 'entity_name','entity_status','metric_date','spend_pence',
                                 'impressions','clicks','conversions')) AS core_cols,
       (SELECT c.is_nullable FROM information_schema.columns c
         WHERE c.table_schema='public' AND c.table_name=t.tbl AND c.column_name='parent_id') AS parent_nullable,
       (SELECT c.data_type FROM information_schema.columns c
         WHERE c.table_schema='public' AND c.table_name=t.tbl AND c.column_name='conversions') AS conv_type
FROM (VALUES ('ad_meta_adsets'),('ad_meta_ads'),('ad_google_adgroups'),
             ('ad_google_ads'),('ad_google_keywords')) AS t(tbl);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase start && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f /tmp/deep-grain-check.sql`

Expected: five rows, every `core_cols` = 0 — the tables do not exist.

- [ ] **Step 3: Write the migration**

```sql
-- ============================================================================
-- Ads deep-grain tables — Meta ad set/ad and Google ad group/ad/keyword, at
-- day grain. Campaign grain stays in ad_metrics and is NOT touched here.
--
-- FIVE SEPARATE TABLES, not one table with a `level` column: a read that
-- omitted the level filter would sum every grain into one figure — spend
-- multiplied five times over. Separate tables make that impossible; there is
-- no column to forget.
--
-- The shared core contract is generated from ONE definition in the loop below
-- so the five cannot drift apart. That is what lets a single rollup RPC serve
-- every grain. Per-grain extras are added afterwards.
--
-- MULTI-TENANT: every row carries organisation_id. serviceClient bypasses RLS,
-- so the explicit organisation_id filter IS the isolation (see CLAUDE.md).
-- RLS is enabled with no policy: anon/authenticated get nothing, service_role
-- bypasses. Idempotent + additive. After applying on hosted:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

DO $mig$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_meta_adsets','ad_meta_ads','ad_google_adgroups',
                           'ad_google_ads','ad_google_keywords']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS public.%I (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        practice_id     uuid REFERENCES practices(id) ON DELETE SET NULL,
        provider        text NOT NULL,
        customer_id     text NOT NULL,
        campaign_id     text NOT NULL,
        campaign_name   text,
        parent_id       text NOT NULL,
        entity_id       text NOT NULL,
        entity_name     text,
        entity_status   text,
        metric_date     date NOT NULL,
        spend_pence     bigint        NOT NULL DEFAULT 0,
        impressions     bigint        NOT NULL DEFAULT 0,
        clicks          bigint        NOT NULL DEFAULT 0,
        conversions     numeric(14,2) NOT NULL DEFAULT 0,
        created_at      timestamptz DEFAULT now(),
        updated_at      timestamptz DEFAULT now(),
        UNIQUE (organisation_id, provider, customer_id, parent_id, entity_id, metric_date)
      )$f$, t);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organisation_id, provider, customer_id, metric_date)',
                   'idx_'||t||'_org_acct_date', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organisation_id, campaign_id, metric_date)',
                   'idx_'||t||'_org_camp_date', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t||'_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t||'_updated_at', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $mig$;

-- Per-grain extras. Meta reports deduplicated reach and frequency at ad set and
-- ad level; Google does not report either at any grain.
ALTER TABLE public.ad_meta_adsets ADD COLUMN IF NOT EXISTS reach     bigint;
ALTER TABLE public.ad_meta_adsets ADD COLUMN IF NOT EXISTS frequency numeric;
ALTER TABLE public.ad_meta_ads    ADD COLUMN IF NOT EXISTS reach     bigint;
ALTER TABLE public.ad_meta_ads    ADD COLUMN IF NOT EXISTS frequency numeric;

-- Keyword extras. Google removed average position in September 2019; impression
-- share and Quality Score are what replaced it as ranking signals.
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS match_type                           text;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS quality_score                        integer;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS creative_quality_score               text;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS post_click_quality_score             text;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS search_predicted_ctr                 text;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS search_impression_share              numeric;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS search_top_impression_share          numeric;
ALTER TABLE public.ad_google_keywords ADD COLUMN IF NOT EXISTS search_absolute_top_impression_share numeric;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: Apply and re-run the assertion**

Run: `supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f /tmp/deep-grain-check.sql`

Expected: five rows; every `core_cols` = 15, every `parent_nullable` = `NO`, every `conv_type` = `numeric`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000148_ad_deep_grain.sql
git commit -m "feat(ads): deep-grain tables for ad set, ad, ad group and keyword

Five separate tables rather than one with a level column, so no read can
sum across grains. The shared core contract is generated from a single
definition in a loop so the five cannot drift.

parent_id is NOT NULL and in the unique key: a Google ad id can appear
under several ad groups, and without it one ad group's row would silently
overwrite another's.

conversions is numeric, not integer — Google reports modelled conversions
fractionally, and rounding would leave our figure permanently off theirs."
```

---

### Task 2: Write path — replace RPC and practice restamp

**Files:**
- Modify: `supabase/migrations/20260101000148_ad_deep_grain.sql` (append)

**Interfaces:**
- Consumes: the five tables from Task 1.
- Produces:
  - `public._ad_grain_table(p_grain text) RETURNS text` — allowlist; raises on unknown grain.
  - `public._ad_grain_provider(p_grain text) RETURNS text`
  - `public.ad_grain_replace_window(p_org uuid, p_grain text, p_customer_ids text[], p_rows jsonb) RETURNS integer`
  - `public.ad_grain_restamp_practices(p_org uuid) RETURNS integer`
  - Valid grains: `meta_adset`, `meta_ad`, `google_adgroup`, `google_ad`, `google_keyword`.

- [ ] **Step 1: Write the failing assertion**

Create `/tmp/deep-grain-write-check.sql`:

```sql
-- Seed one org, practice and account, then replace a window twice with the
-- SAME payload. Idempotency is the direct test of "no duplication".
DO $t$
DECLARE
  v_org uuid; v_practice uuid; v_rows jsonb; v_n1 int; v_n2 int; v_total bigint; v_stamped int;
BEGIN
  SELECT id INTO v_org FROM organisations LIMIT 1;
  INSERT INTO practices (organisation_id, name) VALUES (v_org, 'Test Practice')
    RETURNING id INTO v_practice;
  INSERT INTO ad_accounts (organisation_id, provider, customer_id, name, currency, practice_id)
    VALUES (v_org, 'google_ads', 'C1', 'Acct', 'GBP', v_practice)
    ON CONFLICT (organisation_id, provider, customer_id) DO UPDATE SET practice_id = EXCLUDED.practice_id;

  v_rows := jsonb_build_array(
    jsonb_build_object('organisation_id', v_org, 'provider','google_ads','customer_id','C1',
      'campaign_id','CMP1','campaign_name','Camp','parent_id','AG1','entity_id','KW1',
      'entity_name','dental implants','metric_date','2026-08-01','spend_pence',1000,
      'impressions',100,'clicks',10,'conversions',1.5),
    jsonb_build_object('organisation_id', v_org, 'provider','google_ads','customer_id','C1',
      'campaign_id','CMP1','campaign_name','Camp','parent_id','AG2','entity_id','KW1',
      'entity_name','dental implants','metric_date','2026-08-01','spend_pence',2000,
      'impressions',200,'clicks',20,'conversions',2.5)
  );

  SELECT ad_grain_replace_window(v_org,'google_keyword', ARRAY['C1'], v_rows) INTO v_n1;
  SELECT ad_grain_replace_window(v_org,'google_keyword', ARRAY['C1'], v_rows) INTO v_n2;
  SELECT sum(spend_pence), count(*) FILTER (WHERE practice_id = v_practice)
    INTO v_total, v_stamped FROM ad_google_keywords WHERE organisation_id = v_org;

  RAISE NOTICE 'first=% second=% total_pence=% stamped=%', v_n1, v_n2, v_total, v_stamped;
  ASSERT v_n1 = 2, 'first replace should write 2 rows';
  ASSERT v_n2 = 2, 'second replace should write 2 rows, not 4';
  ASSERT v_total = 3000, 'same keyword under two ad groups must both survive';
  ASSERT v_stamped = 2, 'practice_id must be stamped at write';
END $t$;
```

Note the second row: the **same keyword id under a different ad group**. If `parent_id` were missing from the unique key, one would overwrite the other and the total would be 2000, not 3000.

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f /tmp/deep-grain-write-check.sql`

Expected: FAIL with `function ad_grain_replace_window(...) does not exist`.

- [ ] **Step 3: Append the RPCs to the migration**

```sql
-- ---------------------------------------------------------------------------
-- Grain allowlist. p_grain is a LOOKUP KEY, never an interpolated identifier —
-- no caller-supplied string reaches SQL as a table name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ad_grain_table(p_grain text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_grain
    WHEN 'meta_adset'     THEN 'ad_meta_adsets'
    WHEN 'meta_ad'        THEN 'ad_meta_ads'
    WHEN 'google_adgroup' THEN 'ad_google_adgroups'
    WHEN 'google_ad'      THEN 'ad_google_ads'
    WHEN 'google_keyword' THEN 'ad_google_keywords'
    ELSE NULL
  END;
END $$;

CREATE OR REPLACE FUNCTION public._ad_grain_provider(p_grain text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE
    WHEN p_grain LIKE 'meta_%'   THEN 'meta_ads'
    WHEN p_grain LIKE 'google_%' THEN 'google_ads'
    ELSE NULL
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Replace one account-set's rows for a grain. Mirrors ad_metrics_replace_window
-- (migration 000106) rather than inventing a second pattern.
--
-- DELETES EVERYTHING for those accounts, not just the window, then reinserts
-- the window. That is what keeps these tables at exactly the last 92 days
-- instead of growing without bound. Widening the window later needs a re-pull,
-- which is safe: Google keeps full account history and Meta keeps 37 months.
--
-- The column list is read from information_schema so per-grain extras (reach,
-- quality_score, impression share) are carried automatically and cannot fall
-- out of sync with the table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_grain_replace_window(
  p_org          uuid,
  p_grain        text,
  p_customer_ids text[],
  p_rows         jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tbl text; prov text; cols text; upd text; n integer;
BEGIN
  tbl  := public._ad_grain_table(p_grain);
  prov := public._ad_grain_provider(p_grain);
  IF tbl IS NULL OR prov IS NULL THEN
    RAISE EXCEPTION 'ad_grain_replace_window: unknown grain %', p_grain;
  END IF;

  -- Serialize concurrent replaces for the same (org, grain). Taken BEFORE any
  -- row is touched so a second caller waits on the cheap advisory lock instead
  -- of blocking mid-sequence on row locks held by the first.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_grain, 0));
  SET LOCAL lock_timeout = '15s';
  SET LOCAL statement_timeout = '60s';

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl
     AND column_name NOT IN ('id','created_at','updated_at');

  SELECT string_agg(format('%I = EXCLUDED.%I', column_name, column_name), ', ')
    INTO upd FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = tbl
     AND column_name NOT IN ('id','created_at','updated_at','organisation_id',
                             'provider','customer_id','parent_id','entity_id','metric_date');

  EXECUTE format('DELETE FROM public.%I WHERE organisation_id = $1 AND provider = $2 AND customer_id = ANY($3)', tbl)
    USING p_org, prov, p_customer_ids;

  -- DISTINCT ON guards against an exact duplicate in one payload, which would
  -- otherwise abort the whole INSERT ... ON CONFLICT.
  EXECUTE format($q$
    WITH src AS (
      SELECT DISTINCT ON (customer_id, parent_id, entity_id, metric_date) %2$s
        FROM jsonb_populate_recordset(NULL::public.%1$I, $2)
       WHERE metric_date IS NOT NULL AND entity_id IS NOT NULL
         AND parent_id IS NOT NULL AND organisation_id = $1
       ORDER BY customer_id, parent_id, entity_id, metric_date
    )
    INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM src
    ON CONFLICT (organisation_id, provider, customer_id, parent_id, entity_id, metric_date)
    DO UPDATE SET %3$s
  $q$, tbl, cols, upd) USING p_org, p_rows;

  GET DIAGNOSTICS n = ROW_COUNT;

  -- Stamp practice at the write choke point, from the account mapping.
  EXECUTE format($u$
    UPDATE public.%I t SET practice_id = a.practice_id
      FROM public.ad_accounts a
     WHERE a.organisation_id = t.organisation_id
       AND a.provider    = t.provider
       AND a.customer_id = t.customer_id
       AND t.organisation_id = $1
       AND t.practice_id IS DISTINCT FROM a.practice_id
  $u$, tbl) USING p_org;

  RETURN n;
END $$;

-- Backfill practice_id across all five grains after a mapping change, mirroring
-- restamp_ad_metrics_practices (migration 000140).
CREATE OR REPLACE FUNCTION public.ad_grain_restamp_practices(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; n integer := 0; k integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_meta_adsets','ad_meta_ads','ad_google_adgroups',
                           'ad_google_ads','ad_google_keywords']
  LOOP
    EXECUTE format($u$
      UPDATE public.%I t SET practice_id = a.practice_id
        FROM public.ad_accounts a
       WHERE a.organisation_id = t.organisation_id
         AND a.provider    = t.provider
         AND a.customer_id = t.customer_id
         AND t.organisation_id = $1
         AND t.practice_id IS DISTINCT FROM a.practice_id
    $u$, t) USING p_org;
    GET DIAGNOSTICS k = ROW_COUNT;
    n := n + k;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.ad_grain_replace_window(uuid, text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_grain_replace_window(uuid, text, text[], jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ad_grain_restamp_practices(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_grain_restamp_practices(uuid) TO service_role;
```

- [ ] **Step 4: Apply and re-run the assertion**

Run: `supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f /tmp/deep-grain-write-check.sql`

Expected: `NOTICE: first=2 second=2 total_pence=3000 stamped=2`, no assertion failure.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000148_ad_deep_grain.sql
git commit -m "feat(ads): allowlisted replace RPC and practice restamp for deep grain

One write RPC for all five grains. p_grain is an allowlist lookup key, so
no caller-supplied string ever reaches SQL as a table name. Column lists
are read from information_schema, so per-grain extras cannot fall out of
sync with the table.

The replace deletes the account's rows outright before reinserting the
window, which is what holds these tables at exactly 92 days rather than
letting them grow without bound.

practice_id is stamped inside the RPC — the write choke point — because
every practice-scoped ad figure read GBP 0 for months when ad_metrics
missed that stamp."
```

---

### Task 3: Read path — rollup RPCs

**Files:**
- Modify: `supabase/migrations/20260101000148_ad_deep_grain.sql` (append)

**Interfaces:**
- Consumes: `_ad_grain_table` from Task 2.
- Produces:
  - `public.ad_grain_rollup(p_org uuid, p_grain text, p_since date, p_until date, p_practice uuid, p_campaign text, p_parent text)` returning `(entity_id text, entity_name text, parent_id text, campaign_id text, campaign_name text, entity_status text, spend_pence bigint, impressions bigint, clicks bigint, conversions numeric)`
  - `public.ad_keyword_rollup(p_org uuid, p_since date, p_until date, p_practice uuid, p_campaign text, p_parent text)` returning the same columns plus `(match_type text, quality_score numeric, search_impression_share numeric, search_top_impression_share numeric, search_absolute_top_impression_share numeric)`

- [ ] **Step 1: Write the failing assertion**

Append to `/tmp/deep-grain-write-check.sql` a second block (run after the first, so the rows exist):

```sql
DO $t$
DECLARE v_org uuid; v_rows int; v_spend bigint;
BEGIN
  SELECT id INTO v_org FROM organisations LIMIT 1;
  SELECT count(*), sum(spend_pence) INTO v_rows, v_spend
    FROM ad_grain_rollup(v_org, 'google_keyword', '2026-07-01', '2026-08-31', NULL, NULL, NULL);
  RAISE NOTICE 'rollup rows=% spend=%', v_rows, v_spend;
  -- The same keyword under two ad groups must stay TWO rows, not be merged.
  ASSERT v_rows = 2, 'rollup must group by (entity_id, parent_id), not entity_id alone';
  ASSERT v_spend = 3000, 'rollup total must equal the stored total';

  -- Parent filter narrows to one ad group.
  SELECT count(*), sum(spend_pence) INTO v_rows, v_spend
    FROM ad_grain_rollup(v_org, 'google_keyword', '2026-07-01', '2026-08-31', NULL, NULL, 'AG1');
  ASSERT v_rows = 1 AND v_spend = 1000, 'parent filter must scope to one ad group';

  -- An unknown grain must raise, never silently return nothing.
  BEGIN
    PERFORM * FROM ad_grain_rollup(v_org, 'not_a_grain', '2026-07-01', '2026-08-31', NULL, NULL, NULL);
    RAISE EXCEPTION 'unknown grain should have raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%unknown grain%' THEN NULL; ELSE RAISE; END IF;
  END;
END $t$;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f /tmp/deep-grain-write-check.sql`

Expected: FAIL with `function ad_grain_rollup(...) does not exist`.

- [ ] **Step 3: Append the rollup RPCs**

```sql
-- ---------------------------------------------------------------------------
-- The ONLY read path for the deep-grain tables. No repository selects from
-- them directly: PostgREST truncates at 1000 rows without saying so, and one
-- practice-month of keyword rows is well past that.
--
-- plpgsql + RETURN QUERY EXECUTE ... USING is load-bearing. A LANGUAGE sql
-- function with SECURITY DEFINER + SET search_path cannot be inlined, so it is
-- planned with p_org UNKNOWN — measured elsewhere in this codebase at 11.1s
-- against 55ms for the plpgsql form.
--
-- GROUP BY (entity_id, parent_id), not entity_id alone: a Google ad or keyword
-- can live under several ad groups and they are genuinely different rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_grain_rollup(
  p_org      uuid,
  p_grain    text,
  p_since    date,
  p_until    date,
  p_practice uuid DEFAULT NULL,
  p_campaign text DEFAULT NULL,
  p_parent   text DEFAULT NULL
) RETURNS TABLE (
  entity_id text, entity_name text, parent_id text,
  campaign_id text, campaign_name text, entity_status text,
  spend_pence bigint, impressions bigint, clicks bigint, conversions numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tbl text;
BEGIN
  tbl := public._ad_grain_table(p_grain);
  IF tbl IS NULL THEN
    RAISE EXCEPTION 'ad_grain_rollup: unknown grain %', p_grain;
  END IF;

  RETURN QUERY EXECUTE format($q$
    SELECT g.entity_id,
           max(g.entity_name)   AS entity_name,
           g.parent_id,
           max(g.campaign_id)   AS campaign_id,
           max(g.campaign_name) AS campaign_name,
           max(g.entity_status) AS entity_status,
           sum(g.spend_pence)::bigint  AS spend_pence,
           sum(g.impressions)::bigint  AS impressions,
           sum(g.clicks)::bigint       AS clicks,
           sum(g.conversions)::numeric AS conversions
      FROM public.%I g
     WHERE g.organisation_id = $1
       AND g.metric_date >= $2
       AND g.metric_date <= $3
       AND ($4::uuid IS NULL OR g.practice_id  = $4)
       AND ($5::text IS NULL OR g.campaign_id  = $5)
       AND ($6::text IS NULL OR g.parent_id    = $6)
     GROUP BY g.entity_id, g.parent_id
  $q$, tbl) USING p_org, p_since, p_until, p_practice, p_campaign, p_parent;
END $$;

-- Keyword-specific read. Quality Score and impression share are point-in-time
-- ratios, not sums.
--
-- KNOWN LIMITATION, carried deliberately: impression share is stored per day
-- and aggregated here as an IMPRESSION-WEIGHTED AVERAGE. Google computes its
-- own range figure from eligible impressions, which the API does not expose, so
-- a multi-day impression share may differ slightly from Google's. It is
-- labelled as approximate in the UI. Spend, clicks, impressions and conversions
-- are exact; only these ratios are not.
CREATE OR REPLACE FUNCTION public.ad_keyword_rollup(
  p_org      uuid,
  p_since    date,
  p_until    date,
  p_practice uuid DEFAULT NULL,
  p_campaign text DEFAULT NULL,
  p_parent   text DEFAULT NULL
) RETURNS TABLE (
  entity_id text, entity_name text, parent_id text,
  campaign_id text, campaign_name text, entity_status text,
  spend_pence bigint, impressions bigint, clicks bigint, conversions numeric,
  match_type text, quality_score numeric,
  search_impression_share numeric,
  search_top_impression_share numeric,
  search_absolute_top_impression_share numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT g.entity_id,
           max(g.entity_name)   AS entity_name,
           g.parent_id,
           max(g.campaign_id)   AS campaign_id,
           max(g.campaign_name) AS campaign_name,
           max(g.entity_status) AS entity_status,
           sum(g.spend_pence)::bigint  AS spend_pence,
           sum(g.impressions)::bigint  AS impressions,
           sum(g.clicks)::bigint       AS clicks,
           sum(g.conversions)::numeric AS conversions,
           max(g.match_type)           AS match_type,
           -- Latest non-null Quality Score in the range, not an average: it is
           -- a 1-10 grade Google assigns, and averaging grades is meaningless.
           (array_agg(g.quality_score ORDER BY g.metric_date DESC)
              FILTER (WHERE g.quality_score IS NOT NULL))[1]::numeric AS quality_score,
           CASE WHEN sum(g.impressions) > 0
                THEN sum(g.search_impression_share * g.impressions) / sum(g.impressions)
                END AS search_impression_share,
           CASE WHEN sum(g.impressions) > 0
                THEN sum(g.search_top_impression_share * g.impressions) / sum(g.impressions)
                END AS search_top_impression_share,
           CASE WHEN sum(g.impressions) > 0
                THEN sum(g.search_absolute_top_impression_share * g.impressions) / sum(g.impressions)
                END AS search_absolute_top_impression_share
      FROM public.ad_google_keywords g
     WHERE g.organisation_id = $1
       AND g.metric_date >= $2
       AND g.metric_date <= $3
       AND ($4::uuid IS NULL OR g.practice_id = $4)
       AND ($5::text IS NULL OR g.campaign_id = $5)
       AND ($6::text IS NULL OR g.parent_id   = $6)
     GROUP BY g.entity_id, g.parent_id
  $q$ USING p_org, p_since, p_until, p_practice, p_campaign, p_parent;
END $$;

REVOKE ALL ON FUNCTION public.ad_grain_rollup(uuid, text, date, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_grain_rollup(uuid, text, date, date, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ad_keyword_rollup(uuid, date, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_keyword_rollup(uuid, date, date, uuid, text, text) TO service_role;
```

- [ ] **Step 4: Apply and re-run**

Run: `supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f /tmp/deep-grain-write-check.sql`

Expected: `NOTICE: rollup rows=2 spend=3000`, no assertion failure.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000148_ad_deep_grain.sql
git commit -m "feat(ads): rollup RPCs as the only read path for deep grain

plpgsql with RETURN QUERY EXECUTE ... USING, not LANGUAGE sql: a SECURITY
DEFINER sql function with SET search_path cannot be inlined and gets
planned with p_org UNKNOWN, which measured 11.1s against 55ms elsewhere
in this codebase.

Groups by (entity_id, parent_id) because the same ad or keyword can live
under several ad groups.

Keyword impression share is an impression-weighted average and labelled
approximate: Google derives its range figure from eligible impressions,
which the API does not expose. Spend, clicks and conversions stay exact."
```

---

### Task 4: Repository — `adGrainRepository`

**Files:**
- Create: `backend/src/repositories/ad-grain.repository.js`
- Test: `backend/test/ad-grain.repository.test.mjs`

**Interfaces:**
- Consumes: RPCs from Tasks 2 and 3.
- Produces:
  - `GRAINS` — frozen array `['meta_adset','meta_ad','google_adgroup','google_ad','google_keyword']`
  - `adGrainRepository.replaceWindow(orgId, grain, customerIds, rows) -> Promise<number>`
  - `adGrainRepository.rollup(orgId, grain, { since, until, practiceId, campaignId, parentId }) -> Promise<Array>`
  - `adGrainRepository.keywordRollup(orgId, { since, until, practiceId, campaignId, parentId }) -> Promise<Array>`
  - `adGrainRepository.restampPractices(orgId) -> Promise<number>`

- [ ] **Step 1: Write the failing test**

```javascript
// Deep-grain repository — RPC-only access. There is deliberately no method
// that selects from the five tables directly: PostgREST truncates at 1000
// rows in silence, and keyword grain passes that inside a single month.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { adGrainRepository, GRAINS } = await import('../src/repositories/ad-grain.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
    supaRec.rpcCalls = [];
    supaRec.rpcProvider = (fn) => ({ data: fn === 'ad_grain_replace_window' ? 7 : [], error: null });
});

describe('grain allowlist', () => {
    it('names exactly the five supported grains', () => {
        expect([...GRAINS]).toEqual(['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword']);
    });

    it('refuses an unknown grain before it reaches the database', async () => {
        await expect(adGrainRepository.rollup(ORG, 'search_term', { since: '2026-08-01', until: '2026-08-31' }))
            .rejects.toThrow(/unknown grain/i);
        expect(supaRec.rpcCalls).toHaveLength(0);
    });
});

describe('replaceWindow', () => {
    it('passes org, grain, accounts and rows through to the RPC', async () => {
        const rows = [{ entity_id: 'KW1' }];
        const n = await adGrainRepository.replaceWindow(ORG, 'google_keyword', ['C1'], rows);
        const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_grain_replace_window');
        expect(call.params).toEqual({
            p_org: ORG, p_grain: 'google_keyword', p_customer_ids: ['C1'], p_rows: rows,
        });
        expect(n).toBe(7);
    });

    it('does not call the database with an empty payload', async () => {
        const n = await adGrainRepository.replaceWindow(ORG, 'google_keyword', ['C1'], []);
        expect(supaRec.rpcCalls).toHaveLength(0);
        expect(n).toBe(0);
    });
});

describe('rollup', () => {
    it('sends nulls for absent filters rather than omitting them', async () => {
        await adGrainRepository.rollup(ORG, 'meta_ad', { since: '2026-08-01', until: '2026-08-31' });
        const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_grain_rollup');
        expect(call.params).toEqual({
            p_org: ORG, p_grain: 'meta_ad', p_since: '2026-08-01', p_until: '2026-08-31',
            p_practice: null, p_campaign: null, p_parent: null,
        });
    });

    it('surfaces an RPC error rather than returning an empty list', async () => {
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'boom' } });
        await expect(adGrainRepository.rollup(ORG, 'meta_ad', { since: '2026-08-01', until: '2026-08-31' }))
            .rejects.toThrow(/ad_grain_rollup: boom/);
    });
});

describe('keywordRollup', () => {
    it('calls the keyword-specific RPC, which carries no grain parameter', async () => {
        await adGrainRepository.keywordRollup(ORG, { since: '2026-08-01', until: '2026-08-31', campaignId: 'CMP1' });
        const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_keyword_rollup');
        expect(call.params).toEqual({
            p_org: ORG, p_since: '2026-08-01', p_until: '2026-08-31',
            p_practice: null, p_campaign: 'CMP1', p_parent: null,
        });
    });
});

// serviceClient bypasses RLS, so p_org IS the tenant boundary on this path.
// A method that forgot it would read or write every organisation's rows.
describe('cross-org isolation', () => {
    it('sends an organisation id on every call this repository makes', async () => {
        await adGrainRepository.rollup(ORG, 'meta_ad', { since: '2026-08-01', until: '2026-08-31' });
        await adGrainRepository.keywordRollup(ORG, { since: '2026-08-01', until: '2026-08-31' });
        await adGrainRepository.replaceWindow(ORG, 'meta_ad', ['act1'], [{ entity_id: 'A' }]);
        await adGrainRepository.restampPractices(ORG);

        expect(supaRec.rpcCalls).toHaveLength(4);
        for (const call of supaRec.rpcCalls) {
            expect(call.params.p_org).toBe(ORG);
        }
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/ad-grain.repository.test.mjs`
Expected: FAIL — cannot resolve `../src/repositories/ad-grain.repository.js`.

- [ ] **Step 3: Write the repository**

```javascript
// ============================================================================
// Deep-grain ad repository — Meta ad set/ad and Google ad group/ad/keyword.
//
// RPC-ONLY BY DESIGN. There is no method here that selects from the five
// tables, and none should be added: PostgREST caps a response at 1000 rows
// server-side and says nothing about it, and one practice-month of keyword
// rows is comfortably past that. Every read goes through a rollup RPC that
// aggregates in SQL.
//
// MULTI-TENANT: serviceClient bypasses RLS, so p_org IS the isolation.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const GRAINS = Object.freeze([
    'meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword',
]);

// Fail here rather than at the database. The RPC also validates, but a bad
// grain caught in JS gives a stack trace pointing at the caller.
function assertGrain(grain) {
    if (!GRAINS.includes(grain)) {
        throw new Error(`ad-grain: unknown grain '${grain}' (expected one of ${GRAINS.join(', ')})`);
    }
}

// Absent filters are sent as explicit nulls. Omitting a key would make
// PostgREST fall back to the function's DEFAULT, which happens to be null
// today — relying on that couples this file to the RPC's signature.
function filterParams({ practiceId = null, campaignId = null, parentId = null } = {}) {
    return { p_practice: practiceId ?? null, p_campaign: campaignId ?? null, p_parent: parentId ?? null };
}

export const adGrainRepository = {
    async replaceWindow(orgId, grain, customerIds, rows) {
        assertGrain(grain);
        // An empty pull must never reach the RPC: it would delete the window
        // and write nothing back, wiping good history on a transient glitch.
        if (!Array.isArray(rows) || rows.length === 0) return 0;
        if (!Array.isArray(customerIds) || customerIds.length === 0) return 0;
        const { data, error } = await supabase_1.serviceClient.rpc('ad_grain_replace_window', {
            p_org: orgId, p_grain: grain, p_customer_ids: customerIds, p_rows: rows,
        });
        if (error) throw new Error(`ad_grain_replace_window: ${error.message}`);
        return Number(data ?? 0);
    },

    async rollup(orgId, grain, { since, until, ...filters } = {}) {
        assertGrain(grain);
        const { data, error } = await supabase_1.serviceClient.rpc('ad_grain_rollup', {
            p_org: orgId, p_grain: grain, p_since: since, p_until: until, ...filterParams(filters),
        });
        if (error) throw new Error(`ad_grain_rollup: ${error.message}`);
        return Array.isArray(data) ? data : [];
    },

    async keywordRollup(orgId, { since, until, ...filters } = {}) {
        const { data, error } = await supabase_1.serviceClient.rpc('ad_keyword_rollup', {
            p_org: orgId, p_since: since, p_until: until, ...filterParams(filters),
        });
        if (error) throw new Error(`ad_keyword_rollup: ${error.message}`);
        return Array.isArray(data) ? data : [];
    },

    async restampPractices(orgId) {
        const { data, error } = await supabase_1.serviceClient.rpc('ad_grain_restamp_practices', { p_org: orgId });
        if (error) throw new Error(`ad_grain_restamp_practices: ${error.message}`);
        return Number(data ?? 0);
    },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/ad-grain.repository.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/ad-grain.repository.js backend/test/ad-grain.repository.test.mjs
git commit -m "feat(ads): deep-grain repository, RPC-only by design

No method selects from the five tables and none should be added. PostgREST
caps responses at 1000 rows server-side without reporting it, and a single
practice-month of keyword rows is past that.

replaceWindow refuses an empty payload: sending one would delete the window
and write nothing back, destroying good history on a transient glitch."
```

---

### Task 5: Currency guard

**Files:**
- Create: `backend/src/lib/integrations/ad-currency.js`
- Test: `backend/test/ad-currency.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SUPPORTED_CURRENCY` — `'GBP'`
  - `isSupportedCurrency(currency) -> boolean` (null/undefined treated as supported)
  - `partitionAccountsByCurrency(accounts) -> { supported: string[], unsupported: Array<{customer_id, currency}> }` where `accounts` is `Array<{customer_id, currency}>`

- [ ] **Step 1: Write the failing test**

```javascript
// Currency guard. microsToPence and spendToPence both assume the account is
// billed in GBP — they divide and call the result pence with no conversion.
// A USD account is connected (deselected today), and selecting it would make
// every group total silently larger. Refuse rather than convert.
import { describe, it, expect } from 'vitest';

const { isSupportedCurrency, partitionAccountsByCurrency, SUPPORTED_CURRENCY } =
    await import('../src/lib/integrations/ad-currency.js');

describe('isSupportedCurrency', () => {
    it('accepts GBP in any case', () => {
        expect(isSupportedCurrency('GBP')).toBe(true);
        expect(isSupportedCurrency('gbp')).toBe(true);
    });

    it('rejects any other currency', () => {
        expect(isSupportedCurrency('USD')).toBe(false);
        expect(isSupportedCurrency('EUR')).toBe(false);
    });

    // Three connected Google accounts have a null currency. Treating them as
    // unsupported would drop live spend that is almost certainly GBP; they are
    // surfaced in the reconciliation panel instead.
    it('treats an unknown currency as supported, to be flagged not dropped', () => {
        expect(isSupportedCurrency(null)).toBe(true);
        expect(isSupportedCurrency(undefined)).toBe(true);
        expect(isSupportedCurrency('')).toBe(true);
    });

    it('names GBP as the supported currency', () => {
        expect(SUPPORTED_CURRENCY).toBe('GBP');
    });
});

describe('partitionAccountsByCurrency', () => {
    it('splits ids to sync from accounts to flag', () => {
        const { supported, unsupported } = partitionAccountsByCurrency([
            { customer_id: 'A', currency: 'GBP' },
            { customer_id: 'B', currency: 'USD' },
            { customer_id: 'C', currency: null },
        ]);
        expect(supported).toEqual(['A', 'C']);
        expect(unsupported).toEqual([{ customer_id: 'B', currency: 'USD' }]);
    });

    it('handles an empty list', () => {
        expect(partitionAccountsByCurrency([])).toEqual({ supported: [], unsupported: [] });
        expect(partitionAccountsByCurrency(undefined)).toEqual({ supported: [], unsupported: [] });
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/ad-currency.test.mjs`
Expected: FAIL — cannot resolve `../src/lib/integrations/ad-currency.js`.

- [ ] **Step 3: Write the module**

```javascript
// ============================================================================
// Currency guard for ad spend.
//
// microsToPence (Google) and spendToPence (Meta) both divide the platform's
// figure and call the result pence, with NO currency conversion. That is
// correct only while every account bills in GBP. One USD Google account is
// connected — deselected today, so nothing is wrong now, but selecting it
// would silently inflate every group total.
//
// The choice here is to REFUSE rather than convert. A visible gap is
// recoverable; a wrong total that looks right is not. Building FX conversion
// is a much larger piece of work and is not needed until a non-GBP account is
// actually in use.
// ============================================================================

export const SUPPORTED_CURRENCY = 'GBP';

// A null/absent currency is treated as supported. Three connected Google
// accounts have no currency recorded, and dropping their live spend would be a
// worse error than assuming the GBP that they almost certainly are. They are
// listed in the reconciliation panel so the gap is visible and correctable.
export function isSupportedCurrency(currency) {
    if (currency == null || currency === '') return true;
    return String(currency).toUpperCase() === SUPPORTED_CURRENCY;
}

export function partitionAccountsByCurrency(accounts) {
    const supported = [];
    const unsupported = [];
    for (const a of Array.isArray(accounts) ? accounts : []) {
        if (isSupportedCurrency(a?.currency)) supported.push(String(a.customer_id));
        else unsupported.push({ customer_id: String(a.customer_id), currency: a.currency });
    }
    return { supported, unsupported };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/ad-currency.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/ad-currency.js backend/test/ad-currency.test.mjs
git commit -m "feat(ads): refuse non-GBP ad accounts rather than mis-converting

microsToPence and spendToPence divide and call the result pence with no
conversion, which is correct only while every account bills in GBP. A USD
Google account is connected, currently deselected; selecting it would have
silently inflated every group total.

A null currency counts as supported — three live Google accounts have none
recorded, and dropping their real spend would be the worse error. They are
surfaced in the reconciliation panel instead."
```

---

### Task 6: Google deep sync — ad groups and ads

**Files:**
- Create: `backend/src/lib/integrations/google-ads-deep-sync.js`
- Test: `backend/test/google-ads-deep-sync.test.mjs`

**Interfaces:**
- Consumes: `adGrainRepository` (Task 4), `partitionAccountsByCurrency` (Task 5).
- Produces:
  - `DEEP_WINDOW_DAYS` — `92`
  - `buildAdGroupGaql(since, until) -> string`
  - `buildAdGaql(since, until) -> string`
  - `parseAdGroups(batches, { orgId, customerId }) -> Array<row>`
  - `parseAds(batches, { orgId, customerId }) -> Array<row>`
  - `syncGoogleDeep(orgId, { accessToken, customerIds, since, until, queryCustomer }) -> Promise<{ counts, skipped }>` — `queryCustomer(customerId, accessToken, gaql)` is injected so tests need no network.
  - `__test` — `{ microsToPence, buildAdGroupGaql, buildAdGaql, parseAdGroups, parseAds, DEEP_WINDOW_DAYS }`

- [ ] **Step 1: Write the failing test**

```javascript
// Google deep-grain sync — ad group and ad. Verifies the GAQL shape, the
// camelCase parse, pence conversion, fractional conversions, and that each
// grain replaces independently.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { replaceWindow: vi.fn(async () => 1) },
}));

const { syncGoogleDeep, __test } = await import('../src/lib/integrations/google-ads-deep-sync.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { adGrainRepository.replaceWindow.mockClear(); });

describe('window', () => {
    it('is 92 days', () => {
        expect(__test.DEEP_WINDOW_DAYS).toBe(92);
    });
});

describe('buildAdGroupGaql', () => {
    it('selects from ad_group and bounds the window', () => {
        const q = __test.buildAdGroupGaql('2026-06-01', '2026-08-31');
        expect(q).toContain('FROM ad_group');
        expect(q).toContain('ad_group.id');
        expect(q).toContain('campaign.id');
        expect(q).toContain('segments.date');
        expect(q).toContain("BETWEEN '2026-06-01' AND '2026-08-31'");
    });
});

describe('buildAdGaql', () => {
    it('selects from ad_group_ad so ads hang off their ad group', () => {
        const q = __test.buildAdGaql('2026-06-01', '2026-08-31');
        expect(q).toContain('FROM ad_group_ad');
        expect(q).toContain('ad_group_ad.ad.id');
        expect(q).toContain('ad_group.id');
    });
});

describe('parseAdGroups', () => {
    it('maps an ad group to a row parented on its campaign', () => {
        const rows = __test.parseAdGroups([{ results: [{
            campaign: { id: 7, name: 'Implants' },
            adGroup: { id: 42, name: 'Exact', status: 'ENABLED' },
            segments: { date: '2026-08-01' },
            metrics: { costMicros: '12340000', impressions: '900', clicks: '45', conversions: 3.5 },
        }] }], { orgId: ORG, customerId: 'C1' });

        expect(rows).toEqual([{
            organisation_id: ORG, practice_id: null, provider: 'google_ads', customer_id: 'C1',
            campaign_id: '7', campaign_name: 'Implants',
            parent_id: '7', entity_id: '42', entity_name: 'Exact', entity_status: 'ENABLED',
            metric_date: '2026-08-01',
            spend_pence: 1234, impressions: 900, clicks: 45, conversions: 3.5,
        }]);
    });

    it('keeps conversions fractional rather than rounding', () => {
        const [row] = __test.parseAdGroups([{ results: [{
            campaign: { id: 1 }, adGroup: { id: 2 }, segments: { date: '2026-08-01' },
            metrics: { conversions: 2.5 },
        }] }], { orgId: ORG, customerId: 'C1' });
        expect(row.conversions).toBe(2.5);
    });

    it('drops rows with no ad group or no date', () => {
        const rows = __test.parseAdGroups([{ results: [
            { campaign: { id: 1 }, adGroup: {}, segments: { date: '2026-08-01' } },
            { campaign: { id: 1 }, adGroup: { id: 2 }, segments: {} },
        ] }], { orgId: ORG, customerId: 'C1' });
        expect(rows).toEqual([]);
    });
});

describe('parseAds', () => {
    it('parents an ad on its AD GROUP, not its campaign', () => {
        const [row] = __test.parseAds([{ results: [{
            campaign: { id: 7, name: 'Implants' },
            adGroup: { id: 42 },
            adGroupAd: { ad: { id: 99, name: 'Headline A' }, status: 'ENABLED' },
            segments: { date: '2026-08-01' },
            metrics: { costMicros: '5000000', impressions: '10', clicks: '1', conversions: 0 },
        }] }], { orgId: ORG, customerId: 'C1' });

        expect(row.parent_id).toBe('42');
        expect(row.entity_id).toBe('99');
        expect(row.campaign_id).toBe('7');
        expect(row.spend_pence).toBe(500);
    });
});

describe('syncGoogleDeep', () => {
    const batches = (results) => [{ results }];

    it('replaces each grain independently', async () => {
        const queryCustomer = vi.fn(async (_cid, _tok, gaql) => (
            gaql.includes('FROM ad_group_ad')
                ? batches([{ campaign: { id: 7 }, adGroup: { id: 42 },
                             adGroupAd: { ad: { id: 99 } }, segments: { date: '2026-08-01' },
                             metrics: { costMicros: '1000000' } }])
                : batches([{ campaign: { id: 7 }, adGroup: { id: 42 },
                             segments: { date: '2026-08-01' }, metrics: { costMicros: '2000000' } }])
        ));

        await syncGoogleDeep(ORG, {
            accessToken: 'tok', customerIds: ['C1'],
            since: '2026-06-01', until: '2026-08-31', queryCustomer,
        });

        const grains = adGrainRepository.replaceWindow.mock.calls.map((c) => c[1]);
        expect(grains).toContain('google_adgroup');
        expect(grains).toContain('google_ad');
    });

    it('does not replace a grain that returned nothing', async () => {
        const queryCustomer = vi.fn(async () => batches([]));
        await syncGoogleDeep(ORG, {
            accessToken: 'tok', customerIds: ['C1'],
            since: '2026-06-01', until: '2026-08-31', queryCustomer,
        });
        expect(adGrainRepository.replaceWindow).not.toHaveBeenCalled();
    });

    it('keeps going when one account fails, and reports it', async () => {
        const queryCustomer = vi.fn(async (cid) => {
            if (cid === 'BAD') throw new Error('RESOURCE_EXHAUSTED');
            return batches([{ campaign: { id: 7 }, adGroup: { id: 42 },
                             segments: { date: '2026-08-01' }, metrics: { costMicros: '1000000' } }]);
        });
        const res = await syncGoogleDeep(ORG, {
            accessToken: 'tok', customerIds: ['BAD', 'C1'],
            since: '2026-06-01', until: '2026-08-31', queryCustomer,
        });
        expect(res.skipped).toEqual([{ customerId: 'BAD', error: expect.stringContaining('RESOURCE_EXHAUSTED') }]);
        expect(adGrainRepository.replaceWindow).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/google-ads-deep-sync.test.mjs`
Expected: FAIL — cannot resolve `../src/lib/integrations/google-ads-deep-sync.js`.

- [ ] **Step 3: Write the module**

```javascript
// ============================================================================
// Google Ads deep-grain sync — ad group and ad (keywords live in Task 7, same
// file). Separate from google-ads-sync.js, which owns campaign grain and is
// already long enough; this file adds three GAQL streams per account.
//
// HIERARCHY: Campaign -> Ad Group -> { Ads, Keywords }. Ads and keywords are
// SIBLINGS under an ad group, not parent and child. So an ad's parent_id is
// its ad group id, never its campaign id.
//
// cost_micros is account-currency micros: pence = micros / 10,000. Guarded by
// ad-currency.js — a non-GBP account never reaches here.
// ============================================================================
import { adGrainRepository } from "../../repositories/ad-grain.repository.js";

export const DEEP_WINDOW_DAYS = 92;

function microsToPence(micros) {
    const n = Number(micros ?? 0);
    return Number.isFinite(n) ? Math.round(n / 10_000) : 0;
}

// Conversions stay FRACTIONAL. Google reports modelled conversions as decimals
// (3.5 is a real value in its own interface) and rounding here would leave our
// figure permanently a little off the platform's.
function conversions(v) {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
}

const METRICS = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions';

export function buildAdGroupGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name,',
        'ad_group.id, ad_group.name, ad_group.status,',
        'segments.date,', METRICS,
        `FROM ad_group WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

export function buildAdGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name, ad_group.id,',
        'ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,',
        'segments.date,', METRICS,
        `FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

// searchStream returns an ARRAY of batches, each { results: [...] }, with
// camelCase JSON field names (costMicros, adGroupAd).
function* streamRows(batches) {
    for (const batch of Array.isArray(batches) ? batches : []) {
        for (const r of batch?.results ?? []) yield r;
    }
}

function core(r, { orgId, customerId }) {
    return {
        organisation_id: orgId,
        practice_id: null,          // stamped in the replace RPC from ad_accounts
        provider: 'google_ads',
        customer_id: customerId,
        campaign_id: String(r.campaign?.id ?? ''),
        campaign_name: r.campaign?.name ?? null,
        metric_date: r.segments?.date,
        spend_pence: microsToPence(r.metrics?.costMicros),
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
        conversions: conversions(r.metrics?.conversions),
    };
}

export function parseAdGroups(batches, ctx) {
    const out = [];
    for (const r of streamRows(batches)) {
        const id = r.adGroup?.id;
        const campaignId = r.campaign?.id;
        if (!id || !campaignId || !r.segments?.date) continue;
        const { campaign_id, campaign_name, metric_date, spend_pence, impressions, clicks, conversions: cv,
                organisation_id, practice_id, provider, customer_id } = core(r, ctx);
        out.push({
            organisation_id, practice_id, provider, customer_id,
            campaign_id, campaign_name,
            parent_id: String(campaignId),        // an ad group hangs off its campaign
            entity_id: String(id),
            entity_name: r.adGroup?.name ?? null,
            entity_status: r.adGroup?.status ?? null,
            metric_date, spend_pence, impressions, clicks, conversions: cv,
        });
    }
    return out;
}

export function parseAds(batches, ctx) {
    const out = [];
    for (const r of streamRows(batches)) {
        const id = r.adGroupAd?.ad?.id;
        const adGroupId = r.adGroup?.id;
        if (!id || !adGroupId || !r.campaign?.id || !r.segments?.date) continue;
        const { campaign_id, campaign_name, metric_date, spend_pence, impressions, clicks, conversions: cv,
                organisation_id, practice_id, provider, customer_id } = core(r, ctx);
        out.push({
            organisation_id, practice_id, provider, customer_id,
            campaign_id, campaign_name,
            parent_id: String(adGroupId),         // an ad hangs off its AD GROUP
            entity_id: String(id),
            entity_name: r.adGroupAd?.ad?.name ?? null,
            entity_status: r.adGroupAd?.status ?? null,
            metric_date, spend_pence, impressions, clicks, conversions: cv,
        });
    }
    return out;
}

// One pull per grain per account. `queryCustomer` is injected so the caller
// owns the HTTP concern (headers, API-version self-healing, 403 backoff) and
// tests need no network.
const STREAMS = [
    { grain: 'google_adgroup', gaql: buildAdGroupGaql, parse: parseAdGroups },
    { grain: 'google_ad',      gaql: buildAdGaql,      parse: parseAds },
];

export async function syncGoogleDeep(orgId, { accessToken, customerIds, since, until, queryCustomer }) {
    const collected = new Map(STREAMS.map((s) => [s.grain, []]));
    const skipped = [];
    const withRows = new Map(STREAMS.map((s) => [s.grain, new Set()]));

    for (const customerId of customerIds ?? []) {
        for (const stream of STREAMS) {
            try {
                const batches = await queryCustomer(customerId, accessToken, stream.gaql(since, until));
                const rows = stream.parse(batches, { orgId, customerId });
                if (rows.length) {
                    collected.get(stream.grain).push(...rows);
                    withRows.get(stream.grain).add(customerId);
                }
            } catch (err) {
                // One account (or one grain of it) failing must not sink the
                // rest. Google reports rate limiting as HTTP 403, so a failure
                // here is frequently transient and retried tomorrow.
                skipped.push({ customerId, error: String(err.message).slice(0, 200) });
            }
        }
    }

    const counts = {};
    for (const stream of STREAMS) {
        const rows = collected.get(stream.grain);
        const cids = [...withRows.get(stream.grain)];
        // Replace ONLY for accounts that actually returned rows. An empty 200 —
        // report not ready, throttle, momentary access loss — must not trigger
        // a destructive delete of good history.
        counts[stream.grain] = rows.length
            ? await adGrainRepository.replaceWindow(orgId, stream.grain, cids, rows)
            : 0;
    }
    return { counts, skipped };
}

export const __test = { microsToPence, conversions, buildAdGroupGaql, buildAdGaql, parseAdGroups, parseAds, DEEP_WINDOW_DAYS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/google-ads-deep-sync.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/google-ads-deep-sync.js backend/test/google-ads-deep-sync.test.mjs
git commit -m "feat(ads): Google ad group and ad deep-grain sync

An ad's parent is its AD GROUP, not its campaign. In Google Ads the
hierarchy is Campaign -> Ad Group -> { Ads, Keywords }, where ads and
keywords are siblings; modelling an ad under a campaign would flatten a
level the reporting page needs.

Conversions stay fractional — Google reports modelled conversions as
decimals and rounding would put our figure permanently off theirs.

A grain that returns nothing is not replaced: an empty 200 from a throttle
or a not-ready report must not delete good history."
```

---

### Task 7: Google deep sync — keywords

**Files:**
- Modify: `backend/src/lib/integrations/google-ads-deep-sync.js`
- Test: `backend/test/google-ads-deep-sync.keywords.test.mjs`

**Interfaces:**
- Consumes: `core`, `streamRows`, `STREAMS` from Task 6.
- Produces:
  - `buildKeywordGaql(since, until) -> string`
  - `parseKeywords(batches, { orgId, customerId }) -> Array<row>` — rows carry the core contract plus `match_type`, `quality_score`, `creative_quality_score`, `post_click_quality_score`, `search_predicted_ctr`, `search_impression_share`, `search_top_impression_share`, `search_absolute_top_impression_share`.
  - `google_keyword` added to `STREAMS`, so `syncGoogleDeep` picks it up with no signature change.

- [ ] **Step 1: Write the failing test**

```javascript
// Google keyword grain. Keywords are siblings of ads under an ad group, so a
// keyword's parent is its ad group. Google removed average position in
// September 2019; impression share and Quality Score are the ranking signals
// that replaced it.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { replaceWindow: vi.fn(async () => 1) },
}));

const { __test } = await import('../src/lib/integrations/google-ads-deep-sync.js');

const ORG = '11111111-1111-1111-1111-111111111111';

describe('buildKeywordGaql', () => {
    it('selects from keyword_view with quality and impression share', () => {
        const q = __test.buildKeywordGaql('2026-06-01', '2026-08-31');
        expect(q).toContain('FROM keyword_view');
        expect(q).toContain('ad_group_criterion.criterion_id');
        expect(q).toContain('ad_group_criterion.keyword.text');
        expect(q).toContain('ad_group_criterion.keyword.match_type');
        expect(q).toContain('ad_group_criterion.quality_info.quality_score');
        expect(q).toContain('metrics.search_impression_share');
        expect(q).toContain('metrics.search_top_impression_share');
        expect(q).toContain('metrics.search_absolute_top_impression_share');
    });

    it('does not ask for average_position, which Google removed in 2019', () => {
        expect(__test.buildKeywordGaql('2026-06-01', '2026-08-31')).not.toContain('average_position');
    });
});

describe('parseKeywords', () => {
    const batch = [{ results: [{
        campaign: { id: 7, name: 'Implants' },
        adGroup: { id: 42 },
        adGroupCriterion: {
            criterionId: 555,
            status: 'ENABLED',
            keyword: { text: 'dental implants near me', matchType: 'PHRASE' },
            qualityInfo: {
                qualityScore: 8,
                creativeQualityScore: 'ABOVE_AVERAGE',
                postClickQualityScore: 'AVERAGE',
                searchPredictedCtr: 'ABOVE_AVERAGE',
            },
        },
        segments: { date: '2026-08-01' },
        metrics: {
            costMicros: '7500000', impressions: '400', clicks: '20', conversions: 1.5,
            searchImpressionShare: 0.62,
            searchTopImpressionShare: 0.41,
            searchAbsoluteTopImpressionShare: 0.18,
        },
    }] }];

    it('parents a keyword on its ad group and carries the keyword text as the name', () => {
        const [row] = __test.parseKeywords(batch, { orgId: ORG, customerId: 'C1' });
        expect(row.parent_id).toBe('42');
        expect(row.entity_id).toBe('555');
        expect(row.entity_name).toBe('dental implants near me');
        expect(row.campaign_id).toBe('7');
        expect(row.spend_pence).toBe(750);
        expect(row.conversions).toBe(1.5);
    });

    it('carries match type, quality score and impression share', () => {
        const [row] = __test.parseKeywords(batch, { orgId: ORG, customerId: 'C1' });
        expect(row.match_type).toBe('PHRASE');
        expect(row.quality_score).toBe(8);
        expect(row.creative_quality_score).toBe('ABOVE_AVERAGE');
        expect(row.post_click_quality_score).toBe('AVERAGE');
        expect(row.search_predicted_ctr).toBe('ABOVE_AVERAGE');
        expect(row.search_impression_share).toBe(0.62);
        expect(row.search_top_impression_share).toBe(0.41);
        expect(row.search_absolute_top_impression_share).toBe(0.18);
    });

    it('leaves quality and impression share null when Google omits them', () => {
        const [row] = __test.parseKeywords([{ results: [{
            campaign: { id: 7 }, adGroup: { id: 42 },
            adGroupCriterion: { criterionId: 555, keyword: { text: 'x' } },
            segments: { date: '2026-08-01' }, metrics: { costMicros: '0' },
        }] }], { orgId: ORG, customerId: 'C1' });
        expect(row.quality_score).toBeNull();
        expect(row.search_impression_share).toBeNull();
        expect(row.match_type).toBeNull();
    });

    it('drops a row with no criterion id or no ad group', () => {
        const rows = __test.parseKeywords([{ results: [
            { campaign: { id: 7 }, adGroup: { id: 42 }, adGroupCriterion: {}, segments: { date: '2026-08-01' } },
            { campaign: { id: 7 }, adGroupCriterion: { criterionId: 1 }, segments: { date: '2026-08-01' } },
        ] }], { orgId: ORG, customerId: 'C1' });
        expect(rows).toEqual([]);
    });
});

describe('STREAMS', () => {
    it('includes the keyword grain so syncGoogleDeep picks it up unchanged', () => {
        expect(__test.STREAM_GRAINS).toEqual(['google_adgroup', 'google_ad', 'google_keyword']);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/google-ads-deep-sync.keywords.test.mjs`
Expected: FAIL — `__test.buildKeywordGaql is not a function`.

- [ ] **Step 3: Add keywords to the module**

Append to `backend/src/lib/integrations/google-ads-deep-sync.js`, before the `STREAMS` constant:

```javascript
// Google's impression-share metrics replaced average position, which was
// removed in September 2019. They are ratios in 0..1; Google caps the reported
// value for very high shares, so treat them as indicative rather than exact.
function ratio(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function buildKeywordGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name, ad_group.id,',
        'ad_group_criterion.criterion_id, ad_group_criterion.status,',
        'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,',
        'ad_group_criterion.quality_info.quality_score,',
        'ad_group_criterion.quality_info.creative_quality_score,',
        'ad_group_criterion.quality_info.post_click_quality_score,',
        'ad_group_criterion.quality_info.search_predicted_ctr,',
        'segments.date,', METRICS + ',',
        'metrics.search_impression_share, metrics.search_top_impression_share,',
        'metrics.search_absolute_top_impression_share',
        `FROM keyword_view WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

export function parseKeywords(batches, ctx) {
    const out = [];
    for (const r of streamRows(batches)) {
        const crit = r.adGroupCriterion ?? {};
        const id = crit.criterionId;
        const adGroupId = r.adGroup?.id;
        if (!id || !adGroupId || !r.campaign?.id || !r.segments?.date) continue;
        const { campaign_id, campaign_name, metric_date, spend_pence, impressions, clicks, conversions: cv,
                organisation_id, practice_id, provider, customer_id } = core(r, ctx);
        const q = crit.qualityInfo ?? {};
        const m = r.metrics ?? {};
        out.push({
            organisation_id, practice_id, provider, customer_id,
            campaign_id, campaign_name,
            parent_id: String(adGroupId),      // a keyword hangs off its AD GROUP
            entity_id: String(id),
            entity_name: crit.keyword?.text ?? null,
            entity_status: crit.status ?? null,
            metric_date, spend_pence, impressions, clicks, conversions: cv,
            match_type: crit.keyword?.matchType ?? null,
            quality_score: intOrNull(q.qualityScore),
            creative_quality_score: q.creativeQualityScore ?? null,
            post_click_quality_score: q.postClickQualityScore ?? null,
            search_predicted_ctr: q.searchPredictedCtr ?? null,
            search_impression_share: ratio(m.searchImpressionShare),
            search_top_impression_share: ratio(m.searchTopImpressionShare),
            search_absolute_top_impression_share: ratio(m.searchAbsoluteTopImpressionShare),
        });
    }
    return out;
}
```

Then extend `STREAMS` and `__test`:

```javascript
const STREAMS = [
    { grain: 'google_adgroup', gaql: buildAdGroupGaql, parse: parseAdGroups },
    { grain: 'google_ad',      gaql: buildAdGaql,      parse: parseAds },
    { grain: 'google_keyword', gaql: buildKeywordGaql, parse: parseKeywords },
];

export const __test = {
    microsToPence, conversions, buildAdGroupGaql, buildAdGaql, buildKeywordGaql,
    parseAdGroups, parseAds, parseKeywords, DEEP_WINDOW_DAYS,
    STREAM_GRAINS: STREAMS.map((s) => s.grain),
};
```

- [ ] **Step 4: Run both Google test files**

Run: `cd backend && npx vitest run test/google-ads-deep-sync.test.mjs test/google-ads-deep-sync.keywords.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/google-ads-deep-sync.js backend/test/google-ads-deep-sync.keywords.test.mjs
git commit -m "feat(ads): Google keyword grain with quality score and impression share

Keywords are siblings of ads under an ad group, so a keyword's parent is
its ad group id.

Google removed average position in September 2019. Impression share
(search, top, absolute top) and Quality Score with its three components are
the ranking signals that replaced it, and the test pins that we never ask
for average_position again."
```

---

### Task 8: Meta deep sync — ad sets and ads

**Files:**
- Create: `backend/src/lib/integrations/meta-ads-deep-sync.js`
- Test: `backend/test/meta-ads-deep-sync.test.mjs`

**Interfaces:**
- Consumes: `adGrainRepository` (Task 4).
- Produces:
  - `parseMetaLevel(rows, level, { orgId, customerId }) -> Array<row>` where `level` is `'adset' | 'ad'`
  - `syncMetaDeep(orgId, { accessToken, accountIds, since, until, fetchLevel }) -> Promise<{ counts, skipped }>` — `fetchLevel(accountId, accessToken, level, since, until)` is injected.
  - `__test` — `{ spendToPence, parseMetaLevel, INSIGHT_FIELDS }`

- [ ] **Step 1: Write the failing test**

```javascript
// Meta deep-grain sync. Meta returns spend as a decimal STRING in the account
// currency ("12.34"), unlike Google's integer micros.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { replaceWindow: vi.fn(async () => 1) },
}));

const { syncMetaDeep, __test } = await import('../src/lib/integrations/meta-ads-deep-sync.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { adGrainRepository.replaceWindow.mockClear(); });

describe('spendToPence', () => {
    it('converts a decimal string to integer pence', () => {
        expect(__test.spendToPence('12.34')).toBe(1234);
        expect(__test.spendToPence('0.005')).toBe(1);   // rounds
        expect(__test.spendToPence(undefined)).toBe(0);
        expect(__test.spendToPence('not a number')).toBe(0);
    });
});

describe('parseMetaLevel — adset', () => {
    it('parents an ad set on its campaign and carries reach and frequency', () => {
        const [row] = __test.parseMetaLevel([{
            campaign_id: '7', campaign_name: 'Implants',
            adset_id: '42', adset_name: 'Photos | 35+',
            date_start: '2026-08-01',
            spend: '25.00', impressions: '900', clicks: '45',
            reach: '700', frequency: '1.29',
        }], 'adset', { orgId: ORG, customerId: 'act1' });

        expect(row).toMatchObject({
            organisation_id: ORG, provider: 'meta_ads', customer_id: 'act1',
            campaign_id: '7', campaign_name: 'Implants',
            parent_id: '7', entity_id: '42', entity_name: 'Photos | 35+',
            metric_date: '2026-08-01',
            spend_pence: 2500, impressions: 900, clicks: 45,
            reach: 700, frequency: 1.29,
        });
    });
});

describe('parseMetaLevel — ad', () => {
    it('parents an ad on its AD SET, not its campaign', () => {
        const [row] = __test.parseMetaLevel([{
            campaign_id: '7', adset_id: '42', ad_id: '99', ad_name: 'Creative A',
            date_start: '2026-08-01', spend: '5.00',
        }], 'ad', { orgId: ORG, customerId: 'act1' });

        expect(row.parent_id).toBe('42');
        expect(row.entity_id).toBe('99');
        expect(row.campaign_id).toBe('7');
    });

    it('drops a row missing its own id, its parent, or its date', () => {
        const rows = __test.parseMetaLevel([
            { campaign_id: '7', adset_id: '42', date_start: '2026-08-01' },          // no ad_id
            { campaign_id: '7', ad_id: '99', date_start: '2026-08-01' },             // no adset_id
            { campaign_id: '7', adset_id: '42', ad_id: '99' },                       // no date
        ], 'ad', { orgId: ORG, customerId: 'act1' });
        expect(rows).toEqual([]);
    });
});

describe('syncMetaDeep', () => {
    it('replaces both grains and reports counts', async () => {
        const fetchLevel = vi.fn(async (_aid, _tok, level) => (level === 'adset'
            ? [{ campaign_id: '7', adset_id: '42', date_start: '2026-08-01', spend: '1.00' }]
            : [{ campaign_id: '7', adset_id: '42', ad_id: '99', date_start: '2026-08-01', spend: '2.00' }]));

        const res = await syncMetaDeep(ORG, {
            accessToken: 'tok', accountIds: ['act1'],
            since: '2026-06-01', until: '2026-08-31', fetchLevel,
        });

        const grains = adGrainRepository.replaceWindow.mock.calls.map((c) => c[1]);
        expect(grains).toEqual(['meta_adset', 'meta_ad']);
        expect(res.skipped).toEqual([]);
    });

    it('does not replace a grain that returned nothing', async () => {
        await syncMetaDeep(ORG, {
            accessToken: 'tok', accountIds: ['act1'],
            since: '2026-06-01', until: '2026-08-31', fetchLevel: async () => [],
        });
        expect(adGrainRepository.replaceWindow).not.toHaveBeenCalled();
    });

    it('keeps going when one account fails', async () => {
        const fetchLevel = vi.fn(async (aid) => {
            if (aid === 'bad') throw new Error('(#17) User request limit reached');
            return [{ campaign_id: '7', adset_id: '42', date_start: '2026-08-01', spend: '1.00' }];
        });
        const res = await syncMetaDeep(ORG, {
            accessToken: 'tok', accountIds: ['bad', 'act1'],
            since: '2026-06-01', until: '2026-08-31', fetchLevel,
        });
        expect(res.skipped.map((s) => s.accountId)).toEqual(['bad', 'bad']);
        expect(adGrainRepository.replaceWindow).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/meta-ads-deep-sync.test.mjs`
Expected: FAIL — cannot resolve `../src/lib/integrations/meta-ads-deep-sync.js`.

- [ ] **Step 3: Write the module**

```javascript
// ============================================================================
// Meta Ads deep-grain sync — ad set and ad, per day. Separate from
// meta-ads-sync.js, which owns campaign grain.
//
//   GET {graph}/{ver}/act_{accountId}/insights
//       ?level=adset|ad&time_increment=1&time_range={since,until}
//       &fields=...
//
// Meta returns spend as a decimal STRING in the account currency ("12.34"),
// unlike Google's integer micros. Guarded by ad-currency.js.
//
// Retention (changed 12 January 2026): spend/impressions/clicks are kept for
// 37 months, reach and other unique-count fields for 13, frequency breakdowns
// for 6. The 92-day window sits inside all three, so nothing here is
// unavailable.
// ============================================================================
import { adGrainRepository } from "../../repositories/ad-grain.repository.js";

export const INSIGHT_FIELDS =
    'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,reach,frequency';

function spendToPence(spend) {
    const n = Number(spend);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// level 'adset': entity = ad set, parent = campaign.
// level 'ad':    entity = ad,     parent = AD SET.
const SHAPE = {
    adset: { idKey: 'adset_id', nameKey: 'adset_name', parentKey: 'campaign_id' },
    ad:    { idKey: 'ad_id',    nameKey: 'ad_name',    parentKey: 'adset_id' },
};

export function parseMetaLevel(rows, level, { orgId, customerId }) {
    const shape = SHAPE[level];
    if (!shape) throw new Error(`parseMetaLevel: unknown level '${level}'`);
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
        const id = r?.[shape.idKey];
        const parent = r?.[shape.parentKey];
        if (!id || !parent || !r?.campaign_id || !r?.date_start) continue;
        out.push({
            organisation_id: orgId,
            practice_id: null,          // stamped in the replace RPC
            provider: 'meta_ads',
            customer_id: customerId,
            campaign_id: String(r.campaign_id),
            campaign_name: r.campaign_name ?? null,
            parent_id: String(parent),
            entity_id: String(id),
            entity_name: r[shape.nameKey] ?? null,
            entity_status: null,        // insights carries no status; the campaign edge does
            metric_date: r.date_start,
            spend_pence: spendToPence(r.spend),
            impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0),
            conversions: 0,             // Meta actions are handled at campaign grain
            reach: numOrNull(r.reach),
            frequency: numOrNull(r.frequency),
        });
    }
    return out;
}

const LEVELS = [
    { level: 'adset', grain: 'meta_adset' },
    { level: 'ad',    grain: 'meta_ad' },
];

export async function syncMetaDeep(orgId, { accessToken, accountIds, since, until, fetchLevel }) {
    const collected = new Map(LEVELS.map((l) => [l.grain, []]));
    const withRows = new Map(LEVELS.map((l) => [l.grain, new Set()]));
    const skipped = [];

    for (const accountId of accountIds ?? []) {
        for (const { level, grain } of LEVELS) {
            try {
                const rows = await fetchLevel(accountId, accessToken, level, since, until);
                const parsed = parseMetaLevel(rows, level, { orgId, customerId: accountId });
                if (parsed.length) {
                    collected.get(grain).push(...parsed);
                    withRows.get(grain).add(accountId);
                }
            } catch (err) {
                // Meta throttles harder at ad level than campaign level, so a
                // failure here is usually transient and retried tomorrow.
                skipped.push({ accountId, level, error: String(err.message).slice(0, 200) });
            }
        }
    }

    const counts = {};
    for (const { grain } of LEVELS) {
        const rows = collected.get(grain);
        // Replace ONLY for accounts that returned rows — an empty 200 must not
        // trigger a destructive delete of good history.
        counts[grain] = rows.length
            ? await adGrainRepository.replaceWindow(orgId, grain, [...withRows.get(grain)], rows)
            : 0;
    }
    return { counts, skipped };
}

export const __test = { spendToPence, parseMetaLevel, INSIGHT_FIELDS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/meta-ads-deep-sync.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/meta-ads-deep-sync.js backend/test/meta-ads-deep-sync.test.mjs
git commit -m "feat(ads): Meta ad set and ad deep-grain sync

An ad's parent is its ad set; an ad set's parent is its campaign. One
shared parser keyed by level rather than two near-identical ones.

Meta returns spend as a decimal string in account currency, unlike
Google's integer micros — converted at the boundary and guarded by
ad-currency.js.

A grain returning nothing is not replaced, so a throttled empty 200
cannot delete good history."
```

---

### Task 9: Wire the deep pulls into the nightly syncs

**Files:**
- Modify: `backend/src/lib/integrations/google-ads-sync.js`
- Modify: `backend/src/lib/integrations/meta-ads-sync.js`
- Test: `backend/test/ad-deep-sync.wiring.test.mjs`

**Interfaces:**
- Consumes: `syncGoogleDeep` (Tasks 6–7), `syncMetaDeep` (Task 8), `partitionAccountsByCurrency` (Task 5).
- Produces: `syncOneOrg` in both files returns an added `deep` key — `{ counts, skipped, unsupportedCurrency }`.

- [ ] **Step 1: Write the failing test**

```javascript
// The deep pull runs AFTER the campaign replace and must never be able to fail
// the campaign sync: campaign grain feeds every existing marketing figure,
// while deep grain feeds two new pages that can tolerate being a day stale.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        upsert: vi.fn(), markFailed: vi.fn(), markSynced: vi.fn(), getByProvider: vi.fn(),
        upsertAdAccounts: vi.fn(), markAdAccountStatus: vi.fn(), listAdAccounts: vi.fn(async () => []),
    },
}));
vi.mock('../src/lib/integrations/google-ads-deep-sync.js', () => ({
    DEEP_WINDOW_DAYS: 92,
    syncGoogleDeep: vi.fn(async () => ({ counts: { google_adgroup: 3 }, skipped: [] })),
}));

const { syncOneOrg } = await import('../src/lib/integrations/google-ads-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');
const { syncGoogleDeep } = await import('../src/lib/integrations/google-ads-deep-sync.js');
const { resetApiVersionCache } = await import('../src/lib/integrations/google-ads-version.js');

const ORG = '11111111-1111-1111-1111-111111111111';

const campaignBatch = [{ results: [{
    campaign: { id: 7, name: 'Implants' }, segments: { date: '2026-08-01' },
    customer: { descriptiveName: 'Acct', currencyCode: 'GBP' },
    metrics: { costMicros: '1000000', impressions: '10', clicks: '1', conversions: 1 },
}] }];

beforeEach(() => {
    resetApiVersionCache?.();
    supaRec.rpcCalls = [];
    supaRec.rpcProvider = () => ({ data: 1, error: null });
    syncGoogleDeep.mockClear();
    integrationRepository.getByProvider.mockResolvedValue({
        secrets: encryptSecret(JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
        config: { customer_ids: ['C1'] },
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => campaignBatch }));
});

describe('google deep wiring', () => {
    it('runs the deep pull with the 92-day window after the campaign replace', async () => {
        const res = await syncOneOrg(ORG);
        expect(syncGoogleDeep).toHaveBeenCalledTimes(1);
        const [orgArg, opts] = syncGoogleDeep.mock.calls[0];
        expect(orgArg).toBe(ORG);
        expect(opts.customerIds).toEqual(['C1']);
        expect(res.deep.counts).toEqual({ google_adgroup: 3 });
    });

    it('does not fail the campaign sync when the deep pull throws', async () => {
        syncGoogleDeep.mockRejectedValueOnce(new Error('keyword_view exploded'));
        const res = await syncOneOrg(ORG);
        expect(res.rows).toBeGreaterThan(0);
        expect(res.deep.error).toContain('keyword_view exploded');
        expect(integrationRepository.markSynced).toHaveBeenCalled();
    });

    it('skips a non-GBP account and reports it rather than converting', async () => {
        integrationRepository.listAdAccounts.mockResolvedValueOnce([
            { customer_id: 'C1', currency: 'USD', status: null },
        ]);
        const res = await syncOneOrg(ORG);
        expect(res.deep.unsupportedCurrency).toEqual([{ customer_id: 'C1', currency: 'USD' }]);
        expect(syncGoogleDeep.mock.calls[0][1].customerIds).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/ad-deep-sync.wiring.test.mjs`
Expected: FAIL — `res.deep` is undefined.

- [ ] **Step 3: Wire both syncs**

In `backend/src/lib/integrations/google-ads-sync.js`, add the import at the top:

```javascript
import { syncGoogleDeep, DEEP_WINDOW_DAYS } from "./google-ads-deep-sync.js";
import { partitionAccountsByCurrency } from "./ad-currency.js";
```

Then, immediately **after** the `ad_metrics_replace_window` block and **before** `markSynced`, insert:

```javascript
        // Deep grain (ad group / ad / keyword) runs AFTER the campaign replace
        // and is wrapped so it can never fail the campaign sync. Campaign grain
        // feeds every existing marketing figure; deep grain feeds two new pages
        // that tolerate being a day stale. A keyword pull that trips a 403
        // throttle must not cost us the day's spend.
        let deep = { counts: {}, skipped: [], unsupportedCurrency: [] };
        try {
            const known = await integrationRepository.listAdAccounts(orgId, 'google_ads').catch(() => []);
            const byId = new Map((known ?? []).map((a) => [String(a.customer_id), a]));
            const { supported, unsupported } = partitionAccountsByCurrency(
                cidsWithRows.map((cid) => ({ customer_id: cid, currency: byId.get(String(cid))?.currency ?? null })),
            );
            const deepSince = daysAgo(DEEP_WINDOW_DAYS);
            const r = await syncGoogleDeep(orgId, {
                accessToken: access_token,
                customerIds: supported,
                since: deepSince,
                until: untilDate,
                queryCustomer: (cid, tok, gaql) => queryCustomer(cid, tok, gaql),
            });
            deep = { ...r, unsupportedCurrency: unsupported };
        } catch (err) {
            console.error('[google_ads] deep-grain sync failed:', err.message);
            deep = { counts: {}, skipped: [], unsupportedCurrency: [], error: String(err.message).slice(0, 200) };
        }
```

Change the success return to carry it:

```javascript
        return { rows: all.length, customers: customerIds.length, skipped, permanentlySkipped: [...permanent], deep };
```

In `backend/src/lib/integrations/meta-ads-sync.js`, add:

```javascript
import { syncMetaDeep } from "./meta-ads-deep-sync.js";
import { partitionAccountsByCurrency } from "./ad-currency.js";
```

Insert the equivalent block after the `ad_metrics_replace_window` call and before `markSynced`:

```javascript
        // See google-ads-sync.js: deep grain must never fail the campaign sync.
        let deep = { counts: {}, skipped: [], unsupportedCurrency: [] };
        try {
            const known = await integrationRepository.listAdAccounts(orgId, 'meta_ads').catch(() => []);
            const byId = new Map((known ?? []).map((a) => [String(a.customer_id), a]));
            const { supported, unsupported } = partitionAccountsByCurrency(
                aidsWithRows.map((aid) => ({ customer_id: aid, currency: byId.get(String(aid))?.currency ?? null })),
            );
            const r = await syncMetaDeep(orgId, {
                accessToken: access_token,
                accountIds: supported,
                since: daysAgo(92),
                until,
                fetchLevel: (accountId, token, level, s, u) => queryAccountLevel(accountId, token, level, s, u),
            });
            deep = { ...r, unsupportedCurrency: unsupported };
        } catch (err) {
            console.error('[meta_ads] deep-grain sync failed:', err.message);
            deep = { counts: {}, skipped: [], unsupportedCurrency: [], error: String(err.message).slice(0, 200) };
        }
```

Add the level-aware fetcher next to `queryAccount` in `meta-ads-sync.js`:

```javascript
// Same insights edge as queryAccount, at ad-set or ad level. Kept here because
// it shares the paging loop and the token; the parsing lives in the deep-sync
// module.
async function queryAccountLevel(accountId, accessToken, level, sinceDate, untilDate) {
    const { INSIGHT_FIELDS: DEEP_FIELDS } = await import('./meta-ads-deep-sync.js');
    const timeRange = encodeURIComponent(JSON.stringify({ since: sinceDate, until: untilDate }));
    let url = `${graphBase()}/${apiVersion()}/act_${accountId}/insights`
        + `?level=${level}&time_increment=1&time_range=${timeRange}`
        + `&fields=${DEEP_FIELDS}&limit=500&access_token=${encodeURIComponent(accessToken)}`;
    const rows = [];
    let guard = 0;
    while (url && guard < 400) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error?.message || `insights ${level} HTTP ${res.status}`);
        for (const r of body.data ?? []) rows.push(r);
        url = body.paging?.next || null;
        guard++;
    }
    return rows;
}
```

- [ ] **Step 4: Run the wiring test and the full suite**

Run: `cd backend && npx vitest run test/ad-deep-sync.wiring.test.mjs && npm test`
Expected: wiring PASS (3 tests); full suite green with no regressions in `google-ads-sync.test.mjs` or `meta-ads-sync.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/google-ads-sync.js backend/src/lib/integrations/meta-ads-sync.js backend/test/ad-deep-sync.wiring.test.mjs
git commit -m "feat(ads): run the deep-grain pull after each campaign sync

Wrapped so it can never fail the campaign sync. Campaign grain feeds every
existing marketing figure; deep grain feeds two new pages that tolerate
being a day stale, so a keyword pull tripping a 403 throttle must not cost
us the day's spend.

Non-GBP accounts are filtered out before the pull and reported on the
result, rather than having their spend mis-converted."
```

---

### Task 10: Reconciliation service and endpoint

**Files:**
- Create: `backend/src/services/ad-reconciliation.service.js`
- Modify: `backend/src/routes/marketing.routes.js`
- Modify: `backend/src/controllers/marketing.controller.js`
- Modify: `docs/API.md`
- Test: `backend/test/ad-reconciliation.service.test.mjs`

**Interfaces:**
- Consumes: `adGrainRepository.rollup` (Task 4), `marketingRepository.spendByCampaign` (existing).
- Produces:
  - `adReconciliationService.build(orgId, { since, until, provider }) -> Promise<{ provider, since, until, levels: Array<{ grain, label, spendPence, campaignSpendPence, gapPence, gapPct, additive, note }> }>`
  - `GET /api/marketing/reconciliation?since&until&provider` — `requirePermission('marketing.view')`

- [ ] **Step 1: Write the failing test**

```javascript
// Reconciliation. The owner's acceptance criterion is that our numbers tally
// with the platform's, so the tally is a product surface, not a manual check.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { rollup: vi.fn() },
}));
vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: { spendByCampaign: vi.fn() },
}));

const { adReconciliationService } = await import('../src/services/ad-reconciliation.service.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const RANGE = { since: '2026-06-01', until: '2026-08-31' };

beforeEach(() => {
    marketingRepository.spendByCampaign.mockResolvedValue([
        { campaign_id: 'A', spend_pence: 30000 },
        { campaign_id: 'B', spend_pence: 14800 },
    ]);   // £448.00 of campaign spend
});

describe('google reconciliation', () => {
    it('reports ad groups as exact and keywords as an expected shortfall', async () => {
        adGrainRepository.rollup.mockImplementation(async (_o, grain) => (
            grain === 'google_adgroup' ? [{ spend_pence: 44800 }]
          : grain === 'google_ad'      ? [{ spend_pence: 44800 }]
          : [{ spend_pence: 41200 }]   // keywords fall short — unkeyworded traffic
        ));

        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        const byGrain = Object.fromEntries(out.levels.map((l) => [l.grain, l]));

        expect(byGrain.google_adgroup.gapPence).toBe(0);
        expect(byGrain.google_keyword.spendPence).toBe(41200);
        expect(byGrain.google_keyword.gapPence).toBe(3600);
        expect(byGrain.google_keyword.gapPct).toBeCloseTo(8.04, 1);
        // The keyword gap is expected, so it must be explained, not flagged.
        expect(byGrain.google_keyword.note).toMatch(/no keyword/i);
        expect(byGrain.google_adgroup.note).toBeNull();
    });
});

describe('meta reconciliation', () => {
    it('marks reach non-additive and expects ad sets and ads to tie', async () => {
        adGrainRepository.rollup.mockResolvedValue([{ spend_pence: 44800 }]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'meta_ads' });
        const byGrain = Object.fromEntries(out.levels.map((l) => [l.grain, l]));

        expect(byGrain.meta_adset.gapPence).toBe(0);
        expect(byGrain.meta_ad.gapPence).toBe(0);
        expect(byGrain.meta_adset.additive).toBe(true);
        expect(out.reachNote).toMatch(/unique people/i);
    });

    it('surfaces a real discrepancy rather than hiding it', async () => {
        adGrainRepository.rollup.mockResolvedValue([{ spend_pence: 40000 }]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'meta_ads' });
        const adset = out.levels.find((l) => l.grain === 'meta_adset');
        expect(adset.gapPence).toBe(4800);
        expect(adset.note).toMatch(/does not reconcile/i);
    });
});

describe('empty data', () => {
    it('reports a zero campaign total without dividing by zero', async () => {
        marketingRepository.spendByCampaign.mockResolvedValue([]);
        adGrainRepository.rollup.mockResolvedValue([]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        expect(out.levels.every((l) => l.gapPct === null)).toBe(true);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/ad-reconciliation.service.test.mjs`
Expected: FAIL — cannot resolve `../src/services/ad-reconciliation.service.js`.

- [ ] **Step 3: Write the service**

```javascript
// ============================================================================
// Ad reconciliation — does our deep-grain total agree with the campaign total
// the platform reports?
//
// This exists because "the numbers must tally exactly" is the acceptance
// criterion for the deep pull. Making the tally a product surface means a
// divergence is seen on screen rather than discovered in a client conversation.
//
// The Google keyword gap is EXPECTED, not a defect: Dynamic Search Ads traffic
// carries no keyword and Display/Video campaigns have none at all, so keyword
// cost is always a subset of campaign cost. Google's own interface shows the
// same shortfall. It is explained rather than flagged.
// ============================================================================
import { adGrainRepository } from "../repositories/ad-grain.repository.js";
import { marketingRepository } from "../repositories/marketing.repository.js";

const LEVELS = {
    google_ads: [
        { grain: 'google_adgroup', label: 'Ad groups', expectShortfall: false },
        { grain: 'google_ad',      label: 'Ads',       expectShortfall: false },
        { grain: 'google_keyword', label: 'Keywords',  expectShortfall: true },
    ],
    meta_ads: [
        { grain: 'meta_adset', label: 'Ad sets', expectShortfall: false },
        { grain: 'meta_ad',    label: 'Ads',     expectShortfall: false },
    ],
};

const SHORTFALL_NOTE =
    'Keyword cost is always a subset of campaign cost: Dynamic Search Ads traffic carries no keyword, '
  + 'and Display and Video campaigns have none at all. Google reports the same gap.';

const MISMATCH_NOTE =
    'This level does not reconcile to the campaign total. Investigate before relying on it.';

const REACH_NOTE =
    'Reach counts unique people, so it is never additive — ad set reach cannot be summed to a campaign total.';

// A gap under this is rounding, not a discrepancy worth reporting.
const TOLERANCE_PENCE = 100;

function sumSpend(rows) {
    return (rows ?? []).reduce((acc, r) => acc + Number(r.spend_pence ?? 0), 0);
}

export const adReconciliationService = {
    async build(orgId, { since, until, provider }) {
        const levels = LEVELS[provider];
        if (!levels) throw new Error(`ad-reconciliation: unknown provider '${provider}'`);

        const campaignRows = await marketingRepository.spendByCampaign(orgId, { since, until, provider });
        const campaignSpendPence = sumSpend(campaignRows);

        const out = [];
        for (const level of levels) {
            const rows = await adGrainRepository.rollup(orgId, level.grain, { since, until });
            const spendPence = sumSpend(rows);
            const gapPence = campaignSpendPence - spendPence;
            const material = Math.abs(gapPence) > TOLERANCE_PENCE;
            out.push({
                grain: level.grain,
                label: level.label,
                spendPence,
                campaignSpendPence,
                gapPence: material ? gapPence : 0,
                // null, not 0, on a zero denominator — a percentage of nothing
                // is not zero, it is unknowable.
                gapPct: campaignSpendPence > 0 ? (gapPence / campaignSpendPence) * 100 : null,
                additive: true,
                note: !material ? null : (level.expectShortfall ? SHORTFALL_NOTE : MISMATCH_NOTE),
            });
        }

        return {
            provider,
            since,
            until,
            campaignSpendPence,
            levels: out,
            reachNote: provider === 'meta_ads' ? REACH_NOTE : null,
        };
    },
};
```

- [ ] **Step 4: Add the controller, route and API doc**

In `backend/src/controllers/marketing.controller.js`:

```javascript
import { adReconciliationService } from "../services/ad-reconciliation.service.js";

export async function getReconciliation(req, res, next) {
    try {
        const { since, until, provider = 'google_ads' } = req.query;
        if (!since || !until) return res.status(400).json({ error: 'since and until are required' });
        if (provider !== 'google_ads' && provider !== 'meta_ads') {
            return res.status(400).json({ error: "provider must be 'google_ads' or 'meta_ads'" });
        }
        const data = await adReconciliationService.build(req.user.organisation_id, { since, until, provider });
        res.json(data);
    } catch (err) { next(err); }
}
```

In `backend/src/routes/marketing.routes.js`, alongside the existing routes:

```javascript
router.get('/reconciliation', requirePermission('marketing.view'), getReconciliation);
```

Append to `docs/API.md` under the Marketing section:

```markdown
### GET /api/marketing/reconciliation

Compares deep-grain spend totals against the campaign total for a window.

**Permission:** `marketing.view`

**Query:** `since` (YYYY-MM-DD, required), `until` (YYYY-MM-DD, required),
`provider` (`google_ads` | `meta_ads`, default `google_ads`).

**Response:** `{ provider, since, until, campaignSpendPence, levels: [{ grain,
label, spendPence, campaignSpendPence, gapPence, gapPct, additive, note }],
reachNote }`

`gapPct` is `null` when there is no campaign spend in the window. A non-null
`note` on the Google keyword level explains an expected shortfall, not a fault.
```

- [ ] **Step 5: Run tests and commit**

Run: `cd backend && npx vitest run test/ad-reconciliation.service.test.mjs && npm run lint`
Expected: PASS, 4 tests; lint clean.

```bash
git add backend/src/services/ad-reconciliation.service.js backend/src/controllers/marketing.controller.js backend/src/routes/marketing.routes.js backend/test/ad-reconciliation.service.test.mjs docs/API.md
git commit -m "feat(ads): reconciliation endpoint comparing deep grain to campaign totals

Tallying with the platform is the acceptance criterion for the deep pull,
so the tally is a product surface rather than a manual check.

The Google keyword shortfall is explained, not flagged: DSA traffic has no
keyword and Display/Video campaigns have none, so keyword cost is always a
subset of campaign cost and Google shows the same gap. Any other level
diverging is reported as a genuine discrepancy.

gapPct is null on a zero denominator — a percentage of nothing is
unknowable, not zero."
```

---

### Task 11: Reconciliation panel on the Integrations page

**Files:**
- Create: `frontend/features/marketing/components/AdReconciliationPanel.tsx`
- Modify: `frontend/features/marketing/api.ts`
- Modify: `frontend/features/marketing/hooks.ts`
- Modify: `frontend/features/integrations/components/IntegrationsScreen.tsx`

**Interfaces:**
- Consumes: `GET /api/marketing/reconciliation` (Task 10).
- Produces: `useAdReconciliation(provider, since, until)` React Query hook; `<AdReconciliationPanel />`.

- [ ] **Step 1: Add the API client**

In `frontend/features/marketing/api.ts`:

```typescript
// NOTE the /api prefix. The Next proxy forwards the path verbatim, so a
// missing prefix 404s SILENTLY into an empty state rather than erroring.
export type ReconciliationLevel = {
    grain: string;
    label: string;
    spendPence: number;
    campaignSpendPence: number;
    gapPence: number;
    gapPct: number | null;
    additive: boolean;
    note: string | null;
};

export type Reconciliation = {
    provider: 'google_ads' | 'meta_ads';
    since: string;
    until: string;
    campaignSpendPence: number;
    levels: ReconciliationLevel[];
    reachNote: string | null;
};

export async function fetchReconciliation(
    provider: 'google_ads' | 'meta_ads', since: string, until: string,
): Promise<Reconciliation> {
    const qs = new URLSearchParams({ provider, since, until });
    const res = await fetch(`/api/backend/api/marketing/reconciliation?${qs}`);
    if (!res.ok) throw new Error(`reconciliation: ${res.status}`);
    return res.json();
}
```

- [ ] **Step 2: Add the hook**

In `frontend/features/marketing/hooks.ts`:

```typescript
export function useAdReconciliation(
    provider: 'google_ads' | 'meta_ads', since: string, until: string,
) {
    return useQuery({
        queryKey: ['marketing', 'reconciliation', provider, since, until],
        queryFn: () => fetchReconciliation(provider, since, until),
        staleTime: 5 * 60_000,
    });
}
```

- [ ] **Step 3: Write the panel**

```tsx
'use client';

import { useAdReconciliation } from '../hooks';
import type { ReconciliationLevel } from '../api';

const pounds = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function LevelRow({ level }: { level: ReconciliationLevel }) {
    const reconciles = level.gapPence === 0;
    return (
        <tr className="border-t border-slate-100">
            <td className="py-2 pr-4 text-slate-700">{level.label}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{pounds(level.spendPence)}</td>
            <td className="py-2 pr-4 text-right tabular-nums text-slate-500">{pounds(level.campaignSpendPence)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">
                {reconciles
                    ? <span className="text-emerald-700">Reconciles</span>
                    : <span className="text-slate-700">
                          {pounds(level.gapPence)}
                          {level.gapPct !== null && <span className="text-slate-400"> ({level.gapPct.toFixed(1)}%)</span>}
                      </span>}
            </td>
        </tr>
    );
}

export function AdReconciliationPanel({
    provider, since, until,
}: { provider: 'google_ads' | 'meta_ads'; since: string; until: string }) {
    const { data, isLoading, error } = useAdReconciliation(provider, since, until);

    if (isLoading) return <p className="text-sm text-slate-500">Checking totals…</p>;
    if (error) return <p className="text-sm text-slate-500">Could not check totals.</p>;
    if (!data) return null;

    return (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">
                {provider === 'google_ads' ? 'Google Ads' : 'Meta Ads'} totals
            </h3>
            <p className="mt-1 text-xs text-slate-500">
                Our figures against the campaign total for {data.since} to {data.until}.
            </p>

            <table className="mt-3 w-full text-sm">
                <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-400">
                        <th className="pb-2 pr-4 text-left font-medium">Level</th>
                        <th className="pb-2 pr-4 text-right font-medium">Our total</th>
                        <th className="pb-2 pr-4 text-right font-medium">Campaign total</th>
                        <th className="pb-2 pr-4 text-right font-medium">Difference</th>
                    </tr>
                </thead>
                <tbody>
                    {data.levels.map((l) => <LevelRow key={l.grain} level={l} />)}
                </tbody>
            </table>

            {/* An expected gap is explained here rather than shown as a fault. */}
            {data.levels.filter((l) => l.note).map((l) => (
                <p key={l.grain} className="mt-3 text-xs leading-relaxed text-slate-500">
                    <span className="font-medium text-slate-600">{l.label}:</span> {l.note}
                </p>
            ))}
            {data.reachNote && (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{data.reachNote}</p>
            )}
        </section>
    );
}
```

- [ ] **Step 4: Mount it and verify the build**

In `frontend/features/integrations/components/IntegrationsScreen.tsx`, render the panel beneath the existing Google Ads and Meta Ads connector cards, passing the last 92 days:

```tsx
import { AdReconciliationPanel } from '../../marketing/components/AdReconciliationPanel';

// …inside the component, alongside the ad connector cards:
const until = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10);

<div className="mt-4 grid gap-4 md:grid-cols-2">
    <AdReconciliationPanel provider="google_ads" since={since} until={until} />
    <AdReconciliationPanel provider="meta_ads"  since={since} until={until} />
</div>
```

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck clean, "No ESLint warnings or errors", "Compiled successfully".

- [ ] **Step 5: Commit**

```bash
git add frontend/features/marketing/components/AdReconciliationPanel.tsx frontend/features/marketing/api.ts frontend/features/marketing/hooks.ts frontend/features/integrations/components/IntegrationsScreen.tsx
git commit -m "feat(ads): reconciliation panel on the Integrations page

Shows our deep-grain totals against the campaign total per level, so a
divergence appears on screen rather than in a client conversation.

An expected gap (Google keywords) is explained in prose beneath the table
rather than styled as an error, and Meta's reach carries its non-additive
note."
```

---

### Task 12: Apply on hosted and verify

**Files:**
- Modify: `CLAUDE.md` (current-state log)

- [ ] **Step 1: Run the full gates**

Run: `cd backend && npm test && npm run lint && npm run typecheck`
Then: `cd ../frontend && npm run typecheck && npm run lint && npm run build`
Expected: all green. Record the backend test count.

- [ ] **Step 2: Scan for secrets before anything leaves the machine**

Run: `ggshield secret scan commit-range origin/main..HEAD`
Expected: "No secrets have been found".

- [ ] **Step 3: Apply the migration on hosted**

Apply `supabase/migrations/20260101000148_ad_deep_grain.sql` to project `mkfhpzjbijbachoonytt` via the Supabase MCP `apply_migration`.

- [ ] **Step 4: Verify on hosted**

Run this against hosted and confirm each expectation:

```sql
-- 1. Five tables exist, RLS on, each with the full core contract.
SELECT c.relname,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM information_schema.columns i
         WHERE i.table_schema='public' AND i.table_name=c.relname) AS cols
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('ad_meta_adsets','ad_meta_ads','ad_google_adgroups',
                     'ad_google_ads','ad_google_keywords')
 ORDER BY 1;
-- Expect: 5 rows, rls_on = true for all.

-- 2. All six functions present, and NOT callable by anon or authenticated.
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('ad_grain_replace_window','ad_grain_restamp_practices',
                     'ad_grain_rollup','ad_keyword_rollup',
                     '_ad_grain_table','_ad_grain_provider')
 ORDER BY 1;
-- Expect: anon = false and auth = false on every row; svc = true.
```

Then run `NOTIFY pgrst, 'reload schema';`

- [ ] **Step 5: Trigger a real sync and confirm the numbers**

Trigger a Google Ads and a Meta Ads sync for the live org, then:

```sql
SELECT 'adgroups' AS grain, count(*) rows, count(DISTINCT entity_id) entities,
       min(metric_date) mn, max(metric_date) mx, sum(spend_pence) spend,
       count(*) FILTER (WHERE practice_id IS NOT NULL) stamped
  FROM ad_google_adgroups
UNION ALL SELECT 'google_ads', count(*), count(DISTINCT entity_id), min(metric_date), max(metric_date), sum(spend_pence), count(*) FILTER (WHERE practice_id IS NOT NULL) FROM ad_google_ads
UNION ALL SELECT 'keywords',   count(*), count(DISTINCT entity_id), min(metric_date), max(metric_date), sum(spend_pence), count(*) FILTER (WHERE practice_id IS NOT NULL) FROM ad_google_keywords
UNION ALL SELECT 'meta_adsets',count(*), count(DISTINCT entity_id), min(metric_date), max(metric_date), sum(spend_pence), count(*) FILTER (WHERE practice_id IS NOT NULL) FROM ad_meta_adsets
UNION ALL SELECT 'meta_ads',   count(*), count(DISTINCT entity_id), min(metric_date), max(metric_date), sum(spend_pence), count(*) FILTER (WHERE practice_id IS NOT NULL) FROM ad_meta_ads;
```

Expect: `mn` no earlier than 92 days ago; `stamped` > 0 for accounts that are mapped to a practice; Meta ad-set spend equal to campaign spend over the same window; Google ad-group spend equal to campaign spend and keyword spend somewhat below it.

**Do not assert a specific total.** Ad platform figures move in both directions between pulls — conversions are restated for up to 90 days and spend is finalised late. The invariants above are the durable check; a fixed number is not.

- [ ] **Step 6: Update the state log and commit**

Add a bullet to the "Current state" section of `CLAUDE.md` recording: what shipped, that `000148` IS applied on hosted with `NOTIFY pgrst` run, the 92-day window, the RPC-only read rule, and the keyword-shortfall behaviour.

```bash
git add CLAUDE.md
git commit -m "docs: record the ads deep-grain pull in the state log"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Five tables, shared contract | 1 |
| Per-grain extras (reach/frequency, keyword quality + impression share) | 1 |
| Replace-never-append, advisory lock | 2 |
| practice_id at the write choke point + restamp | 2 |
| Rollup RPCs, allowlisted grain, plpgsql EXECUTE ... USING | 3 |
| Grant idiom on every RPC | 2, 3 (verified in 12) |
| RPC-only reads, no direct table selects | 4 |
| Currency guard | 5, wired in 9 |
| Google ad group + ad GAQL | 6 |
| Google keyword GAQL with quality + impression share | 7 |
| Meta ad set + ad insights | 8 |
| 92-day window | 6 (`DEEP_WINDOW_DAYS`), wired in 9 |
| 403-as-retryable | 6, 9 (deep failure never fails campaign sync) |
| Reconciliation across both platforms | 10, 11 |
| Idempotency test ("no duplication") | 2 Step 1 |
| Cross-org isolation | every RPC takes `p_org`; enforced by the repository |
| Migration applied on hosted + NOTIFY pgrst | 12 |

**Gap found and closed:** the spec's testing section requires a cross-org
isolation test and no task had one — Task 2's SQL assertion seeds a single org.
A `cross-org isolation` block asserting `p_org` on every RPC this repository
issues is now folded into Task 4's test file, where the tenant boundary
actually lives.

**Placeholder scan:** no TBD/TODO; every code step carries real code.

**Type consistency:** `replaceWindow(orgId, grain, customerIds, rows)` is called with that order in Tasks 6, 8 and 9. `rollup(orgId, grain, {since, until, ...})` matches Task 10's usage. `syncGoogleDeep` and `syncMetaDeep` take injected fetchers (`queryCustomer` / `fetchLevel`) in both their definitions and their call sites. Grain strings are identical across the SQL allowlist, `GRAINS`, `STREAMS` and `LEVELS`.
