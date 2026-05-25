# QuickBooks Online Setup

Four days. Alternative to Xero, used when an entity's accountant prefers QBO.

**Build this only if at least one entity uses QuickBooks.** If everyone's on Xero, skip this entire document.

Same UI surface, same `monthly_financials` table, same reconciliation controls. The connector differs.

---

## Prerequisites

1. Confirm which entities use QuickBooks Online. Note: QBO Desktop is different and unsupported in v1.
2. Get the company admin's consent — Intuit's troubleshooting guidance says the connecting user must be a company admin or the OAuth flow rejects.
3. Note the `realmId` for each company. You'll need one per entity.

Official docs (last verified 25 May 2026):
- Overview: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api
- OAuth 2.0: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- Reports: https://developer.intuit.com/app/developer/qbo/docs/workflows/run-reports
- Webhooks: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks

---

## Day 1: App registration + OAuth

### Register at Intuit Developer

At https://developer.intuit.com create an app:
- **Name:** Elevate Dental OS
- **Redirect URIs:** `https://api.elevateos.co/v1/integrations/quickbooks/callback` + local equivalent
- **Scopes:** `com.intuit.quickbooks.accounting` + `offline_access`

Add OpenID scopes only if you want to use Intuit identity data directly.

Note the `client_id` and `client_secret`. Store encrypted.

### OAuth flow

QuickBooks uses standard OAuth 2.0 with PKCE-optional flow. The callback returns `code`, `state`, and `realmId`.

```js
router.get('/connect', requireAuth, requireOwner, async (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  await redis.setex(`qbo-oauth:${state}`, 600, req.user.id);

  const url = new URL('https://appcenter.intuit.com/connect/oauth2');
  url.searchParams.set('client_id', process.env.QBO_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.QBO_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/callback', async (req, res) => {
  const { code, state, realmId } = req.query;
  // Validate state
  const userId = await redis.get(`qbo-oauth:${state}`);
  if (!userId) return res.status(400).send('State expired');

  // Exchange code
  const tokens = await exchangeCodeForTokens(code);

  // Create integration record (one per realmId)
  const entityId = await mapRealmToEntity(realmId);
  const integrationId = await createIntegration({
    organization_id: orgId,
    entity_id: entityId,
    system: 'quickbooks',
    config: { realm_id: realmId },
    status: 'connected'
  });

  await storeTokens(integrationId, tokens);
  res.redirect('/launch-health?qbo=connected');
});
```

### Token rotation

QBO refresh tokens last 100 days. Rotate every 30 days defensively:

```js
cron.schedule('0 4 * * *', () => rotateExpiringQboTokens());
```

---

## Day 2: Reports + entities

### Reports API

QBO exposes the standard four reports we need:

| Endpoint | Use |
|---|---|
| `GET /v3/company/{realmId}/reports/ProfitAndLoss` | Monthly P&L |
| `GET /v3/company/{realmId}/reports/BalanceSheet` | Period balance sheet |
| `GET /v3/company/{realmId}/reports/CashFlow` | Cash flow statement |
| `GET /v3/company/{realmId}/reports/GeneralLedger` | Drill-down detail |

**Chunking rule:** QBO recommends report queries cover ≤6 months. For longer history, split into multiple requests. The `summarize_column_by=Month` parameter gives you per-month columns within the period.

```js
async function fetchPnL(integrationId, fromDate, toDate) {
  // Split into 6-month chunks
  const chunks = chunkDateRange(fromDate, toDate, { months: 6 });
  const results = [];
  for (const [from, to] of chunks) {
    const { data } = await client.get(
      `/v3/company/${realmId}/reports/ProfitAndLoss`,
      { params: { start_date: from, end_date: to, summarize_column_by: 'Month' } }
    );
    results.push(parseReport(data));
  }
  return mergeReports(results);
}
```

### Entities to sync

```
GET /v3/company/{realmId}/query?query=SELECT * FROM Account
GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '...'
GET /v3/company/{realmId}/query?query=SELECT * FROM Payment WHERE MetaData.LastUpdatedTime > '...'
GET /v3/company/{realmId}/query?query=SELECT * FROM Bill ...
GET /v3/company/{realmId}/query?query=SELECT * FROM Customer
GET /v3/company/{realmId}/query?query=SELECT * FROM Vendor
GET /v3/company/{realmId}/query?query=SELECT * FROM JournalEntry ...
```

