# GoHighLevel → Dentally-parity integration

**Branch:** `worktree-feat-ghl-integration` (isolated worktree, branched from local HEAD).
**Date:** 2026-06-01. **Goal:** bring the existing GHL integration up to Dentally's depth.

## Collision strategy (parallel sessions: business-health, /staff)
- **Zero new migrations.** Every feature here stores state in columns that already
  exist (migration `000013`): webhook secret + stage mappings live in
  `integrations.config` (JSONB); contacts/leads already carry
  `ghl_contact_id`/`ghl_opportunity_id`/`ghl_pipeline_id`. So there is NO
  `000032` and no contention with the business-health (`000030`/`000031`) or
  `/staff` (`000030`) migration reservations.
- Shared-file edits are append-only and in different line regions than the other
  domains: `app.js` (one `express.raw` mount line), `webhooks.routes.js` (one
  route), `SyncOverlay.tsx` (phase labels), `webhook.{service,controller}.js`
  (one handler each). All auto-mergeable.
- Does NOT touch `db/01_schema.sql`, `health-business.routes.js`, analytics/health
  services, or the health/overview frontend — the business-health session's surface.

## Already shipped (prior sessions)
GHL OAuth provider, single-page opportunity→lead sync, hourly cron, connect UI,
153→279 backend tests. See `highleveltodo.md`.

## Scope (all three — full parity)
1. **Real-time webhooks** — public `/webhooks/gohighlevel/:token`, raw body, HMAC
   (shared-secret model, mirrors Dentally; GHL native RSA sig is a noted follow-up),
   `applyWebhookEvent` for Contact + Opportunity create/update/delete, webhook panel UI.
2. **Bootstrap-on-connect + overlay** — paginated full-history pull of contacts +
   opportunities with multi-phase progress; "Pull Full History" button; SyncOverlay reuse.
3. **Stage-mapping UI** — `detectPipelines` + a settings panel mapping GHL pipeline
   stages → Elevate lead statuses (replaces the name heuristic when set).

## Layers touched
- `lib/integrations/gohighlevel-sync.js` — pagination, `pullContacts`, `upsertOpportunity`
  (shared poll+webhook), `applyWebhookEvent`, `bootstrapOnConnect`, `detectPipelines`,
  progress reporting (signature now `(orgId, row, onProgress, {full,recent})`).
- `services/webhook.service.js` + `controllers/webhook.controller.js` + `routes/webhooks.routes.js` + `app.js`.
- `services/integration.service.js` — add `gohighlevel` to WEBHOOK_PROVIDERS,
  `bootstrapGohighlevel`, `detectPipelines`, `setStageMappings`, wire `finishConnect`.
- `routes/integrations.routes.js` + `controllers/integration.controller.js` — `/:provider/pipelines`, `/:provider/stage-mappings`.
- Frontend: `SyncOverlay` (generalise), `api.ts`/`hooks.ts`, new `GoHighLevelStageMapping.tsx`
  + `GoHighLevelWebhookPanel.tsx`, `IntegrationsScreen` wiring.

## Tests (vitest, mirror existing style)
- extend `gohighlevel-sync.test.mjs`: `upsertOpportunity`, `mapWebhookEventType`,
  `applyWebhookEvent`, pagination.
- new `gohighlevel-webhook.test.mjs`: token + HMAC + parse + dispatch.
