# Notification Service — Design

**Date:** 2026-06-06
**Status:** Approved, pending implementation plan
**Author:** ruhithpasha + Claude

## Goal

A full notification system for **app users (staff/owners) and platform superadmins**, delivered in-app, by email (AWS SES), and by SMS (AWS SNS). All outbound mail/SMS goes through a **single verified platform domain** in our own AWS account. Production-grade: bounce/complaint handling with a suppression list, retryable delivery via an outbox worker, and an in-app notification inbox in the frontend.

Out of scope for the *notification* lane: patient/contact marketing comms. Those already exist (`comm.service`, workflow runner). They benefit indirectly because the SES/SNS provider swap (§3) makes their underlying `messaging.js` facade send for real, but no new patient-facing features are added here.

## Decisions (locked during brainstorming)

- **Scope:** full system + in-app inbox (not just a provider swap).
- **Send identity:** single platform domain (e.g. `notifications@elevate.app` / `mail.elevate.app`). Per-tenant SES routing in the existing facade is kept but unused unless an org has its own config.
- **Recipients:** app users (staff/owners) and platform admins. Not patients.
- **Channels:** in-app + email + SMS, with per-user preferences (mute by category × channel).
- **Bounce handling:** yes, full — SES → SNS topic → webhook → log to `provider_events` + global suppression list.
- **Dispatch architecture:** **Outbox worker (Approach B).** In-app row written synchronously (inbox feels instant); email/SMS enqueued and drained by the existing `node-cron` worker with retries + backoff.

### Default choices (flagged, not separately confirmed)

- Seeded categories: `account`, `team`, `integration`, `digest`, `system`.
- SMS defaults **off** for every category except `integration` (the urgent one). In-app and email default **on**.
- Postmark/Twilio libs are **kept as env-gated emergency fallback**, not deleted.

## Architecture

```
trigger (auth.service, workers, etc.)
        │  notify({ orgId, userIds, category, title, body, link, channels? })
        ▼
notification.service.notify()
   ├─ INSERT notifications rows                (in-app, synchronous → bell updates now)
   └─ for each user × channel(email|sms):
        read notification_preferences + suppression_list
        if allowed & not suppressed → INSERT notification_deliveries (status=pending)
        ▼
node-cron worker (every minute)  ── drains notification_deliveries where status=pending AND next_attempt_at<=now
   ├─ email → lib/aws-ses.sendEmail()  → SES MessageId
   ├─ sms   → lib/aws-sns.sendSMS()    → SNS MessageId
   ├─ success → status=sent, external_id, log provider_events('sent')
   └─ fail    → attempts++, exponential backoff next_attempt_at; status=failed after 5 tries; log provider_events('failed')

SES delivery events ── configuration-set event destination ──▶ SNS topic ──▶ POST /webhooks/ses-events
   ├─ SubscriptionConfirmation → auto-confirm
   └─ Notification: bounce(hard)/complaint → upsert suppression_list + log provider_events
                    delivery                → log provider_events
```

## Data model — new migration `supabase/migrations/20260101000050_notifications.sql`

Idempotent (`CREATE TABLE IF NOT EXISTS`, etc.), re-applies cleanly. After hosted apply: `NOTIFY pgrst, 'reload schema';`.

