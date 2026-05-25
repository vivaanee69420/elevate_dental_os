# Xero Setup

Five days. Highest unlock per developer-hour — Xero powers ~60% of the Finance UI.

**Current state:** zero. No connection exists. This document gets you to a working Xero connector with nightly P&L / Balance Sheet / Bank polling plus a hourly cash refresh.

---

## Prerequisites

1. **Determine if any entity uses Xero.** If everything's on QuickBooks, build QB first (`QUICKBOOKS_SETUP.md`).
2. **Get accountant access** to the practice's Xero. You'll need them for the chart-of-accounts mapping workshop on Day 3.
3. **Decide cash vs accrual basis** with the accountant. This affects how you interpret the P&L report.

Official docs (last verified 25 May 2026):
- Developer portal: https://developer.xero.com
- OAuth scopes: https://developer.xero.com/documentation/guides/oauth2/scopes/
- Reports API: https://developer.xero.com/documentation/api/accounting/reports
- Webhooks: https://developer.xero.com/documentation/guides/webhooks/overview/

---

## Day 1: App registration + OAuth flow

### Register the app

At https://developer.xero.com create a new app (Web App):

- **Name:** Elevate Dental OS
- **OAuth 2.0 redirect URI:** `https://api.elevateos.co/v1/integrations/xero/callback` (and `http://localhost:4000/v1/integrations/xero/callback` for dev)
- **Privacy / terms URLs:** Your published pages

Note the `client_id` and `client_secret`. Store in secrets manager.

### Choose scopes

Use **granular scopes**. Xero assigned granular scopes to web apps in March 2026 and to custom connections in April. Broad scopes deprecate September 2027 — don't start a new build on them.

Minimum read-only set:

```
openid profile email offline_access
accounting.settings.read
accounting.contacts.read
accounting.transactions.read
accounting.reports.read
```

Add the bank-transaction read scope if exposed in your app's registered scope list.

### OAuth flow

`src/connectors/xero/oauth.js`:

```js
const STATE_TTL = 600;  // 10 minutes

router.get('/connect', requireAuth, requireOwner, async (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  await redis.setex(`xero-oauth:${state}`, STATE_TTL, req.user.id);

  const url = new URL('https://login.xero.com/identity/connect/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.XERO_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.XERO_REDIRECT_URI);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const userId = await redis.get(`xero-oauth:${state}`);
  if (!userId) return res.status(400).send('State expired');
  await redis.del(`xero-oauth:${state}`);

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code);

  // List connected tenants — practice may authorise multiple entities
  const tenants = await listTenants(tokens.access_token);

  // For each tenant, create an integration record
  for (const tenant of tenants) {
    await db.query(`
      INSERT INTO integrations (organization_id, entity_id, system, account_label, config, status)
      VALUES ($1, $2, 'xero', $3, $4, 'connected')
      ON CONFLICT DO NOTHING
    `, [orgId, mapEntity(tenant), tenant.tenantName, { tenant_id: tenant.tenantId }]);

    // Store tokens encrypted
    await storeTokens(integrationId, tokens);
  }

  res.redirect('/launch-health?xero=connected');
});
```

### Token rotation

Xero refresh tokens last 60 days. Rotate every 30 days to be safe:

```js
cron.schedule('0 4 * * *', async () => {
  const dueForRotation = await db.query(`
    SELECT i.id, t.refresh_token_ciphertext
    FROM integrations i
    JOIN integration_tokens t ON t.integration_id = i.id
    WHERE i.system = 'xero' AND i.status = 'connected'
      AND t.rotated_at < now() - interval '30 days'
  `);
  for (const row of dueForRotation.rows) {
    await rotateXeroTokens(row.id);
  }
});
```

---

## Day 2: Reports API

Xero's Reports API returns the P&L, Balance Sheet, Cash Summary in a structured format. These are the gold source for Finance UI.

### P&L pull

```js
async function fetchPnL(integrationId, fromDate, toDate) {
  const client = await makeXeroClient(integrationId);
  const { data } = await client.get('/api.xro/2.0/Reports/ProfitAndLoss', {
    params: {
      fromDate,
      toDate,
      periods: 12,
      timeframe: 'MONTH',
      standardLayout: true
    }
  });
  return parseReport(data.Reports[0]);
}
```

The report comes back as a tree of sections / rows / cells. Build a parser that flattens to `{ account_code, account_name, monthly_values: [...] }`.

### Balance Sheet pull

```js
async function fetchBalanceSheet(integrationId, asOfDate) {
  const client = await makeXeroClient(integrationId);
  const { data } = await client.get('/api.xro/2.0/Reports/BalanceSheet', {
    params: { date: asOfDate, standardLayout: true }
  });
  return parseReport(data.Reports[0]);
}
```

### Bank balances

```js
async function fetchBankSummary(integrationId) {
  const client = await makeXeroClient(integrationId);
  const { data } = await client.get('/api.xro/2.0/Reports/BankSummary');
  return parseReport(data.Reports[0]);
}
```

