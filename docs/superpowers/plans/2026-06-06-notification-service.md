# Notification Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-app + email (AWS SES) + SMS (AWS SNS) notification system for app users and platform admins, sent from a single verified platform domain, with a retryable outbox worker and SES bounce/complaint suppression.

**Architecture:** Approach B (outbox). `notify()` writes the in-app `notifications` row synchronously and enqueues per-channel `notification_deliveries` rows (respecting per-user prefs + suppression). The existing `node-cron` worker drains the queue via SES/SNS with exponential backoff. SES delivery events flow through an SNS topic to a public `/webhooks/ses-events` endpoint that records events and suppresses hard bounces/complaints.

**Tech Stack:** Node ESM, Express, Supabase (`serviceClient` + manual `organisation_id`/`user_id` filters), Zod, vitest; `@aws-sdk/client-sesv2` + `@aws-sdk/client-sns`; Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-06-notification-service-design.md`

**Conventions (follow exactly):**
- Native ESM: `import`/`export`, relative imports carry `.js`. Namespace imports keep original local var (`import * as x_1 from "../y.js"`). Route files `export default router`.
- Layering: `routes → controllers → services → repositories → models`. Repos = queries in, rows out. Controllers parse Zod + shape HTTP, no logic.
- Repos use `supabase_1.serviceClient` and ALWAYS chain explicit `.eq('organisation_id', ...)` / `.eq('user_id', ...)`.
- British English, light-only, no emojis, money N/A here.
- Commit after each task. Run `npm test` from `backend/`.

---

## File Structure

**Backend — create:**
- `supabase/migrations/20260101000050_notifications.sql` — 4 tables.
- `backend/src/lib/aws-ses.js` — SES send wrapper.
- `backend/src/lib/aws-sns.js` — SNS SMS + signature verify helper.
- `backend/src/models/notification.model.js` — Zod schemas.
- `backend/src/repositories/notification.repository.js` — data access.
- `backend/src/services/notification.service.js` — `notify()` + inbox ops.
- `backend/src/controllers/notification.controller.js`
- `backend/src/routes/notification.routes.js`
- `backend/src/controllers/ses-event.controller.js` — SNS webhook handler.
- `backend/test/notification.service.test.js`, `backend/test/notification.controller.test.js`, `backend/test/notification-worker.test.js`, `backend/test/ses-event.webhook.test.js`, `backend/test/messaging.test.js`.

**Backend — modify:**
- `backend/package.json` — deps.
- `backend/src/app.js` — raw mount + route wiring.
- `backend/src/routes/webhooks.routes.js` — ses-events route.
- `backend/src/workers/index.js` — drain loop + integration-failure notify.
- `backend/src/lib/messaging.js` — Postmark→SES, Twilio→SNS fallback.
- `backend/src/services/auth.service.js` — invite/signup triggers.
- `backend/src/services/platform-admin.service.js` (or wherever approve/reject lives) — approval triggers.
- `backend/db/01_schema.sql` — keep in sync with the migration.
- `docs/API.md`, `docs/DEPLOYMENT.md`.

**Frontend — create:**
- `frontend/features/notifications/data.ts` — React Query hooks + types.
- `frontend/features/notifications/components/NotificationBell.tsx`
- `frontend/features/notifications/components/NotificationsScreen.tsx`
- `frontend/features/notifications/components/NotificationPreferencesScreen.tsx`
- `frontend/app/(dashboard)/notifications/page.tsx`
- `frontend/app/(dashboard)/notifications/preferences/page.tsx`

**Frontend — modify:**
- `frontend/components/layout/topbar.tsx` — mount the bell.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260101000050_notifications.sql`
- Modify: `backend/db/01_schema.sql` (append same DDL, source-of-truth copy)

- [ ] **Step 1: Write the migration**

```sql
-- 20260101000050_notifications.sql
-- Notification system: in-app inbox, per-user prefs, outbox deliveries,
-- SES bounce/complaint suppression. Idempotent.

CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  is_platform     boolean NOT NULL DEFAULT false,
  category        text NOT NULL,
  title           text NOT NULL,
  body            text,
  link_url        text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id   uuid NOT NULL,
  category  text NOT NULL,
  in_app    boolean NOT NULL DEFAULT true,
  email     boolean NOT NULL DEFAULT true,
  sms       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text NOT NULL,
  to_address      text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        int  NOT NULL DEFAULT 0,
  last_error      text,
  external_id     text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_drain
  ON notification_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS suppression_list (
  address    text PRIMARY KEY,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Append the identical DDL to `backend/db/01_schema.sql`** (CLAUDE.md rule: source copy stays in sync). Paste the same four `CREATE TABLE`/`CREATE INDEX` blocks at the end of the file.

- [ ] **Step 3: Apply locally to verify it parses**

Run (repo root): `supabase db reset`
Expected: completes through `…000050` with no error. (If local Supabase is not running, skip and note that hosted apply happens at deploy via the Supabase MCP `apply_migration`, followed by `NOTIFY pgrst, 'reload schema';`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000050_notifications.sql backend/db/01_schema.sql
git commit -m "feat(notifications): add notification tables migration 000050"
```

---

## Task 2: AWS SES/SNS libs + deps

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/lib/aws-ses.js`, `backend/src/lib/aws-sns.js`

- [ ] **Step 1: Install AWS clients**

Run (in `backend/`): `npm install @aws-sdk/client-sesv2 @aws-sdk/client-sns`
Expected: both added to `dependencies`.

- [ ] **Step 2: Write `backend/src/lib/aws-ses.js`**

```javascript
// Email sending via AWS SES v2. Single platform sending identity.
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const client = new SESv2Client({ region: process.env.AWS_REGION || 'eu-west-2' });

export async function sendEmail(opts) {
    const cmd = new SendEmailCommand({
        FromEmailAddress: opts.from || process.env.SES_FROM || 'notifications@elevate.app',
        Destination: { ToAddresses: [opts.to] },
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
        Content: {
            Simple: {
                Subject: { Data: opts.subject || '' },
                Body: { Html: { Data: opts.html || opts.body || '' } },
            },
        },
    });
    const res = await client.send(cmd);
    return res.MessageId;
}
```

- [ ] **Step 3: Write `backend/src/lib/aws-sns.js`**

```javascript
// SMS sending via AWS SNS + SNS message signature verification for webhooks.
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import * as https_1 from "node:https";
import * as crypto_1 from "node:crypto";

const client = new SNSClient({ region: process.env.AWS_REGION || 'eu-west-2' });

export async function sendSMS(opts) {
    const attrs = {};
    if (process.env.SNS_SENDER_ID) {
        attrs['AWS.SNS.SMS.SenderID'] = { DataType: 'String', StringValue: process.env.SNS_SENDER_ID };
    }
    attrs['AWS.SNS.SMS.SMSType'] = { DataType: 'String', StringValue: process.env.SNS_SMS_TYPE || 'Transactional' };
    const res = await client.send(new PublishCommand({
        PhoneNumber: opts.to,
        Message: opts.body,
        MessageAttributes: attrs,
    }));
    return res.MessageId;
}

