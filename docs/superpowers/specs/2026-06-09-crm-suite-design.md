# CRM Suite — Backend Wiring Design

**Date:** 2026-06-09
**Branch:** `feat/crm-cluster`
**Status:** Approved, ready for implementation planning

## Summary

Build the backend and live-data wiring for the three remaining stub CRM screens —
**Templates**, **Settings**, and **Sequences** — on top of the existing real leads,
messaging, and comms stack. Landing **Pages** is explicitly **out of scope** for this
sub-project.

The work is the first sub-project of a larger 12-module backend-wiring effort
(clusters A–E; CRM Suite is cluster B). It is decomposed into three phases, built
**one phase per context** (mirroring the DentaCFO `phases.md` model), with its own
trackers `phases-crm-suite.md` + `BUILD-CRM-SUITE.md`.

## Context — what already exists (do not rebuild)

- **Leads**: real backend (`leads.routes.js`, GHL sync). Leads carry `status`
  (Elevate journey enum: `new → contact_attempted → … → treatment_completed`,
  plus `not_proceeding`, `paused`) and `ghl_pipeline_stage_id`/`ghl_stage_name`.
- **Messaging**: `lib/messaging.js` `sendEmail({orgId,...})` / `sendSMS({orgId,...})`
  already resolve a **per-org sender** (org's own Postmark/Twilio creds from the
  encrypted `integrations` table, else platform SES/SNS/Twilio fallback) and log to
  `provider_events`. Sequence dispatch calls these — no new sender work.
- **Comms**: `comms.routes.js` `GET /` + `POST /send`. **Workflows/Automations**:
  `workflows.routes.js` already CRUD + GHL pull (NOT in scope — distinct from Sequences).
- **Frontend mock**: `frontend/features/crm/data.ts` is the contract source. Screens:
  `TemplatesScreen.tsx`, `SettingsScreen.tsx`, `SequencesScreen.tsx`. Amounts in mock
  are **whole pounds**; convert to **pence integers** at the backend-swap point.

## Cross-cutting rules (every phase)

- Layering: `routes → controllers → services → repositories → models` (Zod schemas in `models/`).
- Tenant isolation: every new table has `organisation_id`; repositories use `serviceClient`
  and **manually chain `.eq('organisation_id', orgId)`** on every query (the established path).
- RBAC (project rule 5 — CRM is Reception-accessible): Reception = **use/view**
  (read templates, view sequences); Owner/Practice Manager = **manage** (create/edit/delete,
  toggle live sends). Backend `requireRole`; frontend `ROUTE_PERMISSION`.
- Money = integer pence. British English. No emojis. Light mode only. No dark mode.
- Audit every mutation to `audit_log` (handled by `audit` middleware).
- Per-phase done-criteria: backend (formula+test+`FORMULAS.md` if new calc) → repo →
  service → controller → gated route → `docs/API.md`; frontend api → hook → screen →
  page → nav + route-perm; verify `npm test` green + frontend `tsc --noEmit` clean;
  commit + tick tracker.
- Migrations: idempotent, applied on hosted Supabase, then `NOTIFY pgrst, 'reload schema';`.
  Next free numbers: **000061** (templates), **000062** (settings), **000063** (sequences).

## Phase B1 — Templates  (migration 000061)

Foundation: sequence steps reference templates, Settings counts them.

**Table `crm_templates`**
```
id uuid pk
organisation_id uuid not null            -- tenant isolation
channel text not null check (channel in ('sms','email'))
name text not null
subject text                             -- null for sms
body text not null                       -- {{var}} placeholders
is_archived boolean not null default false
created_at timestamptz default now()
created_by uuid
updated_at timestamptz default now()
```

- **Variable catalogue** (lib): `first_name, last_name, treatment, practice,
  appointment_date, address, review_link`. Helper `renderTemplate(body, lead, extra)`
  substitutes `{{var}}`; unknown vars left intact (or blanked — decide in plan, default: blank).
- API: `GET /api/crm/templates?channel=` , `POST`, `PATCH /:id`, `DELETE /:id`
  (delete = soft, set `is_archived`). Zod `templateCreateSchema`/`templateUpdateSchema`.
- Frontend: `features/crm/api/templates.ts` + `useTemplates()` hook; swap `TemplatesScreen`
  off the `TEMPLATES` fixture.

## Phase B2 — Settings  (migration 000062)

Config store the engine reads, plus an aggregator view.

**Table `crm_settings`** (one row per org)
```
organisation_id uuid pk
treatments jsonb not null default '[]'    -- [{name, default_value_pence}]
sources text[] not null default '{}'
payment_plans text[] not null default '{}'
gdpr_default_basis text not null default 'legitimate_interest'
quiet_hours_start time not null default '21:00'
quiet_hours_end   time not null default '08:00'
quiet_hours_tz text not null default 'Europe/London'
marketing_default_consent boolean not null default false
updated_at timestamptz default now()
updated_by uuid
```