---

## Day 3: Chart of accounts mapping workshop

**This is the most important day. Block out 2-3 hours with the practice's accountant.**

For each account in the practice's Xero, decide which `dental_bucket` it maps to. Use the standard set from `DATA_MODEL.md`:

**Revenue buckets:** `revenue.private`, `revenue.nhs`, `revenue.implants`, `revenue.hygiene`, `revenue.orthodontics`, `revenue.other`

**COS buckets:** `cos.lab`, `cos.materials`, `cos.associate`, `cos.finance`

**Overhead buckets:** `overhead.staff`, `overhead.rent`, `overhead.utilities`, `overhead.marketing`, `overhead.software`, `overhead.insurance`, `overhead.professional`, `overhead.other`

Store the mapping in `accounting_accounts.dental_bucket`.

Common pitfalls:
- Implants posted to general "private revenue" account — needs sub-coding or treatment-code lookup
- Lab costs not separated from materials — ask the accountant to split
- Associate self-employed payments treated as overhead — should be COS
- Marketing spend in three different accounts — consolidate
- One-off legal / professional fees flagged for QoE add-back

### Tracking categories

Xero "tracking categories" tag transactions with a practice. The practice should have a category like "Site" or "Practice" with one option per location.

If they don't, request the accountant to set this up — it's mandatory for `revenue_by_practice` reconciliation to work.

Map each tracking category option to a `practice_id` in `accounting_tracking_categories`.

---

## Day 4: Sync jobs + bank polling

### Job schedule

```js
// src/jobs/xero-sync.js

// Monthly close: rebuild P&L + Balance Sheet for prior closed month
cron.schedule('0 5 1 * *', async () => {
  for (const integration of await listXeroIntegrations()) {
    await syncMonthlyReports(integration.id, lastClosedMonth());
  }
});

// Nightly: contacts, invoices, payments, accounts, bank transactions
cron.schedule('0 2 * * *', async () => {
  for (const integration of await listXeroIntegrations()) {
    await syncAccountingDelta(integration.id, last24Hours());
  }
});

// Hourly: bank balances (cash position changes frequently)
cron.schedule('0 * * * *', async () => {
  for (const integration of await listXeroIntegrations()) {
    await syncBankBalances(integration.id);
  }
});
```

### Delta sync via `If-Modified-Since`

Xero supports `If-Modified-Since` header on most endpoints. Use it to pull only changed records since the last sync:

```js
const response = await client.get('/api.xro/2.0/Invoices', {
  headers: {
    'If-Modified-Since': lastSyncTimestamp.toISOString()
  }
});
```

Update `sync_jobs.finished_at` after each successful sync so the next delta starts from there.

---

## Day 5: Webhooks + acceptance testing

### Webhooks

Xero webhooks notify on `INVOICE`, `CONTACT`, `PAYMENT` create/update events. They don't cover everything (no reports, no bank transactions), so polling remains required.

In the Xero developer portal, configure the webhook delivery URL:

```
POST https://api.elevateos.co/v1/webhooks/xero
```

Set a webhook key. Verify the `X-Xero-Signature` HMAC SHA-256 header on every request.

`src/webhooks/xero.js`:

```js
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.get('X-Xero-Signature');
  const expected = crypto
    .createHmac('sha256', process.env.XERO_WEBHOOK_KEY)
    .update(req.body)
    .digest('base64');

  if (signature !== expected) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const events = JSON.parse(req.body).events;
  for (const event of events) {
    await db.query(`
      INSERT INTO raw_events (integration_id, event_type, external_id, payload, signature)
      VALUES ($1, $2, $3, $4, $5)
    `, [resolveIntegration(event.tenantId), event.eventCategory + '.' + event.eventType, event.resourceId, event, signature]);
    await queue.add('xero-normalize', { eventId: row.id });
  }

  res.status(200).json({ received: true });
});
```

### Initial backfill

Pull 24 months of P&L + Balance Sheet to populate `monthly_financials`:

```bash
node scripts/backfill-xero.js \
  --integration <integration-id> \
  --from 2024-06 \
  --to 2026-05
```

---

## Acceptance criteria

- [ ] OAuth flow works end-to-end · tokens stored encrypted · refresh tokens rotate cleanly
- [ ] P&L for one entity pulls and displays in `/v1/finance/pnl`
- [ ] Numbers match Xero's own P&L report exactly
- [ ] Bank balances refresh hourly
- [ ] Tracking categories map every revenue transaction to a practice
- [ ] Webhooks deliver and verify signature
- [ ] `unmapped_account_code` exceptions raised for any account without a `dental_bucket`
- [ ] 24-month backfill loads cleanly into `monthly_financials`
- [ ] Cash-received reconciliation control (`cash_received`) runs successfully against Dentally side

---

## Out of scope for v1

- Writing back to Xero (creating invoices, payments etc.)
- Multi-currency reporting (assume GBP everywhere)
- Budget vs actual (defer to v1.1)
- VAT return generation