// Fields, in order, that SNS signs for each message Type.
const SIGN_FIELDS = {
    Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
    SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
    UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https_1.default.get(url, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// Verify an SNS message signature. Returns true/false. msg = parsed JSON body.
export async function verifySnsSignature(msg) {
    const certUrl = msg.SigningCertURL || msg.SigningCertUrl;
    if (!certUrl) return false;
    let host;
    try { host = new URL(certUrl).host; } catch { return false; }
    // Allowlist AWS SNS cert hosts only.
    if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) return false;
    const fields = SIGN_FIELDS[msg.Type];
    if (!fields) return false;
    const canonical = fields
        .filter((f) => msg[f] !== undefined)
        .map((f) => `${f}\n${msg[f]}\n`)
        .join('');
    const pem = await fetchText(certUrl);
    const verifier = crypto_1.default.createVerify('RSA-SHA1');
    verifier.update(canonical, 'utf8');
    try {
        return verifier.verify(pem, msg.Signature, 'base64');
    } catch {
        return false;
    }
}

export async function confirmSubscription(subscribeUrl) {
    await fetchText(subscribeUrl);
}
```

> Note: `import * as https_1 from "node:https"` then `https_1.default.get` matches the converted-ESM convention used elsewhere (e.g. `twilio_1.default`). Same for `crypto_1.default`.

- [ ] **Step 4: Syntax check**

Run (in `backend/`): `node --check src/lib/aws-ses.js && node --check src/lib/aws-sns.js`
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/lib/aws-ses.js backend/src/lib/aws-sns.js
git commit -m "feat(notifications): add AWS SES/SNS client libs + SNS signature verify"
```

---

## Task 3: Notification Zod model

**Files:**
- Create: `backend/src/models/notification.model.js`

- [ ] **Step 1: Write the model**

```javascript
// ============================================================================
// Notification model — Zod schemas for the notifications domain.
// ============================================================================
import * as zod_1 from "zod";

export const NOTIFICATION_CATEGORIES = ['account', 'team', 'integration', 'digest', 'system'];

export const notificationListQuerySchema = zod_1.z.object({
    unread: zod_1.z.coerce.boolean().optional(),
    limit: zod_1.z.coerce.number().min(1).max(100).default(50),
});

// One category row in the preferences PUT payload.
const prefRowSchema = zod_1.z.object({
    category: zod_1.z.enum(['account', 'team', 'integration', 'digest', 'system']),
    in_app: zod_1.z.boolean(),
    email: zod_1.z.boolean(),
    sms: zod_1.z.boolean(),
});

export const preferencesUpdateSchema = zod_1.z.object({
    preferences: zod_1.z.array(prefRowSchema).min(1),
});

// Internal — validates inputs to notify(). Not bound to an HTTP route.
export const notifyInputSchema = zod_1.z.object({
    orgId: zod_1.z.string().uuid().nullable().optional(),
    userIds: zod_1.z.array(zod_1.z.string().uuid()).min(1),
    isPlatform: zod_1.z.boolean().default(false),
    category: zod_1.z.enum(['account', 'team', 'integration', 'digest', 'system']),
    title: zod_1.z.string().min(1),
    body: zod_1.z.string().optional(),
    link: zod_1.z.string().optional(),
});
```

- [ ] **Step 2: Syntax check**

Run: `node --check backend/src/models/notification.model.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/notification.model.js
git commit -m "feat(notifications): add notification Zod model"
```

---

## Task 4: Notification repository

**Files:**
- Create: `backend/src/repositories/notification.repository.js`

- [ ] **Step 1: Write the repository**

```javascript
// ============================================================================
// Notification repository — Supabase data access. Queries in, rows out.
// Isolation enforced by explicit user_id (+ organisation_id) filters; never
// returns another user's notifications.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const notificationRepository = {
    async insertNotifications(rows) {
        const { data, error } = await supabase_1.serviceClient
            .from('notifications').insert(rows).select();
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async listForUser(userId, { unread, limit }) {
        let q = supabase_1.serviceClient
            .from('notifications')
            .select('id, organisation_id, category, title, body, link_url, read_at, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (unread === true) q = q.is('read_at', null);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async unreadCount(userId) {
        const { count, error } = await supabase_1.serviceClient
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .is('read_at', null);
        if (error) throw new Error(error.message);
        return count ?? 0;
    },

    async markRead(userId, id, when) {
        const { error } = await supabase_1.serviceClient
            .from('notifications')
            .update({ read_at: when })
            .eq('user_id', userId)
            .eq('id', id);
        if (error) throw new Error(error.message);
    },

    async markAllRead(userId, when) {
        const { error } = await supabase_1.serviceClient
            .from('notifications')
            .update({ read_at: when })
            .eq('user_id', userId)
            .is('read_at', null);
        if (error) throw new Error(error.message);
    },

    async getPreferences(userId) {
        const { data, error } = await supabase_1.serviceClient
            .from('notification_preferences')
            .select('category, in_app, email, sms')
            .eq('user_id', userId);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async upsertPreferences(rows) {
        const { error } = await supabase_1.serviceClient
            .from('notification_preferences')
            .upsert(rows, { onConflict: 'user_id,category' });
        if (error) throw new Error(error.message);
    },

    async enqueueDeliveries(rows) {
        if (!rows.length) return;
        const { error } = await supabase_1.serviceClient
            .from('notification_deliveries').insert(rows);
        if (error) throw new Error(error.message);
    },

    async suppressedAddresses(addresses) {
        if (!addresses.length) return new Set();
        const { data, error } = await supabase_1.serviceClient
            .from('suppression_list')
            .select('address')
            .in('address', addresses);
        if (error) throw new Error(error.message);
        return new Set((data ?? []).map((r) => r.address));
    },

    async upsertSuppression(address, reason, when) {
        const { error } = await supabase_1.serviceClient
            .from('suppression_list')
            .upsert({ address, reason, created_at: when }, { onConflict: 'address' });
        if (error) throw new Error(error.message);
    },

    async claimPendingDeliveries(limit, nowIso) {
        const { data, error } = await supabase_1.serviceClient
            .from('notification_deliveries')
            .select('id, channel, to_address, attempts')
            .eq('status', 'pending')
            .lte('next_attempt_at', nowIso)
            .limit(limit);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async markDeliverySent(id, externalId, when) {
        await supabase_1.serviceClient.from('notification_deliveries')
            .update({ status: 'sent', external_id: externalId, sent_at: when })
            .eq('id', id);
    },

    async markDeliveryRetry(id, attempts, lastError, nextAttemptIso, failed) {
        await supabase_1.serviceClient.from('notification_deliveries')
            .update({
                status: failed ? 'failed' : 'pending',
                attempts,
                last_error: lastError,
                next_attempt_at: nextAttemptIso,
            })
            .eq('id', id);
    },
};
```

- [ ] **Step 2: Syntax check**

Run: `node --check backend/src/repositories/notification.repository.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/src/repositories/notification.repository.js
git commit -m "feat(notifications): add notification repository"
```

---

## Task 5: Notification service + tests

**Files:**
- Create: `backend/src/services/notification.service.js`
- Test: `backend/test/notification.service.test.js`

The service owns: address/pref resolution, fan-out, and inbox ops. Category channel defaults (when a user has no `notification_preferences` row): `in_app=true, email=true, sms=(category==='integration')`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/notification.service.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository so we assert service behaviour, not SQL.
vi.mock('../src/repositories/notification.repository.js', () => ({
    notificationRepository: {
        insertNotifications: vi.fn(async (rows) => rows.map((r, i) => ({ ...r, id: `n${i}` }))),
        getPreferences: vi.fn(async () => []),
        suppressedAddresses: vi.fn(async () => new Set()),
        enqueueDeliveries: vi.fn(async () => {}),
    },
}));

import { notificationService } from '../src/services/notification.service.js';
import { notificationRepository as repo } from '../src/repositories/notification.repository.js';

beforeEach(() => vi.clearAllMocks());

describe('notify()', () => {
    it('inserts one in-app notification per user and enqueues email by default', async () => {
        await notificationService.notify({
            orgId: 'org-1',
            userIds: ['u1'],
            category: 'account',
            title: 'Approved',
            recipients: { u1: { email: 'a@b.com', phone: null } },
        });
        expect(repo.insertNotifications).toHaveBeenCalledOnce();
        const enq = repo.enqueueDeliveries.mock.calls[0][0];
        expect(enq).toEqual([
            expect.objectContaining({ channel: 'email', to_address: 'a@b.com' }),
        ]);
    });

    it('skips email when a suppressed address, and skips sms when pref off (default account)', async () => {
        repo.suppressedAddresses.mockResolvedValueOnce(new Set(['a@b.com']));
        await notificationService.notify({
            orgId: 'org-1',
            userIds: ['u1'],
            category: 'account',
            title: 'Hi',
            recipients: { u1: { email: 'a@b.com', phone: '+447700900000' } },
        });
        expect(repo.enqueueDeliveries).toHaveBeenCalledWith([]); // email suppressed, sms off for 'account'
    });

    it('enqueues sms by default for the integration category', async () => {
        await notificationService.notify({
            orgId: 'org-1',
            userIds: ['u1'],
            category: 'integration',
            title: 'Sync failed',
            recipients: { u1: { email: 'a@b.com', phone: '+447700900000' } },
        });
        const enq = repo.enqueueDeliveries.mock.calls[0][0];
        expect(enq.map((d) => d.channel).sort()).toEqual(['email', 'sms']);
    });

    it('honours a stored pref that mutes email', async () => {
        repo.getPreferences.mockResolvedValueOnce([{ category: 'account', in_app: true, email: false, sms: false }]);
        await notificationService.notify({
            orgId: 'org-1', userIds: ['u1'], category: 'account', title: 'x',
            recipients: { u1: { email: 'a@b.com', phone: null } },
        });
        expect(repo.enqueueDeliveries).toHaveBeenCalledWith([]);
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd backend && npx vitest run test/notification.service.test.js`
Expected: FAIL — cannot import `notificationService` (module not found).

- [ ] **Step 3: Write the service**

```javascript
// ============================================================================
// Notification service — in-app insert (synchronous) + outbox fan-out.
// notify() accepts a recipients map { userId: { email, phone } }. Callers that
// only have ids should resolve addresses first (helper resolveRecipients()).
// ============================================================================
import { notificationRepository } from "../repositories/notification.repository.js";
import * as supabase_1 from "../lib/supabase.js";

// Channel defaults when the user has no stored preference for a category.
function defaultPref(category) {
    return { in_app: true, email: true, sms: category === 'integration' };
}

export const notificationService = {
    // Resolve { userId: {email, phone} } for tenant users from public.users.
    async resolveRecipients(userIds) {
        const { data } = await supabase_1.serviceClient
            .from('users').select('id, email, phone').in('id', userIds);
        const map = {};
        for (const u of data ?? []) map[u.id] = { email: u.email, phone: u.phone ?? null };
        return map;
    },

    async notify({ orgId = null, userIds, isPlatform = false, category, title, body = null, link = null, recipients }) {
        if (!userIds?.length) return;
        const addrMap = recipients || (await this.resolveRecipients(userIds));

        // 1. In-app rows (synchronous).
        const notifRows = userIds.map((uid) => ({
            organisation_id: orgId,
            user_id: uid,
            is_platform: isPlatform,
            category,
            title,
            body,
            link_url: link,
        }));
        const inserted = await notificationRepository.insertNotifications(notifRows);
        const idByUser = {};
        inserted.forEach((row) => { idByUser[row.user_id] = row.id; });

        // 2. Resolve prefs + suppression, then enqueue email/sms deliveries.
        const allEmails = userIds.map((u) => addrMap[u]?.email).filter(Boolean);
        const suppressed = await notificationRepository.suppressedAddresses(allEmails);

        const deliveries = [];
        for (const uid of userIds) {
            const prefs = await notificationRepository.getPreferences(uid);
            const pref = prefs.find((p) => p.category === category) || defaultPref(category);
            const addr = addrMap[uid] || {};
            const notifId = idByUser[uid];
            if (!notifId) continue;
            if (pref.email && addr.email && !suppressed.has(addr.email)) {
                deliveries.push({ notification_id: notifId, channel: 'email', to_address: addr.email });
            }
            if (pref.sms && addr.phone) {
                deliveries.push({ notification_id: notifId, channel: 'sms', to_address: addr.phone });
            }
        }
        await notificationRepository.enqueueDeliveries(deliveries);
        return inserted;
    },

    listInbox(userId, q) {
        return notificationRepository.listForUser(userId, q);
    },
    unreadCount(userId) {
        return notificationRepository.unreadCount(userId);
    },
    markRead(userId, id) {
        return notificationRepository.markRead(userId, id, new Date().toISOString());
    },
    markAllRead(userId) {
        return notificationRepository.markAllRead(userId, new Date().toISOString());
    },
    getPreferences(userId) {
        return notificationRepository.getPreferences(userId);
    },
    updatePreferences(userId, preferences) {
        const rows = preferences.map((p) => ({ user_id: userId, ...p }));
        return notificationRepository.upsertPreferences(rows);
    },
};
```

> The test passes `recipients` directly, so `getPreferences` is consulted per user. The default for `account` has `sms:false`, so test 2 (suppressed email + no sms) yields `[]`. Good.

- [ ] **Step 4: Run test, verify it passes**

Run: `cd backend && npx vitest run test/notification.service.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/notification.service.js backend/test/notification.service.test.js
git commit -m "feat(notifications): notification service with fan-out + tests"
```

---

## Task 6: Controller, routes, app wiring + tests

**Files:**
- Create: `backend/src/controllers/notification.controller.js`, `backend/src/routes/notification.routes.js`
- Modify: `backend/src/app.js`
- Test: `backend/test/notification.controller.test.js`

- [ ] **Step 1: Write the controller**

```javascript
// ============================================================================
// Notification controller — parse Zod, call service, shape HTTP. No logic.
// ============================================================================
import { notificationService } from "../services/notification.service.js";
import * as notification_model_1 from "../models/notification.model.js";
import { idParamSchema } from "../models/common.model.js";

export const notificationController = {
    async list(req, res) {
        const q = notification_model_1.notificationListQuerySchema.parse(req.query);
        const rows = await notificationService.listInbox(req.user.id, q);
        res.json({ notifications: rows });
    },
    async unreadCount(req, res) {
        const count = await notificationService.unreadCount(req.user.id);
        res.json({ count });
    },
    async markRead(req, res) {
        const { id } = idParamSchema.parse(req.params);
        await notificationService.markRead(req.user.id, id);
        res.json({ ok: true });
    },
    async markAllRead(req, res) {
        await notificationService.markAllRead(req.user.id);
        res.json({ ok: true });
    },
    async getPreferences(req, res) {
        const rows = await notificationService.getPreferences(req.user.id);
        res.json({ preferences: rows });
    },
    async updatePreferences(req, res) {
        const { preferences } = notification_model_1.preferencesUpdateSchema.parse(req.body);
        await notificationService.updatePreferences(req.user.id, preferences);
        res.json({ ok: true });
    },
};
```

> Verify `backend/src/models/common.model.js` exports `idParamSchema` (it is imported the same way by `contact.controller.js`). If the param is named differently, match that import.

- [ ] **Step 2: Write the routes**

```javascript
// ============================================================================
// Notification routes — Express Router. Mounted at /api/notifications.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as notification_controller_1 from "../controllers/notification.controller.js";
const router = (0, express_1.Router)();
const h = async_handler_1.asyncHandler;
const c = notification_controller_1.notificationController;
router.get('/', h(c.list));
router.get('/unread-count', h(c.unreadCount));
router.get('/preferences', h(c.getPreferences));
router.put('/preferences', h(c.updatePreferences));
router.post('/read-all', h(c.markAllRead));
router.post('/:id/read', h(c.markRead));
export default router;
```

> Order matters: `/preferences` and `/unread-count` and `/read-all` are declared before `/:id/read` so the param route does not shadow them.

- [ ] **Step 3: Wire into `app.js`**

Add the import alongside the other route imports (near line 33 group):
```javascript
import notification_routes_1 from "./routes/notification.routes.js";
```
Add the mount in the `api.use(...)` block (after `api.use('/comms', ...)`):
```javascript
    api.use('/notifications', notification_routes_1);
```

- [ ] **Step 4: Write the failing test**

```javascript
// backend/test/notification.controller.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/notification.service.js', () => ({
    notificationService: {
        listInbox: vi.fn(async () => [{ id: 'n1', title: 'Hi' }]),
        unreadCount: vi.fn(async () => 3),
        markRead: vi.fn(async () => {}),
        markAllRead: vi.fn(async () => {}),
        getPreferences: vi.fn(async () => []),
        updatePreferences: vi.fn(async () => {}),
    },
}));

import { notificationController } from '../src/controllers/notification.controller.js';
import { notificationService } from '../src/services/notification.service.js';

function mockRes() {
    return { body: null, json(b) { this.body = b; return this; } };
}
beforeEach(() => vi.clearAllMocks());

describe('notificationController', () => {
    it('list scopes to the authenticated user id', async () => {
        const res = mockRes();
        await notificationController.list({ user: { id: 'u1' }, query: {} }, res);
        expect(notificationService.listInbox).toHaveBeenCalledWith('u1', expect.any(Object));
        expect(res.body).toEqual({ notifications: [{ id: 'n1', title: 'Hi' }] });
    });

    it('unreadCount returns the count for the user', async () => {
        const res = mockRes();
        await notificationController.unreadCount({ user: { id: 'u1' } }, res);
        expect(res.body).toEqual({ count: 3 });
    });

    it('updatePreferences validates the payload and passes user id', async () => {
        const res = mockRes();
        const body = { preferences: [{ category: 'account', in_app: true, email: false, sms: false }] };
        await notificationController.updatePreferences({ user: { id: 'u1' }, body }, res);
        expect(notificationService.updatePreferences).toHaveBeenCalledWith('u1', body.preferences);
        expect(res.body).toEqual({ ok: true });
    });

    it('updatePreferences rejects an unknown category', async () => {
        const res = mockRes();
        const body = { preferences: [{ category: 'nope', in_app: true, email: true, sms: true }] };
        await expect(
            notificationController.updatePreferences({ user: { id: 'u1' }, body }, res),
        ).rejects.toThrow();
    });
});
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npx vitest run test/notification.controller.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Syntax-check the route + app wiring**

Run: `cd backend && node --check src/routes/notification.routes.js && node --check src/app.js`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/notification.controller.js backend/src/routes/notification.routes.js backend/src/app.js backend/test/notification.controller.test.js
git commit -m "feat(notifications): controller + routes + app wiring + tests"
```

---

## Task 7: Outbox drain worker + tests

The drain logic must be unit-testable without cron. Put it in the service as `drainOnce({ ses, sns, now })` (dependency-injected senders + clock), then call it from a `node-cron` job in `workers/index.js`.

**Files:**
- Modify: `backend/src/services/notification.service.js` (add `drainOnce`)
- Modify: `backend/src/workers/index.js` (cron job)
- Test: `backend/test/notification-worker.test.js`

Backoff schedule by attempt number (1-indexed): `[60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]` ms (1m, 5m, 30m, 2h, 12h). Give up (`failed`) after 5 attempts.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/notification-worker.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/notification.repository.js', () => ({
    notificationRepository: {
        claimPendingDeliveries: vi.fn(),
        markDeliverySent: vi.fn(async () => {}),
        markDeliveryRetry: vi.fn(async () => {}),
    },
}));
vi.mock('../src/lib/messaging.js', () => ({}));

import { notificationService } from '../src/services/notification.service.js';
import { notificationRepository as repo } from '../src/repositories/notification.repository.js';

beforeEach(() => vi.clearAllMocks());
const NOW = new Date('2026-06-06T12:00:00.000Z');

describe('drainOnce', () => {
    it('sends an email delivery via the injected SES sender and marks it sent', async () => {
        repo.claimPendingDeliveries.mockResolvedValueOnce([
            { id: 'd1', channel: 'email', to_address: 'a@b.com', attempts: 0 },
        ]);
        const ses = { sendEmail: vi.fn(async () => 'ses-123') };
        const sns = { sendSMS: vi.fn() };
        await notificationService.drainOnce({ ses, sns, now: NOW });
        expect(ses.sendEmail).toHaveBeenCalledOnce();
        expect(repo.markDeliverySent).toHaveBeenCalledWith('d1', 'ses-123', NOW.toISOString());
    });

    it('on send failure schedules a retry with backoff, not failed (attempt 1)', async () => {
        repo.claimPendingDeliveries.mockResolvedValueOnce([
            { id: 'd2', channel: 'email', to_address: 'a@b.com', attempts: 0 },
        ]);
        const ses = { sendEmail: vi.fn(async () => { throw new Error('boom'); }) };
        await notificationService.drainOnce({ ses, sns: {}, now: NOW });
        const next = new Date(NOW.getTime() + 60_000).toISOString();
        expect(repo.markDeliveryRetry).toHaveBeenCalledWith('d2', 1, 'boom', next, false);
    });

    it('marks failed after the 5th attempt', async () => {
        repo.claimPendingDeliveries.mockResolvedValueOnce([
            { id: 'd3', channel: 'email', to_address: 'a@b.com', attempts: 4 },
        ]);
        const ses = { sendEmail: vi.fn(async () => { throw new Error('boom'); }) };
        await notificationService.drainOnce({ ses, sns: {}, now: NOW });
        const lastBackoff = new Date(NOW.getTime() + 43_200_000).toISOString();
        expect(repo.markDeliveryRetry).toHaveBeenCalledWith('d3', 5, 'boom', lastBackoff, true);
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd backend && npx vitest run test/notification-worker.test.js`
Expected: FAIL — `notificationService.drainOnce` is not a function.

- [ ] **Step 3: Add `drainOnce` to the service**

Add inside the `notificationService` object (after `notify`):
```javascript
    async drainOnce({ ses, sns, now = new Date(), limit = 50 } = {}) {
        const BACKOFF = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
        const rows = await notificationRepository.claimPendingDeliveries(limit, now.toISOString());
        for (const d of rows) {
            try {
                let externalId;
                if (d.channel === 'email') {
                    externalId = await ses.sendEmail({ to: d.to_address, subject: 'Notification', html: '' });
                } else {
                    externalId = await sns.sendSMS({ to: d.to_address, body: '' });
                }
                await notificationRepository.markDeliverySent(d.id, externalId, now.toISOString());
            } catch (err) {
                const attempts = (d.attempts ?? 0) + 1;
                const failed = attempts >= 5;
                const backoff = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)];
                const nextIso = new Date(now.getTime() + backoff).toISOString();
                await notificationRepository.markDeliveryRetry(d.id, attempts, err.message, nextIso, failed);
            }
        }
        return rows.length;
    },
```

> The delivery row carries only address + channel in this version; subject/body for the email come from a follow-up enhancement (the in-app `notifications` row holds title/body). For the first cut, fetch the parent notification's title/body when building the email. **Refinement:** change `claimPendingDeliveries` select to join the parent — see Step 3b.

- [ ] **Step 3b: Enrich the claim query with the parent notification**

In `notification.repository.js`, change `claimPendingDeliveries` select to:
```javascript
            .select('id, channel, to_address, attempts, notification:notifications(title, body, link_url)')
```
Then in `drainOnce`, build content from `d.notification`:
```javascript
                if (d.channel === 'email') {
                    externalId = await ses.sendEmail({
                        to: d.to_address,
                        subject: d.notification?.title || 'Notification',
                        html: `<p>${d.notification?.body || d.notification?.title || ''}</p>`,
                    });
                } else {
                    externalId = await sns.sendSMS({
                        to: d.to_address,
                        body: d.notification?.title || 'Notification',
                    });
                }
```
Update the worker test's claim mocks to include `notification: { title: 'Hi', body: 'x' }` on each row (the assertions on sent/retry are unchanged).

- [ ] **Step 4: Run test, verify it passes**

Run: `cd backend && npx vitest run test/notification-worker.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the cron job in `workers/index.js`**

Add near the other `node_cron_1.default.schedule(...)` blocks:
```javascript
import * as aws_ses_1 from "../lib/aws-ses.js";
import * as aws_sns_1 from "../lib/aws-sns.js";
import { notificationService } from "../services/notification.service.js";

// Notification outbox drain — every minute.
node_cron_1.default.schedule('* * * * *', async () => {
    try {
        const n = await notificationService.drainOnce({ ses: aws_ses_1, sns: aws_sns_1 });
        if (n) console.log(`[worker] drained ${n} notification deliveries`);
    } catch (err) {
        console.error('[worker] notification drain failed', err);
    }
});
```
> Place imports at the top with the other imports. Do NOT add this to `workers/ghl-sync-once.js`.

- [ ] **Step 6: Run the full suite + syntax check**

Run: `cd backend && npx vitest run test/notification-worker.test.js && node --check src/workers/index.js`
Expected: PASS + exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/notification.service.js backend/src/repositories/notification.repository.js backend/src/workers/index.js backend/test/notification-worker.test.js
git commit -m "feat(notifications): outbox drain worker with retry/backoff + tests"
```

---

## Task 8: messaging.js provider swap + tests

Swap the platform fallback in `lib/messaging.js`: Postmark→`aws-ses`, Twilio→`aws-sns`. Keep Postmark/Twilio as env-gated emergency fallback (`USE_LEGACY_EMAIL` / `USE_LEGACY_SMS`).

**Files:**
- Modify: `backend/src/lib/messaging.js`
- Test: `backend/test/messaging.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/messaging.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { getByProvider: vi.fn(async () => null) }, // no per-tenant override
}));
vi.mock('../src/lib/aws-ses.js', () => ({ sendEmail: vi.fn(async () => 'ses-msg-1') }));
vi.mock('../src/lib/aws-sns.js', () => ({ sendSMS: vi.fn(async () => 'sns-msg-1') }));
vi.mock('../src/lib/postmark.js', () => ({ sendEmail: vi.fn(async () => 'pm-1') }));
vi.mock('../src/lib/twilio.js', () => ({ sendSMS: vi.fn(async () => 'tw-1') }));
vi.mock('../src/lib/supabase.js', () => ({
    serviceClient: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import { sendEmail, sendSMS } from '../src/lib/messaging.js';
import * as ses from '../src/lib/aws-ses.js';
import * as sns from '../src/lib/aws-sns.js';

beforeEach(() => vi.clearAllMocks());

describe('messaging platform fallback', () => {
    it('routes email to SES by default', async () => {
        const r = await sendEmail({ orgId: 'o1', to: 'a@b.com', subject: 's', body: 'b' });
        expect(ses.sendEmail).toHaveBeenCalledOnce();
        expect(r.provider).toBe('ses');
        expect(r.external_id).toBe('ses-msg-1');
    });
    it('routes sms to SNS by default', async () => {
        const r = await sendSMS({ orgId: 'o1', to: '+447700900000', body: 'b' });
        expect(sns.sendSMS).toHaveBeenCalledOnce();
        expect(r.provider).toBe('sns_sms');
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd backend && npx vitest run test/messaging.test.js`
Expected: FAIL — current `sendEmail` falls through to Postmark, so `r.provider==='postmark'`.

- [ ] **Step 3: Edit `lib/messaging.js`**

Replace the imports of postmark/twilio and the two fallback bodies. New top imports:
```javascript
import * as ses_1 from "./aws-ses.js";
import * as sns_1 from "./aws-sns.js";
import * as postmark_1 from "./postmark.js";
import * as twilio_1 from "./twilio.js";
```
Replace the `sendEmail` fallback branch (after the per-tenant `if (ses) {...}`):
```javascript
    // Platform fallback: AWS SES (single platform domain). Legacy Postmark only
    // if explicitly enabled.
    if (process.env.USE_LEGACY_EMAIL === 'true') {
        const messageId = await postmark_1.sendEmail({ to, subject, body, from });
        await logEvent(orgId, 'postmark', messageId, 'sent', { to });
        return { external_id: messageId, provider: 'postmark' };
    }
    const sesId = await ses_1.sendEmail({ to, subject, html: body, from });
    await logEvent(orgId, 'ses', sesId, 'sent', { to });
    return { external_id: sesId, provider: 'ses' };
```
Replace the `sendSMS` fallback branch (after the per-tenant `if (sns) {...}`):
```javascript
    if (process.env.USE_LEGACY_SMS === 'true') {
        const sid = await twilio_1.sendSMS({ to, body });
        await logEvent(orgId, 'twilio', sid, 'sent', { to });
        return { external_id: sid, provider: 'twilio' };
    }
    const snsId = await sns_1.sendSMS({ to, body });
    await logEvent(orgId, 'sns_sms', snsId, 'sent', { to });
    return { external_id: snsId, provider: 'sns_sms' };
```
> Leave the existing per-tenant `sendViaSES`/`sendViaSNS` stub branch in place (it stays a no-op unless an org has its own integration config — single-platform-domain decision).

- [ ] **Step 4: Run test, verify it passes**

Run: `cd backend && npx vitest run test/messaging.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/messaging.js backend/test/messaging.test.js
git commit -m "feat(notifications): swap messaging fallback to SES/SNS (legacy env-gated)"
```

---

## Task 9: SES bounce/complaint webhook + tests

**Files:**
- Create: `backend/src/controllers/ses-event.controller.js`
- Modify: `backend/src/routes/webhooks.routes.js`, `backend/src/app.js`
- Test: `backend/test/ses-event.webhook.test.js`

- [ ] **Step 1: Write the controller**

```javascript
// ============================================================================
// SES event webhook — receives SES delivery notifications via an SNS topic.
// PUBLIC route; security is the SNS signature check (lib/aws-sns).
// Raw body parser mounted on /webhooks/ses-events in app.js.
// ============================================================================
import { verifySnsSignature, confirmSubscription } from "../lib/aws-sns.js";
import { notificationRepository } from "../repositories/notification.repository.js";
import * as supabase_1 from "../lib/supabase.js";

async function logProviderEvent(provider, external_id, event_type, payload) {
    try {
        await supabase_1.serviceClient.from('provider_events').insert({
            organisation_id: null, provider, external_id, event_type, payload,
        });
    } catch (err) {
        console.warn('[ses-event] provider_events log failed', err);
    }
}

export const sesEventController = {
    async handle(req, res) {
        let msg;
        try {
            msg = JSON.parse(req.body.toString('utf8'));
        } catch {
            return res.status(400).json({ error: 'bad json' });
        }
        const valid = await verifySnsSignature(msg);
        if (!valid) return res.status(403).json({ error: 'bad signature' });

        if (msg.Type === 'SubscriptionConfirmation') {
            await confirmSubscription(msg.SubscribeURL);
            return res.json({ ok: true, confirmed: true });
        }

        if (msg.Type === 'Notification') {
            let event;
            try { event = JSON.parse(msg.Message); } catch { event = {}; }
            const now = new Date().toISOString();
            const type = event.eventType || event.notificationType; // SES uses both shapes
            if (type === 'Bounce' && event.bounce?.bounceType === 'Permanent') {
                for (const r of event.bounce.bouncedRecipients || []) {
                    await notificationRepository.upsertSuppression(r.emailAddress, 'bounce', now);
                    await logProviderEvent('ses', event.mail?.messageId, 'bounce', { address: r.emailAddress });
                }
            } else if (type === 'Complaint') {
                for (const r of event.complaint?.complainedRecipients || []) {
                    await notificationRepository.upsertSuppression(r.emailAddress, 'complaint', now);
                    await logProviderEvent('ses', event.mail?.messageId, 'complaint', { address: r.emailAddress });
                }
            } else if (type === 'Delivery') {
                await logProviderEvent('ses', event.mail?.messageId, 'delivered', {});
            }
            return res.json({ ok: true });
        }
        return res.json({ ok: true });
    },
};
```

- [ ] **Step 2: Add the route**

In `webhooks.routes.js`, add:
```javascript
import * as ses_event_controller_1 from "../controllers/ses-event.controller.js";
// ...
router.post('/ses-events', (0, async_handler_1.asyncHandler)(ses_event_controller_1.sesEventController.handle));
```

- [ ] **Step 3: Mount the raw body parser in `app.js`**

Next to the Stripe/Dentally raw mounts (lines ~94-96):
```javascript
    app.use('/webhooks/ses-events', express_1.default.raw({ type: '*/*', limit: '1mb' }));
```

- [ ] **Step 4: Write the failing test**

```javascript
// backend/test/ses-event.webhook.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/aws-sns.js', () => ({
    verifySnsSignature: vi.fn(),
    confirmSubscription: vi.fn(async () => {}),
}));
vi.mock('../src/repositories/notification.repository.js', () => ({
    notificationRepository: { upsertSuppression: vi.fn(async () => {}) },
}));
vi.mock('../src/lib/supabase.js', () => ({
    serviceClient: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import { sesEventController } from '../src/controllers/ses-event.controller.js';
import { verifySnsSignature, confirmSubscription } from '../src/lib/aws-sns.js';
import { notificationRepository as repo } from '../src/repositories/notification.repository.js';

function mockRes() {
    return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (obj) => ({ body: Buffer.from(JSON.stringify(obj)) });
beforeEach(() => vi.clearAllMocks());

describe('SES event webhook', () => {
    it('rejects a bad signature with 403', async () => {
        verifySnsSignature.mockResolvedValueOnce(false);
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'Notification', Message: '{}' }), res);
        expect(res.code).toBe(403);
    });

    it('auto-confirms a subscription', async () => {
        verifySnsSignature.mockResolvedValueOnce(true);
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://x' }), res);
        expect(confirmSubscription).toHaveBeenCalledWith('https://x');
        expect(res.body).toEqual({ ok: true, confirmed: true });
    });

    it('suppresses a permanent bounce recipient', async () => {
        verifySnsSignature.mockResolvedValueOnce(true);
        const inner = JSON.stringify({
            eventType: 'Bounce',
            bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'x@y.com' }] },
            mail: { messageId: 'm1' },
        });
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'Notification', Message: inner }), res);
        expect(repo.upsertSuppression).toHaveBeenCalledWith('x@y.com', 'bounce', expect.any(String));
    });

    it('suppresses a complaint recipient', async () => {
        verifySnsSignature.mockResolvedValueOnce(true);
        const inner = JSON.stringify({
            eventType: 'Complaint',
            complaint: { complainedRecipients: [{ emailAddress: 'z@y.com' }] },
            mail: { messageId: 'm2' },
        });
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'Notification', Message: inner }), res);
        expect(repo.upsertSuppression).toHaveBeenCalledWith('z@y.com', 'complaint', expect.any(String));
    });
});
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npx vitest run test/ses-event.webhook.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Syntax check + commit**

Run: `cd backend && node --check src/controllers/ses-event.controller.js && node --check src/routes/webhooks.routes.js && node --check src/app.js`
```bash
git add backend/src/controllers/ses-event.controller.js backend/src/routes/webhooks.routes.js backend/src/app.js backend/test/ses-event.webhook.test.js
git commit -m "feat(notifications): SES bounce/complaint webhook + suppression + tests"
```

---

## Task 10: Wire real triggers

Fire `notify()` at real events. Keep each call best-effort (wrapped in try/catch where a failure must not break the primary flow). Read each target file first to place the call after the primary action succeeds.

**Files:**
- Modify: `backend/src/services/auth.service.js` (invite + public signup)
- Modify: the platform approve/reject path (find with: `grep -rn "approve\|reject" backend/src/services backend/src/controllers | grep -i signup`)
- Modify: `backend/src/workers/index.js` (weekly digest + integration failure)

- [ ] **Step 1: Locate trigger points**

Run:
```bash
cd backend
grep -rn "status: 'pending'\|provisionMember\|async invite" src/services/auth.service.js
grep -rn "signups\|approve\|reject" src/services src/controllers | grep -iv test
grep -rn "markFailed\|last_error\|catch" src/workers/index.js | head
```
Note the exact functions to edit.

- [ ] **Step 2: Member invited → notify invitee**

In `auth.service.js` `invite`/`provisionMember`, after the member row is created and you have the new user's `id` + `email`, add:
```javascript
    try {
        await notificationService.notify({
            orgId,
            userIds: [newUserId],
            category: 'team',
            title: 'You have been invited to Elevate',
            body: 'An owner added you to their practice group. Set your password to get started.',
            link: '/login',
            recipients: { [newUserId]: { email: newUserEmail, phone: null } },
        });
    } catch (err) { console.warn('[auth] invite notify failed', err); }
```
Add the import at the top: `import { notificationService } from "./notification.service.js";`

- [ ] **Step 3: Public signup pending → notify platform admins**

In the public signup path (`status: 'pending'`), after creating the owner row, look up platform admin ids and notify them:
```javascript
    try {
        const { data: admins } = await supabase_1.serviceClient
            .from('platform_admins').select('id, email');
        if (admins?.length) {
            const recipients = {};
            admins.forEach((a) => { recipients[a.id] = { email: a.email, phone: null }; });
            await notificationService.notify({
                orgId: null,
                userIds: admins.map((a) => a.id),
                isPlatform: true,
                category: 'account',
                title: 'New signup awaiting approval',
                body: `${body.organisation_name || 'A new organisation'} requested access.`,
                link: '/platform/signups',
                recipients,
            });
        }
    } catch (err) { console.warn('[auth] signup notify failed', err); }
```
> Confirm the local var holding the service client in `auth.service.js` (it may already import supabase as `supabase_1`). Match the existing import.

- [ ] **Step 4: Signup approved/rejected → notify owner**

In the platform approve handler, after flipping status to `active`:
```javascript
    try {
        await notificationService.notify({
            orgId: ownerOrgId,
            userIds: [ownerUserId],
            category: 'account',
            title: 'Your Elevate account is approved',
            body: 'You can now log in.',
            link: '/login',
            recipients: { [ownerUserId]: { email: ownerEmail, phone: null } },
        });
    } catch (err) { console.warn('[platform] approve notify failed', err); }
```
And in the reject handler, a parallel call with `title: 'Your Elevate signup was not approved'` and no link. Use the actual variable names found in Step 1.

- [ ] **Step 5: Integration sync failure → notify org owners**

In `workers/index.js`, in the GHL/Dentally sync catch block(s), after logging the error, notify the org's owners:
```javascript
    try {
        const { data: owners } = await supabase_1.serviceClient
            .from('users').select('id, email, phone')
            .eq('organisation_id', org.id).eq('role', 'owner');
        if (owners?.length) {
            const recipients = {};
            owners.forEach((o) => { recipients[o.id] = { email: o.email, phone: o.phone ?? null }; });
            await notificationService.notify({
                orgId: org.id,
                userIds: owners.map((o) => o.id),
                category: 'integration',
                title: 'Integration sync failed',
                body: 'An integration sync did not complete. Open Integrations to reconnect.',
                link: '/integrations',
                recipients,
            });
        }
    } catch (e) { console.warn('[worker] integration notify failed', e); }
```
> Place this inside the existing `catch` where a sync fails. Use the loop's `org` variable.

- [ ] **Step 6: Weekly digest → also land in-app**

In the weekly digest cron, after the existing `sendEmail`, add an in-app-only notify for the owner (email already sent by the digest itself, so pass `channels`-free notify but mute email by setting recipients email null is wrong — instead insert in-app only). Simplest: write the in-app row directly:
```javascript
    try {
        await notificationService.notify({
            orgId: org.id,
            userIds: [owner.id],
            category: 'digest',
            title: `Your weekly digest — ${org.name}`,
            body: 'Your weekly business snapshot is ready.',
            link: '/overview',
            recipients: { [owner.id]: { email: null, phone: null } }, // in-app only; digest email already sent
        });
    } catch (e) { console.warn('[worker] digest notify failed', e); }
```
> The owner loop variable already has `email` and `role`; ensure it also selects `id`. Update the digest query `.select('id, email, full_name, role')` if `id` is missing.

- [ ] **Step 7: Syntax check + run full suite**

Run: `cd backend && node --check src/services/auth.service.js && node --check src/workers/index.js && npm test`
Expected: all syntax OK; full vitest suite green (previous + new notification tests).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/auth.service.js backend/src/workers/index.js <approve/reject file>
git commit -m "feat(notifications): wire real triggers (invite, signup, approval, sync failure, digest)"
```

---

## Task 11: Frontend — data hooks + bell

**Files:**
- Create: `frontend/features/notifications/data.ts`
- Create: `frontend/features/notifications/components/NotificationBell.tsx`
- Modify: `frontend/components/layout/topbar.tsx`

- [ ] **Step 1: Write the data layer**

```typescript
// frontend/features/notifications/data.ts
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type Notification = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
};
export type Preference = { category: string; in_app: boolean; email: boolean; sms: boolean };

const CATEGORIES = ['account', 'team', 'integration', 'digest', 'system'];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api/backend/notifications${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`notifications ${path} failed: ${res.status}`);
  return res.json();
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api('/unread-count').then((d) => d.count as number),
    refetchInterval: 60_000,
  });
}

export function useNotifications(unread = false) {
  return useQuery({
    queryKey: ['notifications', 'list', unread],
    queryFn: () => api(`/?unread=${unread}`).then((d) => d.notifications as Notification[]),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: async () => {
      const stored: Preference[] = (await api('/preferences')).preferences;
      // Fill defaults for categories with no stored row.
      return CATEGORIES.map((c) =>
        stored.find((p) => p.category === c) ?? {
          category: c, in_app: true, email: true, sms: c === 'integration',
        });
    },
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: Preference[]) =>
      api('/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  });
}
```

> Verify the proxy base path: other features call `fetch('/api/backend/...')`. Confirm with `grep -rn "/api/backend/" frontend/features | head -3` and match exactly.

- [ ] **Step 2: Write the bell component**

```tsx
// frontend/features/notifications/components/NotificationBell.tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useUnreadCount, useNotifications, useMarkRead } from '../data';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: count = 0 } = useUnreadCount();
  const { data: items = [] } = useNotifications(false);
  const markRead = useMarkRead();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-ink-muted hover:text-ink"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white text-[10px] flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-20">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Notifications</span>
            <Link href="/notifications" className="text-xs text-brand" onClick={() => setOpen(false)}>
              See all
            </Link>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-6 text-sm text-ink-muted text-center">No notifications</li>
            )}
            {items.slice(0, 8).map((n) => (
              <li key={n.id}>
                <Link
                  href={n.link_url || '/notifications'}
                  onClick={() => { markRead.mutate(n.id); setOpen(false); }}
                  className={`block px-4 py-3 border-b border-border hover:bg-bg ${n.read_at ? '' : 'bg-brand-50'}`}
                >
                  <p className="text-sm text-ink">{n.title}</p>
                  {n.body && <p className="text-xs text-ink-muted mt-0.5">{n.body}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

> Tailwind tokens (`text-ink`, `bg-card`, `border-border`, `bg-brand`, `bg-brand-50`, `bg-bg`) are the existing design tokens used in `topbar.tsx`. Confirm names with `grep -rn "bg-brand-50\|text-ink-muted" frontend/components/layout/topbar.tsx` and adjust if needed.

- [ ] **Step 3: Mount the bell in `topbar.tsx`**

In the right-side `<div className="flex items-center gap-3">`, add `<NotificationBell />` before the avatar block. Add the import:
```tsx
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
```

- [ ] **Step 4: Verify the build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: typecheck passes; build succeeds. (Frontend has no test runner per CLAUDE.md — verification is typecheck + build.)

- [ ] **Step 5: Commit**

```bash
git add frontend/features/notifications/data.ts frontend/features/notifications/components/NotificationBell.tsx frontend/components/layout/topbar.tsx
git commit -m "feat(notifications): frontend data hooks + topbar bell"
```

---

## Task 12: Frontend — inbox + preferences screens

**Files:**
- Create: `frontend/features/notifications/components/NotificationsScreen.tsx`
- Create: `frontend/features/notifications/components/NotificationPreferencesScreen.tsx`
- Create: `frontend/app/(dashboard)/notifications/page.tsx`
- Create: `frontend/app/(dashboard)/notifications/preferences/page.tsx`

- [ ] **Step 1: NotificationsScreen**

```tsx
// frontend/features/notifications/components/NotificationsScreen.tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useNotifications, useMarkRead, useMarkAllRead } from '../data';

export function NotificationsScreen() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data: items = [], isLoading } = useNotifications(unreadOnly);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-medium text-ink">Notifications</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-ink-muted flex items-center gap-1">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Unread only
          </label>
          <button onClick={() => markAll.mutate()} className="text-sm text-brand">Mark all read</button>
          <Link href="/notifications/preferences" className="text-sm text-brand">Preferences</Link>
        </div>
      </div>
      {isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      <ul className="border border-border rounded-lg overflow-hidden bg-card">
        {!isLoading && items.length === 0 && (
          <li className="px-4 py-8 text-sm text-ink-muted text-center">Nothing here yet</li>
        )}
        {items.map((n) => (
          <li key={n.id}>
            <Link
              href={n.link_url || '#'}
              onClick={() => !n.read_at && markRead.mutate(n.id)}
              className={`block px-4 py-3 border-b border-border hover:bg-bg ${n.read_at ? '' : 'bg-brand-50'}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-ink">{n.title}</p>
                <span className="text-[11px] text-ink-muted">{new Date(n.created_at).toLocaleDateString('en-GB')}</span>
              </div>
              {n.body && <p className="text-xs text-ink-muted mt-0.5">{n.body}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: NotificationPreferencesScreen**

```tsx
// frontend/features/notifications/components/NotificationPreferencesScreen.tsx
'use client';
import { useEffect, useState } from 'react';
import { usePreferences, useUpdatePreferences, type Preference } from '../data';

const LABELS: Record<string, string> = {
  account: 'Account', team: 'Team', integration: 'Integrations', digest: 'Weekly digest', system: 'System',
};

export function NotificationPreferencesScreen() {
  const { data } = usePreferences();
  const update = useUpdatePreferences();
  const [rows, setRows] = useState<Preference[]>([]);

  useEffect(() => { if (data) setRows(data); }, [data]);

  function toggle(i: number, key: 'in_app' | 'email' | 'sms') {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: !row[key] } : row)));
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-lg font-medium text-ink mb-4">Notification preferences</h1>
      <table className="w-full border border-border rounded-lg bg-card text-sm">
        <thead>
          <tr className="border-b border-border text-ink-muted">
            <th className="text-left px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 font-medium">In-app</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">SMS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.category} className="border-b border-border">
              <td className="px-4 py-2 text-ink">{LABELS[row.category] ?? row.category}</td>
              {(['in_app', 'email', 'sms'] as const).map((k) => (
                <td key={k} className="text-center px-4 py-2">
                  <input type="checkbox" checked={row[k]} onChange={() => toggle(i, k)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => update.mutate(rows)}
        disabled={update.isPending}
        className="mt-4 px-4 py-2 bg-brand text-white rounded-lg text-sm disabled:opacity-50"
      >
        {update.isPending ? 'Saving…' : 'Save preferences'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Route pages**

```tsx
// frontend/app/(dashboard)/notifications/page.tsx
import { NotificationsScreen } from '@/features/notifications/components/NotificationsScreen';
export default function Page() { return <NotificationsScreen />; }
```
```tsx
// frontend/app/(dashboard)/notifications/preferences/page.tsx
import { NotificationPreferencesScreen } from '@/features/notifications/components/NotificationPreferencesScreen';
export default function Page() { return <NotificationPreferencesScreen />; }
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/notifications frontend/app/\(dashboard\)/notifications
git commit -m "feat(notifications): inbox + preferences screens"
```

---

## Task 13: Docs

**Files:**
- Modify: `docs/API.md`, `docs/DEPLOYMENT.md`

- [ ] **Step 1: API.md** — add the `/api/notifications*` endpoints (list, unread-count, :id/read, read-all, GET/PUT preferences) and the public `POST /webhooks/ses-events` with request/response shapes used above.

- [ ] **Step 2: DEPLOYMENT.md** — add a "Notifications / AWS SES+SNS" section documenting env vars (`AWS_REGION`, `SES_FROM`, `SES_CONFIGURATION_SET`, `SNS_SENDER_ID`, `SNS_SMS_TYPE`, `USE_LEGACY_EMAIL`, `USE_LEGACY_SMS`) and the one-time AWS setup: verify domain + DKIM in SES, create SNS topic, attach SES configuration-set event destination → SNS topic, subscribe `https://<app>/webhooks/ses-events`, request SES production access. Note the post-migration `NOTIFY pgrst, 'reload schema';` step for hosted.

- [ ] **Step 3: Commit**

```bash
git add docs/API.md docs/DEPLOYMENT.md
git commit -m "docs(notifications): API + deployment for SES/SNS notifications"
```

---

## Final verification

- [ ] Run full backend suite: `cd backend && npm test` — all green (including the 5 new test files).
- [ ] Backend lint + syntax: `cd backend && npm run lint && npm run typecheck`.
- [ ] Frontend: `cd frontend && npm run typecheck && npm run build`.
- [ ] Manual smoke (optional, needs AWS creds + verified domain): trigger a signup → confirm an in-app row + a queued delivery; run the worker once; confirm `notification_deliveries.status='sent'` and a `provider_events('sent')` row.

## Deferred / explicitly out of scope

- Patient/contact comms remain in the CRM lane (they ride the SES/SNS swap automatically, no new features).
- Per-tenant SES identity stays a dormant no-op branch (single-platform-domain decision).
- SES production-access request is a manual AWS console action; until granted, prod sends only to verified addresses.
