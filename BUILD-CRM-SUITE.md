# BUILD — CRM Suite (context doc)

Working context for the CRM Suite phases. Pair with `phases-crm-suite.md` (status
table) and `docs/superpowers/specs/2026-06-09-crm-suite-design.md` (full design).

## What already exists (reuse, do NOT rebuild)
- **Leads**: `backend/src/routes/leads.routes.js` + services/repo; GHL sync. Lead `status`
  uses the Elevate journey enum (see `frontend/features/crm/data.ts` JOURNEY_STATUSES).
- **Messaging**: `backend/src/lib/messaging.js` — `sendEmail({orgId,...})` /
  `sendSMS({orgId,...})`. Per-org sender (org Postmark/Twilio from encrypted `integrations`,
  else platform SES/SNS/Twilio). Logs to `provider_events`. **Sequence dispatch uses this.**
- **Comms**: `comms.routes.js` (`GET /`, `POST /send`). **Workflows**: `workflows.routes.js`
  (CRUD + GHL) — distinct from Sequences, untouched.
- **Worker host**: `backend/src/workers/index.js` (node-cron, serviceClient) — add the
  sequence tick here.
- **Frontend contract**: `frontend/features/crm/data.ts`. Screens to swap:
  `TemplatesScreen.tsx`, `SettingsScreen.tsx`, `SequencesScreen.tsx`. Mock amounts =
  whole pounds → convert to pence.

## Per-phase integration map

### B1 Templates
- Migration `supabase/migrations/20260101000061_crm_templates.sql` → table `crm_templates`.
- Backend: `models/crmTemplate.model.js` (Zod), `repositories/crmTemplate.repository.js`,
  `services/crmTemplate.service.js`, `controllers/crmTemplate.controller.js`,
  `routes/crm-templates.routes.js` (mount `/api/crm/templates` in `app.js`).
- Lib: variable catalogue + `renderTemplate()` (new in `lib/crm-templates.js` or formulas-style helper).
- Frontend: `features/crm/api/templates.ts`, `useTemplates()` hook, swap `TemplatesScreen`.

### B2 Settings
- Migration `…000062_crm_settings.sql` → table `crm_settings` (one row/org).
- Backend: model/repo/service/controller + `routes/crm-settings.routes.js`
  (`/api/crm/settings` GET + PUT). GET returns settings + aggregator counts.
- Seed defaults from mock constants (TREATMENTS/SOURCES/PAYMENT_PLANS) on first read.
- Frontend: `features/crm/api/settings.ts`, `useCrmSettings()`, swap `SettingsScreen`.

### B3 Sequences (live engine)
- Migration `…000063_crm_sequences.sql` → `crm_sequences`, `crm_sequence_steps`,
  `crm_sequence_enrolments`; + `leads.marketing_consent`, `leads.opted_out_at`;
  partial unique active-enrolment index.
- Backend: models/repo/service/controller + `routes/crm-sequences.routes.js`
  (`/api/crm/sequences`). Engine service `services/crmSequenceEngine.service.js`:
  `enrolMatchingSequences(lead)` (call from leads status-update + GHL sync),
  `tickSequences()` (worker). Quiet-hours in `quiet_hours_tz`, NOT UTC.
- Inbound STOP: `POST /webhooks/twilio/inbound` (public, signature-verified) → set
  `opted_out_at`, stop active enrolments.
- Worker: register `tickSequences` in `workers/index.js` (every 5 min), overlap-guarded.
- Frontend: `features/crm/api/sequences.ts`, `useSequences()`, swap `SequencesScreen`;
  add marketing-consent capture on lead detail.

## RBAC
CRM = Reception-accessible (rule 5). Reception view/use; Owner/Practice Manager manage
(create/edit/delete). `is_active` live-toggle on sequences = **Owner only**.
Backend `requireRole`; frontend `ROUTE_PERMISSION`.

## Gotchas
- After hosted DDL: `NOTIFY pgrst, 'reload schema';`.
- Real sends → guard chain: `is_active` default false, consent gate, opt-out/STOP,
  quiet-hours defer (don't drop).
- Enrol idempotency via partial-unique active enrolment.