QBO uses SQL-like query syntax. Use `MetaData.LastUpdatedTime` for delta sync.

### Class / Location mapping to practice

QBO equivalents of Xero tracking categories:
- **Classes:** for practice tagging on transaction lines
- **Locations:** for site-level transactions

Pick one (Class is more flexible). Map each value to a `practice_id` in `accounting_tracking_categories`.

If the QBO company doesn't use classes/locations, the practice manager and accountant need to introduce them before this connector can power per-practice reconciliation.

---

## Day 3: Webhooks + CDC

### Webhooks

QBO supports webhooks for entity changes. In the Intuit Developer portal, configure the webhook URL:

```
POST https://api.elevateos.co/v1/webhooks/quickbooks
```

Note the verifier token. Verify the `intuit-signature` header (HMAC SHA-256 of the body with the verifier token, base64-encoded).

```js
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.get('intuit-signature');
  const expected = crypto
    .createHmac('sha256', process.env.QBO_WEBHOOK_VERIFIER)
    .update(req.body)
    .digest('base64');
  if (signature !== expected) return res.status(401).end();

  const payload = JSON.parse(req.body);
  for (const notification of payload.eventNotifications) {
    for (const event of notification.dataChangeEvent.entities) {
      await db.query(`INSERT INTO raw_events ...`, [
        resolveIntegrationByRealm(notification.realmId),
        `${event.name}.${event.operation}`.toLowerCase(),
        event.id,
        event,
        signature
      ]);
      await queue.add('qbo-normalize', { realmId: notification.realmId, entity: event });
    }
  }
  res.status(200).end();
});
```

### CDC (Change Data Capture)

For systems where webhooks miss events (latency, deactivation, missed deliveries), use CDC to catch up:

```js
// Every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  for (const integration of await listQboIntegrations()) {
    const since = await getLastCdcCursor(integration.id);
    const { data } = await client.get(`/v3/company/${realmId}/cdc`, {
      params: { entities: 'Account,Invoice,Payment,Bill', changedSince: since }
    });
    await ingestCdc(integration.id, data);
    await setLastCdcCursor(integration.id, new Date());
  }
});
```

CDC + webhooks belt-and-braces: even if a webhook fails, the next CDC poll picks it up.

---

## Day 4: Backfill + mapping

### Backfill

Chart of accounts mapping workshop — same as Xero (`XERO_SETUP.md` Day 3). Map every QBO account to a `dental_bucket`.

Initial 24-month P&L backfill:

```bash
node scripts/backfill-qbo.js \
  --integration <id> \
  --from 2024-06 \
  --to 2026-05
```

Watch for:
- Rate limit hits (QBO uses a token bucket per app per realm — back off on `429`)
- Reports timing out (split into smaller chunks if a 6-month period takes >30s)

---

## Differences from Xero (worth knowing)

| Concept | Xero | QuickBooks |
|---|---|---|
| Multi-entity | One client, multiple tenants | One realmId per company; user can grant access to multiple realms in one OAuth |
| Practice tag | Tracking categories | Classes or Locations |
| Reports format | Tree of sections / rows / cells | Flat columns with header rows |
| Period chunking | Generous (12 months OK) | Strict 6-month max recommended |
| Webhooks coverage | Limited (no reports, no bank) | Better but still polling required for reports |
| Token life | Refresh 60 days | Refresh 100 days |
| Account types | Custom + standard | Strict standard set |

---

## Acceptance criteria

- [ ] OAuth flow works · realmId captured · tokens stored encrypted
- [ ] P&L for one entity pulls + displays
- [ ] Classes / Locations map every revenue line to a practice
- [ ] Webhooks deliver + verify signature
- [ ] CDC polls every 15 minutes
- [ ] Account-to-bucket mapping complete
- [ ] Reconciliation controls run against QBO side cleanly
- [ ] 24-month backfill loads

---

## When you have both Xero and QuickBooks

Some groups have one entity on Xero and another on QBO. Both connectors run side by side. Each entity has its own integration.

**Rule:** never connect both Xero AND QuickBooks to the same entity at the same time. The `accounting_transactions` table joins on `entity_id` — having two sources would double-count. Enforce this at the integrations layer:

```sql
ALTER TABLE integrations ADD CONSTRAINT one_accounting_per_entity
  EXCLUDE (entity_id WITH =) WHERE (system IN ('xero', 'quickbooks') AND status = 'connected');
```
