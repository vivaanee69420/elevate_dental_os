# Reviews & Reputation — Setup & Go-Live Runbook

Live Google + Facebook reviews on the `/reviews` screen. The full pipeline (data
model, sync, API, UI) is **already built and on `main`**; this document is the
operator runbook to turn it on. Nothing here requires code changes — only Google
Cloud / Meta configuration and a couple of Railway environment variables.

- **Status:** code shipped (commit `312db49`); migration `000070` applied on
  hosted Supabase (`mkfhpzjbijbachoonytt`). Feature is dormant until the keys
  below are set.
- **Two providers, two very different models** — read [Provider models](#provider-models) first.

---

## TL;DR (do this to go live)

1. **Google (works today):** create a Google Cloud project → enable **Places API**
   → create an **API key** → set `GOOGLE_PLACES_API_KEY` on Railway (backend +
   worker services). Done — owners can connect their practices immediately.
2. **Facebook (later):** you already have the Meta app (`META_APP_ID` /
   `META_APP_SECRET`). Submit **Meta App Review** for `pages_show_list` +
   `pages_read_engagement`. Until approved, the Facebook side returns empty and
   does not break anything.
3. Owner logs in → `/reviews` → **Manage sources** → search/add each practice's
   listing → **Sync now**.

---

## Provider models

The two providers are NOT symmetric. This is the single most important thing to
understand.

| | **Google (Places API)** | **Facebook (Graph API)** |
|---|---|---|
| What the operator provides | **One API key**, shared by all tenants | **One Meta app** (id+secret) — already exists | 
| One-time approval | None | **Meta App Review** for page scopes |
| Per-tenant action | Owner searches/adds their `place_id` | Owner **connects their own Facebook** (OAuth) |
| Data visibility | **Public** — any place, no ownership | **Private** — Page-admin token required |
| Reviews returned | Up to ~5 recent + true rating & total count | All recommendations on the Page |
| Replies via API | **No** (read-only; recorded internally only) | No |
| Star ratings | Yes (1–5) | **No** — only recommendations (positive/negative), mapped to 5/1 |
| Who pays | **You** (your key, your bill) | Free |
| Account used | Your business Google account | Each tenant's own FB account (admin of their Page) |

**Why Google is one shared key:** Places reads *public* reviews by `place_id`.
The key only proves "this app may call the API + who pays" — it is not tied to any
business. Each tenant supplies their own `place_id`; tenant isolation is enforced
by `organisation_id` on every row, never by the key.

**Why Facebook is per-tenant:** Page recommendations are not public via the API.
Reading them needs a Page access token issued to a **Page admin**, so each org's
owner must connect the Facebook account that administers their practice's Page.
The operator only supplies the shared Meta *app* (the OAuth client) + the
one-time App Review.

---

## Part 1 — Google (Places API)

### 1.1 Which Google account?

Any of your Google accounts works — the account only matters for **billing and
admin**, not for which businesses you can read.

- Use the account tied to your **company billing**, not a personal/throwaway one,
  so the project + key survive long-term.
- It does **not** need to own or manage any dental practice listing.
- One account → one Cloud project → one key → all tenants.

### 1.2 Create the key

1. Go to <https://console.cloud.google.com> and sign in with the chosen account.
2. Create (or select) a project, e.g. `elevate-reviews`.
3. **Billing:** attach a billing account (card). Places Details with the `reviews`
   field is a paid SKU; without billing the calls return `REQUEST_DENIED`.
4. **APIs & Services → Library** → search **"Places API"** → **Enable**.
   (The classic "Places API" — the code calls the classic endpoints
   `maps.googleapis.com/maps/api/place/textsearch` and `/details`.)
5. **APIs & Services → Credentials → Create credentials → API key.** Copy it.
6. **Restrict the key** (recommended):
   - **API restrictions →** restrict to **Places API** only.
   - **Application restrictions →** leave as "None", or use Railway's static
     egress IP if you have one. (Browser/referer restrictions do **not** apply —
     the key is used server-side only, never sent to the browser.)

### 1.3 Set the environment variable

Set on **both** the backend service and the worker service in Railway (the nightly
cron runs in the worker process):

```
GOOGLE_PLACES_API_KEY=AIza...your-key...
# optional override, defaults to the classic host:
# GOOGLE_PLACES_API_BASE=https://maps.googleapis.com/maps/api/place
```

Redeploy. That's it — the Google side is live.

### 1.4 Billing expectations

Billed to **your** Google account. Volume is tiny: nightly sync × (locations per
org) × (orgs) + the occasional on-demand sync. A handful of practices costs
pennies/month and sits inside Google's recurring free credit. Set a **budget
alert** in Cloud Console → Billing → Budgets & alerts as a safety net.

---

## Part 2 — Facebook (Graph API)

### 2.1 What you already have

The Meta app is the same one `meta_ads` uses. If `META_APP_ID` and
`META_APP_SECRET` are already set (they are, for ad-spend), the reviews code
reuses them. No second app needed.

The Meta app is created under **your** Meta developer/business account (one,
yours). Tenants never touch your app credentials.

### 2.2 The gate: Meta App Review

Reading Page recommendations needs two permissions that are **not** granted by
default and require App Review:

- `pages_show_list` — to enumerate the pages a connected user administers.
- `pages_read_engagement` — to read the page's ratings/recommendations.

Steps (operator, once):

1. <https://developers.facebook.com> → your app → **App Review → Permissions and
   Features.**
2. Request **Advanced Access** for `pages_show_list` and `pages_read_engagement`.
3. Provide the screencast / use-case description (reading a connected business's
   own reviews into their dashboard). Submit.
4. Approval typically takes a few business days.

Until approved, `listPages` / `getPageRatings` throw an `OAuthException`; the sync
catches it per-source, stamps `last_error`, and shows zero Facebook reviews. The
Google side is unaffected.

### 2.3 Optional: expand the connect scope

The `meta_ads` OAuth currently requests `ads_read` only. To let owners grant the
page scopes in the **same** connect flow, add them to the authorize scope:

- File: `backend/src/lib/integrations/meta-ads-provider.js`, the `SCOPES` const.
- Change `['ads_read']` → `['ads_read', 'pages_show_list', 'pages_read_engagement']`.
- Owners must **disconnect + reconnect Meta** once to grant the new scopes.

> If you use the Facebook Login for Business config (`META_LOGIN_CONFIG_ID`), add
> the page permissions to that login configuration instead of the scope string
> (Meta rejects `scope` alongside `config_id`).

### 2.4 Per-tenant connect

Each org owner: **Integrations → connect Meta** with the Facebook account that
**administers their practice's Page**. After consent, the backend exchanges the
token, and the reviews source picker (Facebook tab) lists their pages.

---

## Part 3 — How owners use it (per tenant)

1. Log in as **owner** → **Reviews** (`/reviews`).
2. Click **Manage sources** (owner-only).
3. **Add a source:**
   - **Google:** pick provider = Google, type the business name + town (e.g.
     "Ashford Dental Kent"), **Search** → pick the correct listing → optionally
     assign a **practice** → **Add**.
   - **Facebook:** pick provider = Facebook, the connected Meta account's pages
     appear (filter by name) → assign a practice → **Add**. (Requires Meta
     connected + App Review approved.)
4. **Select** which sources feed the dashboard (tick/untick — unticking hides a
   source but keeps its synced history).
5. **Sync now** — pulls reviews immediately (live progress bar).
6. The screen then shows real KPIs, by-source / by-practice breakdowns, and a
   recent-reviews feed. Use the **filter bar** (All / Google / Facebook + practice
   dropdown) to slice everything.
7. **Respond / Recover** records a response internally (Google & Facebook are
   read-only via API, so it is not posted back to the platform).

---

## Architecture (for the implementer)

### Data model

- **`review_sources`** (migration `supabase/migrations/20260101000070_review_sources.sql`)
  — mirrors `ad_accounts`. One row per `(organisation_id, provider, external_id)`
  where `provider ∈ {google, facebook}` and `external_id` = Google `place_id` /
  Facebook page id. Columns: `name`, `address`, `practice_id` (nullable link),
  `is_selected`, `rating`, `total_count`, `last_sync_at`, `last_error`.
  This table **is** the "accounts" the filter bar slices by.
- **`reviews`** (existing table) — individual reviews land here, deduped on the
  **full** unique index `uq_reviews_org_source_external (organisation_id, source,
  external_id)`. `source` reuses the existing CHECK (`google` / `facebook` already
  allowed). `external_id` format: Google `"<place_id>:<unix_time>"`, Facebook
  `"<page_id>:<created_time>"`.

> **Gotcha:** the dedup index must be **full**, not partial. PostgREST's upsert
> infers the conflict target by column list and cannot target a partial index
> (it can't supply the `WHERE` predicate). Legacy null-`external_id` rows are fine
> under the default `NULLS DISTINCT`.

> After any hosted DDL: `NOTIFY pgrst, 'reload schema';`

### Aggregates vs feed

The KPI strip and the by-source / by-practice panels are computed from
`review_sources` (`total_count` + `rating` = the **true** volume across all
reviews), **not** from the ≤5 fetched rows. The recent-reviews feed is the
individual `reviews` rows. This is why "Total reviews" can read 1,240 while the
feed shows 5.

### Backend files

| File | Role |
|---|---|
| `lib/integrations/google-places.js` | Places client: `searchPlaces`, `getPlaceReviews`, `isPlacesConfigured`. Key-only, no OAuth. |
| `lib/integrations/meta-reviews.js` | Graph client: `getUserToken` (reuses `meta_ads` token), `listPages`, `getPageRatings` (recommendation → 5/1). |
| `lib/integrations/reviews-sync.js` | `syncOneOrg` (on-demand) + `syncAllOrgs` (cron). Per-source error isolation. |
| `repositories/reviewSource.repository.js` | `review_sources` CRUD + selection + sync-result stamping. |
| `repositories/review.repository.js` | `list` (filtered), `upsertMany` (dedup), `respond`. |
| `services/review.service.js` | Orchestration + summary aggregation + picker search + sync progress. |
| `controllers/review.controller.js` / `routes/reviews.routes.js` | HTTP layer (see API below). |
| `models/review.model.js` | Zod schemas. |
| `workers/index.js` | Nightly `reviews-sync` cron at `10 3 * * *`. |

### Frontend files

| File | Role |
|---|---|
| `features/growth/reviewsApi.ts` | API client + types. |
| `features/growth/reviewsHooks.ts` | React Query hooks. |
| `features/growth/components/ReviewsScreen.tsx` | The screen (live data, filter bar, respond). |
| `features/growth/components/ReviewSourcesPanel.tsx` | Owner-only source manager (search picker, practice assign, selection, sync). |

### API endpoints (mounted at `/api/reviews`, behind `authenticate`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/reviews?source=&practice_id=` | any | Feed + summary + sources (filterable). |
| GET | `/api/reviews/sources` | any | List configured sources. |
| GET | `/api/reviews/sources/search?provider=&q=` | owner | Picker (Google text search / FB page list). |
| POST | `/api/reviews/sources` | owner | Add a source. |
| DELETE | `/api/reviews/sources/:id` | owner | Remove a source. |
| PATCH | `/api/reviews/sources/:id/practice` | owner | Link/unlink a practice. |
| POST | `/api/reviews/sources/selection` | owner | Set the selected sources. |
| POST | `/api/reviews/sync` | owner | Trigger a sync (fire-and-forget). |
| GET | `/api/reviews/sync-progress` | any | Poll live progress. |
| POST | `/api/reviews/:id/respond` | any | Record a response (internal only). |

### Sync

- **On-demand:** owner clicks **Sync now**, or adding a source auto-syncs. Progress
  is polled from in-memory state keyed `(orgId, 'reviews')`.
- **Nightly:** `reviews-sync` cron (`10 3 * * *`) in the worker process runs
  `syncAllOrgs()` for every org with at least one selected source.

---

## Limitations (set expectations)

- **Google:** ≤ 5 reviews per location (Places cap), and **read-only** — you
  cannot post replies back to Google via Places. The overall rating + total count
  are accurate (reflect all reviews). To get the full review history + real
  replies you'd need the **Business Profile API** (see Future work).
- **Facebook:** no star ratings (Meta removed them) — only recommendations
  (positive/negative), mapped to 5/1. Needs App Review before anything appears.
- **Replies** are stored in `reviews.response_body` for your records; they are not
  published to the platform.

---

## Go-live checklist

- [ ] Google Cloud project created on the **billing** account
- [ ] **Places API** enabled + billing attached
- [ ] API key created and **restricted to Places API**
- [ ] `GOOGLE_PLACES_API_KEY` set on Railway **backend + worker**, redeployed
- [ ] (Optional) Cloud budget alert configured
- [ ] Meta App Review submitted for `pages_show_list` + `pages_read_engagement`
- [ ] (Optional) page scopes added to `meta-ads-provider.js` `SCOPES`
- [ ] Verified: owner can add a Google source and **Sync now** returns reviews
- [ ] Verified: `/reviews` filter bar slices by source + practice

---

## Verifying it works

- **Connectivity:** as an owner, Manage sources → Google → search a known
  practice → results should appear. No results / error → check the key + that
  Places API is enabled + billing is on.
- **Sync:** add a source → Sync now → the recent-reviews feed populates and the
  source shows a rating + total count.
- **Tenant isolation:** a second org sees only its own sources/reviews
  (`organisation_id` scoping). Covered by the existing cross-org isolation tests.
- **Parsing:** `backend/test/reviews-places.test.mjs` covers the Places + Graph
  response shaping (synthetic ids, unix→ISO, recommendation→rating). Run:
  `cd backend && npx vitest run test/reviews-places.test.mjs`.

---

## Future work / upgrade paths

- **Google Business Profile API** (the real upgrade): full review history +
  **programmatic replies**. Requires getting the GCP project **allowlisted** for
  the Business Profile API (the "Get Access" form: business justification, a
  verified GBP 60+ days old, a valid website; 3–10 business days; quota goes
  `0 → 300 QPM`). Would replace `google-places.js` with an OAuth `business.manage`
  flow folded into the existing Google connection — same email/account as Google
  Ads. Everything downstream (table, sync, UI, filter) stays.
- **Trustpilot / Treatwell:** the `reviews.source` CHECK already lists them;
  add a connector + a `review_sources.provider` value to light them up.
- **Real replies:** only possible on Business Profile API (Google) — wire the
  respond endpoint to POST the reply once that path exists.
- **Per-source sync progress:** currently one progress key per org; could split
  per source for finer UI feedback on multi-location orgs.
