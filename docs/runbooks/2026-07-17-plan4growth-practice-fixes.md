# Runbook — Plan4growth practice fixes (2026-07-17)

Org: `1a5f888a-0dfe-4802-acf8-6003665089ad` (Plan4growth). Owner: `dev.ruhithpasha@gmail.com`.
Plan: `docs/superpowers/plans/2026-07-17-cockpit-mockup-port.md` (Task 1).
Spec: `docs/superpowers/specs/2026-07-17-cockpit-mockup-port-design.md`.

These are **tenant data** fixes, not schema — deliberately not a migration. Run in order; verify
after each. Executed via the Supabase MCP against project `mkfhpzjbijbachoonytt`.

## Why this became a prerequisite, not a nice-to-have

Before the cockpit-mockup-port branch, the cockpit only ever showed practices that had cash-up
data. §6 Profit vs Breakeven and §1's month block enumerate `practices` **directly** for the first
time. So the dead duplicate row below now ships as a *visible* phantom — a second, near-identically
named row reading "Not reporting", incrementing `excludedCount`, and offering an editable cost
model. That is why this runs before the branch merges.

## 1. Rename practices to site names

The rows are named after legal entities; the owner and every mockup think in site names. This is
why "Barnet is missing" is a recurring false alarm — Barnet is on screen as "GM Dental & Implant
Centre". Ids are unchanged, so nothing re-maps: every FK is on `practice_id`.

```sql
update practices set name = 'Ashford'     where id = 'bf70e504-a7e0-45f6-b90b-ef4039e4b789';
update practices set name = 'Barnet'      where id = '853affdd-fdde-4dd8-840a-c798f738a685';
update practices set name = 'Rochester'   where id = 'a0ddc392-6c92-4a58-99ba-6c334d292084';
update practices set name = 'Bexleyheath (Fixed Teeth Solutions)'
                                          where id = '03117019-c2d1-432d-a6ae-00ec41538bb3';
```

Bexleyheath and Fixed Teeth Solutions are the **same site** (owner-confirmed 2026-07-17).
Both names are in active use — Emergent says Bexleyheath, Meta's ad account says "GM - FTS" — so
the compound name keeps both recognisable. QuickBooks corroborates: one of the four live companies
is "Gmd Bexleyheath Ltd".

## 2. Delete the dead duplicate practice

`675c4bfc-fa5f-480e-a120-876a81ddcc0c` "GM Dental And Implant Centre" — the duplicate recorded in
memory `cockpit-lead-attribution` as the cause of the phantom Google leads.

**It is not fully empty.** An exhaustive sweep of every FK referencing `practices.id` found exactly
one table still pointing at it: `contacts.practice_id`, **49 rows**, all GoHighLevel-sourced. That
FK is `ON DELETE NO ACTION`, so `DELETE FROM practices` **fails** while they exist.

**Guard — run this first. If any count except `contacts` is > 0, STOP.** The row is no longer dead
and deleting it would lose data.

```sql
select 'contacts' t, count(*) from contacts where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'leads', count(*) from leads where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'appointments', count(*) from appointments where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'treatment_accepted', count(*) from treatment_accepted where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'emergent_daily_cashup', count(*) from emergent_daily_cashup where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'emergent_monthly_pl', count(*) from emergent_monthly_pl where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'emergent_practice_map', count(*) from emergent_practice_map where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'integration_accounts', count(*) from integration_accounts where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'ad_accounts', count(*) from ad_accounts where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'ad_metrics', count(*) from ad_metrics where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'invoice_items', count(*) from invoice_items where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c'
union all select 'practice_cost_model', count(*) from practice_cost_model where practice_id='675c4bfc-fa5f-480e-a120-876a81ddcc0c';
```

Then null the contacts and delete:

```sql
update contacts set practice_id = null
 where practice_id = '675c4bfc-fa5f-480e-a120-876a81ddcc0c';
delete from practices where id = '675c4bfc-fa5f-480e-a120-876a81ddcc0c';
```