```sql
-- In-app inbox. One row per (recipient, event). organisation_id nullable so
-- platform-admin notifications (no tenant) fit the same table.
CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,            -- public.users.id OR platform_admins.id
  is_platform     boolean NOT NULL DEFAULT false,
  category        text NOT NULL,            -- account|team|integration|digest|system
  title           text NOT NULL,
  body            text,
  link_url        text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, read_at, created_at DESC);

-- Per-user channel mutes. Absent row => category defaults apply.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id   uuid NOT NULL,
  category  text NOT NULL,
  in_app    boolean NOT NULL DEFAULT true,
  email     boolean NOT NULL DEFAULT true,
  sms       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, category)
);

-- Outbox queue for email/sms only (in-app needs no queue — the row above IS it).
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text NOT NULL,            -- email|sms
  to_address      text NOT NULL,
  status          text NOT NULL DEFAULT 'pending', -- pending|sent|failed|suppressed
  attempts        int  NOT NULL DEFAULT 0,
  last_error      text,
  external_id     text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_drain
  ON notification_deliveries(status, next_attempt_at);

-- Global hard-bounce / complaint suppression. Checked before enqueueing email.
CREATE TABLE IF NOT EXISTS suppression_list (
  address    text PRIMARY KEY,
  reason     text NOT NULL,                 -- bounce|complaint
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`provider_events` and `org_email_aliases` already exist (migration `…000008`) — reused, not recreated. Also keep `db/01_schema.sql` source copy in sync per CLAUDE.md.

**RLS note:** repos follow the existing `serviceClient` + manual `organisation_id` filter convention. Notification reads are filtered by `user_id = req.user.id` (and `organisation_id` for tenant users) in the repository — there is no automatic isolation on the service-client path.

## Backend

Native ESM, strict layering (`routes → controllers → services → repositories → models`). Money rules N/A here.

### AWS provider libs
- `lib/aws-ses.js` — `SESv2Client`; `sendEmail({ to, subject, html, from })` → MessageId. `from` defaults to `process.env.SES_FROM`. Uses `process.env.SES_CONFIGURATION_SET` so delivery events flow to SNS.
- `lib/aws-sns.js` — `SNSClient`; `sendSMS({ to, body })` → MessageId.
- New deps: `@aws-sdk/client-sesv2`, `@aws-sdk/client-sns`. Credentials reuse the existing AWS account used for S3 (`@aws-sdk/client-s3` already present).

### Notification domain
- `models/notification.model.js` — Zod: `NotificationListQuerySchema`, `PreferencesUpdateSchema`, and an internal `NotifyInputSchema`.
- `repositories/notification.repository.js` — inbox list, unread count, mark read / read-all, prefs get/upsert, delivery enqueue, suppression lookup, drain query. Queries in, rows out.
- `services/notification.service.js` — `notify({ orgId, userId|userIds, category, title, body, link, channels? })`: insert in-app rows synchronously; resolve each recipient's address + prefs + suppression; enqueue `notification_deliveries` for allowed, non-suppressed channels. Also `markRead`, `readAll`, `getPreferences`, `updatePreferences`, `listInbox`, `unreadCount`.
- `controllers/notification.controller.js` — parse with Zod, call service, shape HTTP.
- `routes/notification.routes.js` — `export default router`, wired in `app.js` under `/api`.

### Tenant API (under `/api`, behind `authenticate` + `audit`)
- `GET  /api/notifications?unread=true|false`
- `GET  /api/notifications/unread-count`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET  /api/notifications/preferences`
- `PUT  /api/notifications/preferences`

Mutations audited by existing `audit` middleware. Document all endpoints in `docs/API.md`.

### Worker (extend `workers/index.js`)
New `node-cron` job, every minute: select `notification_deliveries` where `status='pending' AND next_attempt_at <= now()` limit 50; dispatch via `aws-ses`/`aws-sns`; on success set `sent` + `external_id` + `sent_at`, log `provider_events('sent')`; on failure `attempts++`, set `next_attempt_at = now() + backoff(attempts)` (e.g. 1m,5m,30m,2h,12h), mark `failed` after 5 attempts, log `provider_events('failed')`. Uses `serviceClient`. Runs in the worker process (do not also run in `ghl-sync-once`).

## SES/SNS provider swap (§3)

`lib/messaging.js`: the platform fallback path switches Postmark→`aws-ses` and Twilio→`aws-sns`. The per-tenant SES/SNS branch (`getActive`) is kept but is a no-op unless an org has its own integration config (single-platform-domain decision). Postmark/Twilio libs retained, env-gated (`USE_LEGACY_EMAIL`/`USE_LEGACY_SMS` or absence of AWS env) as emergency fallback — not deleted. Effect: existing `comm.service.send` and the workflow runner's patient email/SMS now send for real via SES/SNS with no call-site changes.