- API: `GET /api/crm/settings` (returns settings **+ aggregator counts**:
  `template_count`, `active_sequence_count`, `treatment_count`, `source_count`,
  read from the other CRM tables), `PUT /api/crm/settings` (upsert).
- Seed defaults on first read if no row (treatments/sources/payment-plans from the
  mock constants as initial values).
- Frontend: `features/crm/api/settings.ts` + `useCrmSettings()`; swap `SettingsScreen`.

## Phase B3 — Sequences (full live engine)  (migration 000063)

The heaviest phase: a stateful drip engine that dispatches **real** SMS/email.

**Tables**
```
crm_sequences:
  id uuid pk, organisation_id uuid not null,
  name text not null, trigger_status text not null,
  goal_status text,                      -- auto-stop when lead reaches it
  is_active boolean not null default false,   -- live sends OFF until owner enables
  created_at timestamptz default now(), created_by uuid

crm_sequence_steps:
  id uuid pk, sequence_id uuid not null fk,
  step_order int not null, delay_minutes int not null,   -- signed; neg = before appt
  channel text not null check (channel in ('sms','email','call')),
  template_id uuid fk crm_templates (null for 'call'),
  created_at timestamptz default now()

crm_sequence_enrolments:
  id uuid pk, organisation_id uuid not null,
  sequence_id uuid not null fk, lead_id uuid not null fk,
  current_step int not null default 0,
  next_run_at timestamptz,
  status text not null default 'active' check (status in ('active','completed','stopped')),
  stop_reason text, enrolled_at timestamptz default now()
  -- partial unique index: (sequence_id, lead_id) where status='active'
```

**Lead columns added** (GDPR):
```
leads.marketing_consent boolean not null default false
leads.opted_out_at timestamptz
```

**Engine**
```
ENROL  (service: enrolMatchingSequences(lead))
  called from BOTH the leads status-update path AND GHL nightly sync (both mutate lead.status)
  when lead.status enters an active sequence's trigger_status:
    guard: skip if !marketing_consent OR opted_out_at set OR already active-enrolled
    INSERT enrolment (current_step=0, next_run_at = now + step1.delay_minutes)

WORKER  (workers/index.js, node-cron every 5 min, serviceClient)
  scan enrolments WHERE status='active' AND next_run_at <= now
  per enrolment, before dispatch check ALL:
    - lead.opted_out_at IS null
    - lead.marketing_consent = true
    - lead.status != sequence.goal_status      -> else stop (stop_reason='goal_reached')
    - inside quiet-hours window? -> defer next_run_at to window-open, NO send (don't drop)
  render step template, dispatch messaging.sendSMS/sendEmail({orgId, ...})  (per-org sender)
  ('call' channel = task only, no send)
  log to provider_events (existing); advance current_step + next_run_at to next step delay
  last step -> status='completed'

STOP   inbound STOP keyword (Twilio inbound webhook, new in B3)
  -> set leads.opted_out_at, stop all active enrolments for that lead (stop_reason='opted_out')
```

**Stats** (sequence list): `enrolled` = active enrolments, `completed` = completed
enrolments — computed from `crm_sequence_enrolments`, no stored counters.

**Safety:** `is_active` defaults **false** — a new sequence does not send until an Owner
flips it live. Consent default comes from `crm_settings.marketing_default_consent` (false).

- API: `GET /api/crm/sequences` (with steps + stats), `POST`, `PATCH /:id`
  (incl. `is_active` toggle — Owner only), `DELETE /:id`; step sub-CRUD or nested write.
  Inbound webhook `POST /webhooks/twilio/inbound` (public, signature-verified).
- Frontend: `features/crm/api/sequences.ts` + `useSequences()`; swap `SequencesScreen`;
  surface a marketing-consent control on the lead detail (consent capture).

## Out of scope

- **Landing Pages** (builder/hosting/form-capture) — dropped from this sub-project.
- **Workflows/Automations** — already has a backend; untouched.
- Custom domains, per-step A/B testing, multi-language templates.

## Risks / watch-items

- **Real sends**: B3 dispatches to real patients and costs money. Mitigations: `is_active`
  default-false, explicit consent gate, opt-out/STOP suppression, quiet-hours defer,
  per-org sender (org's own Twilio/Postmark when connected).
- **Quiet-hours TZ**: compute window in `quiet_hours_tz` (Europe/London), not UTC, to
  avoid texting patients overnight after BST shifts.
- **Enrol idempotency**: partial-unique active enrolment prevents double-enrol on repeated
  status writes / re-sync.
- **Worker overlap**: guard the 5-min tick against long runs (claim rows / skip if prior tick running).