The 49 become unmapped, which every read path already handles ("Unmapped practice"), and the next
GoHighLevel sync re-stamps them from their subaccount's `practice_id`. **Do not guess a practice
for them** — the dead row has no `integration_accounts` entry, so there is no evidence of which
site they belong to. Null is the honest state.

## 3. Create Warwick Lodge

A real practice (owner-confirmed 2026-07-17) with **no data feed of any kind**: no Emergent
business, no cash-up, no ad account, no GoHighLevel subaccount. Created so the gap is visible;
§6 renders it "Not reporting" — never £0, which would read as "traded nothing today".

```sql
insert into practices (organisation_id, name, active)
select '1a5f888a-0dfe-4802-acf8-6003665089ad', 'Warwick Lodge', true
 where not exists (
   select 1 from practices
    where organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad'
      and name = 'Warwick Lodge');
```

## 4. Reconnect the failed GoHighLevel subaccounts — OWNER ACTION, not SQL

Three of four subaccounts are `status = 'failed'` (Barnet, Rochester, Ashford); only
Bexleyheath/FTS is active. §3's lead counts go stale until an owner reconnects them in the UI.

```sql
-- check
select ia.status, p.name from integration_accounts ia
  left join practices p on p.id = ia.practice_id
 where ia.organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad'
   and ia.provider = 'gohighlevel' and ia.practice_id is not null
 order by p.name;
```

## Verification

```sql
select name, active from practices
 where organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad' order by name;
-- expect exactly 5: Ashford, Barnet, Bexleyheath (Fixed Teeth Solutions), Rochester, Warwick Lodge

select count(*) from contacts where practice_id = '675c4bfc-fa5f-480e-a120-876a81ddcc0c';
-- expect 0

select m.business_name, p.name from emergent_practice_map m
  left join practices p on p.id = m.practice_id
 where m.organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad' order by m.business_name;
-- expect Ashford->Ashford, Barnet->Barnet, Bexleyheath->Bexleyheath (Fixed Teeth Solutions),
--        Rochester->Rochester, Elevate360 Academy->null, Webhook Test Ping->null
```

## Still outstanding after this runbook

- **Configure an Emergent business for Warwick Lodge.** Until then it reads "Not reporting"
  everywhere. The Emergent map auto-discovers businesses on every sync, so the row lights up on
  its own once cash-up arrives.
- **Reconnect the three failed GoHighLevel subaccounts** (step 4).
- **Consolidate the ad connector into one org** — the same ad accounts carry real spend under both
  `developer` and Plan4growth, so Plan4growth's spend is incomplete (see memory
  `ad-account-practice-map-empty`).

---

## Rollback snapshot (captured immediately before execution, 2026-07-17)

Guard re-run at execution time: the duplicate still had **exactly** `contacts = 49` and **zero**
rows in every other table listed above.

### Practice names as they were

| id | name before | created_at |
|---|---|---|
| `bf70e504-a7e0-45f6-b90b-ef4039e4b789` | GM Dental & Implant Centre Ashford | 2026-06-10 |
| `853affdd-fdde-4dd8-840a-c798f738a685` | GM Dental & Implant Centre | 2026-06-10 |
| `a0ddc392-6c92-4a58-99ba-6c334d292084` | GM Dental & Implant Centre - Rochester | 2026-06-10 |
| `03117019-c2d1-432d-a6ae-00ec41538bb3` | Fixed Teeth Solutions by GM Dental | 2026-06-10 |
| `675c4bfc-fa5f-480e-a120-876a81ddcc0c` | GM Dental And Implant Centre *(deleted)* | **2026-06-14** |

The duplicate was created four days after the other four — consistent with an accidental later
insert rather than a real site.

### Undo the renames

```sql
update practices set name = 'GM Dental & Implant Centre Ashford'     where id = 'bf70e504-a7e0-45f6-b90b-ef4039e4b789';
update practices set name = 'GM Dental & Implant Centre'             where id = '853affdd-fdde-4dd8-840a-c798f738a685';
update practices set name = 'GM Dental & Implant Centre - Rochester' where id = 'a0ddc392-6c92-4a58-99ba-6c334d292084';
update practices set name = 'Fixed Teeth Solutions by GM Dental'     where id = '03117019-c2d1-432d-a6ae-00ec41538bb3';
```