## Bounce/complaint webhook (§4)

- `POST /webhooks/ses-events`, mounted in `app.js` **before** the global JSON parser (raw body), alongside the Stripe/Dentally raw mounts.
- Verifies the SNS message signature: fetch cert from `SigningCertURL` (host allowlisted to `*.amazonaws.com` / `sns.<region>.amazonaws.com`), verify per AWS SNS signature spec. Reject on mismatch.
- `Type: SubscriptionConfirmation` → GET the `SubscribeURL` to auto-confirm.
- `Type: Notification`:
  - hard `bounce` or `complaint` → upsert `suppression_list(address, reason)` + log `provider_events`.
  - `delivery` → log `provider_events('delivered')`.
- Public route (no tenant auth); security is the SNS signature check + topic-ARN allowlist.

## Trigger wiring (§5) — real events now

- Owner signup **approved**/**rejected** (platform approve path) → `notify` the owner (`account`).
- Member **invited** (`auth.service.invite`/`provisionMember`) → `notify` the invitee (`team`).
- New self-signup **pending** → `notify` platform admins (`account`, `is_platform=true`).
- Integration **sync failure** (GHL/Dentally workers catch blocks) → `notify` org owners (`integration`; SMS-eligible).
- **Weekly digest** (existing cron) → route through `notify()` so it also lands in-app (`digest`).

## Frontend (§6)

Next.js 14 App Router, React Query, Tailwind, British English, light-only, no emojis. Same-origin via existing `app/api/backend/[...path]` proxy.

- `TopBar` (`components/layout/topbar.tsx`): add a bell + unread badge between org name and avatar. Poll `GET /api/notifications/unread-count` via React Query (60s). Click → dropdown panel of recent notifications; clicking an item marks read (and follows `link_url`); "See all" → full screen.
- `features/notifications/`:
  - `NotificationsScreen` — full inbox list, mark-all-read, unread filter.
  - `NotificationPreferencesScreen` — category × channel toggle grid (in_app/email/sms), `PUT /preferences`.
  - `data.ts`/hooks for the React Query calls.
- New dashboard route(s) under `app/(dashboard)/notifications/`.

## Env / infra (§7) — documented in `docs/DEPLOYMENT.md`

- Env: `AWS_REGION`, `SES_FROM`, `SES_CONFIGURATION_SET`, `SNS_*` (SMS sender id/type), AWS creds (reuse S3 account if same).
- AWS console (manual, one-time): verify domain + DKIM in SES; create SNS topic; add SES configuration-set event destination → SNS topic; subscribe `https://<app>/webhooks/ses-events` to the topic; request SES production access (exit sandbox). The SubscriptionConfirmation handler auto-confirms the subscription.

## Testing (§8) — vitest, `backend/test`

- `notify()` — in-app insert; fan-out to email/sms per prefs; suppressed address skipped (delivery row `suppressed`, not enqueued); platform-admin path (`is_platform`, null org).
- Worker drain — success marks `sent`+external_id+provider_events; transient failure increments attempts + sets backoff; gives up at 5 → `failed`.
- SNS webhook — signature verify pass/fail; `SubscriptionConfirmation` auto-confirm; bounce/complaint → suppression upsert; delivery → provider_events.
- Controller — auth required; a user only sees their own notifications (cross-user/cross-org isolation).

## Risks / notes

- **SES sandbox**: until production access is granted, SES only sends to verified addresses — sends will fail in prod otherwise. Flagged in deploy docs; the outbox ret/backoff prevents data loss meanwhile, but addresses still won't deliver until approved.
- **SNS signature verification** must be correct or the webhook is spoofable — covered by tests.
- **PostgREST cache**: run `NOTIFY pgrst, 'reload schema';` after applying the migration on hosted.
- Keep `db/01_schema.sql` source copy in sync with the new migration (CLAUDE.md rule).