### Undo the Warwick Lodge insert

```sql
delete from practices
 where organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad' and name = 'Warwick Lodge';
```
Safe only while it still has no dependent rows — it has no feed, so it should stay empty.

### The 49 nulled contacts

The duplicate practice row is **not** restorable by this snapshot: a resurrected row would mint a
new `id`, and nothing references the old one any more. These contacts were set to
`practice_id = null`; the next GoHighLevel sync re-stamps them from their subaccount's mapping,
which is the correct destination. Restoring them to a resurrected duplicate would re-create the
phantom-leads bug. Recorded for completeness only:

```
06d766cb-4c51-4970-9a87-aceda99bd94f, 0b9cbf17-bbe2-4675-9771-b70b9cc3c9f1, 13ddbc89-cc68-4735-8fad-b0acb1b87970,
17447a44-cc65-4a6b-b140-5dc11dc15c4a, 191c0b20-114f-4e71-abb8-2c21909658d9, 1e276a84-5d06-4386-85c5-5909c9a1ca88,
233217c7-0b02-4786-90c0-e074bb4d6926, 249c66c0-39a8-44e5-b9bf-588890e1ba04, 24eac2b4-b55c-45cc-8f3d-6388e1fbd817,
2a2ae2f6-91a0-46ad-bbac-e2b43651224d, 2cd54150-dc78-4a22-8546-9f8c10511139, 318f094c-3d08-4b72-9e2c-493302c7dfbb,
3b30246d-721a-4667-9a2c-7fa359d60f0d, 3bc2ae4f-190e-404b-a908-980ee1e4e497, 3c643ab8-0703-432b-bbd6-0fc42ad7a35d,
48340077-945b-4d41-a763-e2dc929136fc, 50d8fc30-2899-4070-b3eb-65e5df9e36be, 54993151-85fb-4f82-9a2a-427e2890d83a,
56ae3650-b90f-4751-8672-298218fdadd6, 655c308e-0bfc-49b6-8ef5-50544bbf2550, 673f5ea1-8453-4059-9dc4-b53ec51c5509,
677eed67-4589-48c9-a9f3-8a910d70f5e7, 678cbe7f-33cd-4bac-8de6-2ead4ad1159f, 67cff0a6-d94c-45da-89c7-588e108ad4c4,
6d372172-c51f-4110-87cd-4faf056a430a, 6e5ce75d-32e3-4e26-82d0-12f4e844b653, 6f13b5db-758d-42dd-a84f-feaf583759a2,
72dc4685-9271-42a2-8bb6-cbf1cccc221d, 78277fe0-82ea-4c24-b82c-ef40e599d9ff, 7a623743-6700-435a-9bab-28028ce285d7,
7ccfb80d-e08c-4571-8281-e7a25e25eebf, 7dece41b-d9a3-4de5-a580-2378ea8b85fa, 8296db63-507e-4147-bbbd-c5e4948602de,
977e8606-5f8d-49aa-bf0e-b05b9509e532, 9bce6e85-9e7e-416b-9700-c6afc3772a26, a51c527e-f5ed-43a8-b52a-f6288104c48d,
b589a56f-4970-422f-9a54-01266539040e, cf908df6-2f51-41e8-8c53-8c856704fb6b, dbc032a3-55bb-42d8-8e39-9c051f6e8f33,
e464ea02-d739-4dfd-b08c-a66062c17b34, e50ef753-f5e4-4061-8042-4d74a08d7c08, eff89ecf-123a-4c68-9a7a-040081f794b6,
f2a4a395-1857-48b5-8d62-cc279586962d, f2f94d91-cf41-4fc8-9d38-6474a4903f17, f3eaacbd-ed14-4e8b-975f-851c8b942def,
f6b83648-e665-4e99-9a77-4138e16551cb, f767ce1f-3346-4915-bc24-ab0f57b08ad5, fcb6629f-3e58-44a7-b77e-34f4714f8cd0,
fe128fd0-355e-45b7-8d7d-ec7c87278348
```
