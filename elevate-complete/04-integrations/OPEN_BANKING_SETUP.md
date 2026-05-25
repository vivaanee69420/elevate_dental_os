# Open Banking Setup

Three days. **Post-v1.** Build this only when Xero/QB-supplied bank data isn't fast enough or when owner wants independent verification.

**Current state:** zero. No connection exists.

---

## Why this is post-v1

Xero and QuickBooks both provide bank feeds via their own bank-feed integrations. For 95% of the dashboard, that's enough. Open Banking duplicates the data with one upside: **independence**. The cash balance Open Banking shows is verifiable against the bank directly, without trusting accounting.

Build Open Banking when:
1. Owner wants treasury-style real-time cash visibility (e.g. 10-minute refresh)
2. You need to verify accounting against the bank for fraud / control assurance
3. Personal-finance scenarios open up (pensions, investments outside the business)

---

## Provider choice

| Provider | UK coverage | Per-account cost | Setup effort |
|---|---|---|---|
| **TrueLayer** | Excellent (all major UK banks) | ~£0.50–£2/mo per AISP connection | 1 day OAuth + 1 day data fetch |
| **Plaid** | Good UK + international | ~$1–$3/mo per connection | Similar |
| **Tink** (Visa) | Strong EU + UK | Quote-based | Similar |
| **Yapily** | UK + EU | Per-API call | Slightly lighter |

Pick **TrueLayer** for UK-only GM Dental Group. Use Plaid if you ever expand to US.

Official references (last verified 25 May 2026):
- TrueLayer Data API: https://docs.truelayer.com/docs/data-api-overview

---

## Day 1: AISP registration + OAuth

**AISP (Account Information Service Provider)** is the regulatory category. The chosen provider handles the FCA AISP licence — you piggyback on theirs in v1. If you need your own AISP licence, that's a 4-6 month regulatory process; defer.

### Register with TrueLayer

At https://console.truelayer.com create an application:
- Scopes: `info accounts balance transactions cards direct_debits standing_orders offline_access`
- Redirect URI: `https://api.elevateos.co/v1/integrations/open_banking/callback`

Get `client_id` and `client_secret`.

### OAuth flow

```js
router.get('/connect', requireAuth, requireOwner, async (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  await redis.setex(`ob-oauth:${state}`, 600, JSON.stringify({
    userId: req.user.id,
    entityId: req.query.entity_id
  }));

  const url = new URL('https://auth.truelayer.com/');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.TRUELAYER_CLIENT_ID);
  url.searchParams.set('scope', 'info accounts balance transactions offline_access');
  url.searchParams.set('redirect_uri', process.env.TRUELAYER_REDIRECT_URI);
  url.searchParams.set('providers', 'uk-ob-all');  // all UK banks
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const ctx = JSON.parse(await redis.get(`ob-oauth:${state}`));

  // Exchange code
  const tokens = await axios.post('https://auth.truelayer.com/connect/token', {
    grant_type: 'authorization_code',
    client_id: process.env.TRUELAYER_CLIENT_ID,
    client_secret: process.env.TRUELAYER_CLIENT_SECRET,
    redirect_uri: process.env.TRUELAYER_REDIRECT_URI,
    code
  });

  // Pull connected accounts
  const accounts = await listAccounts(tokens.data.access_token);

  // One integration per bank account
  for (const account of accounts) {
    const integrationId = await createIntegration({
      organization_id: orgId,
      entity_id: ctx.entityId,
      system: 'open_banking',
      account_label: `${account.provider.display_name} · ${account.account_number.iban || account.account_number.number}`,
      config: { account_id: account.account_id, provider: account.provider.provider_id },
      status: 'connected'
    });
    await storeTokens(integrationId, tokens.data);
  }

  res.redirect('/launch-health?openbanking=connected');
});
```

### Consent expiry

UK Open Banking consents expire **every 90 days**. The user must re-authenticate. Schedule a reminder:

```js
cron.schedule('0 9 * * *', async () => {
  const expiring = await db.query(`
    SELECT id, organization_id, account_label
    FROM integrations
    WHERE system = 'open_banking' AND status = 'connected'
      AND (config->>'consent_expires_at')::timestamptz < now() + interval '7 days'
  `);
  for (const i of expiring.rows) {
    await sendReminderEmail(i.organization_id, `Open Banking re-consent required for ${i.account_label} within 7 days`);
  }
});
```

---

## Day 2: Sync

```js
// src/jobs/open-banking-sync.js

// Balances every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  for (const integration of await listOpenBankingIntegrations()) {
    await syncBalance(integration);
  }
});

// Transactions hourly
cron.schedule('0 * * * *', async () => {
  for (const integration of await listOpenBankingIntegrations()) {
    await syncTransactionsDelta(integration);
  }
});
```

Transactions land in a new `bank_transactions` table (add to schema in v1.1):

```sql
CREATE TABLE bank_transactions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id  uuid NOT NULL REFERENCES integrations(id),
  external_id     text NOT NULL,
  posted_at       timestamptz NOT NULL,
  amount          numeric(14,2) NOT NULL,
  currency        char(3) NOT NULL,
  description     text,
  category        text,
  running_balance numeric(14,2),
  raw             jsonb,
  UNIQUE (integration_id, external_id)
);
```

---

## Day 3: Reconciliation against accounting

Add a sixth reconciliation control: `bank_vs_accounting`.

Compares:
- Open Banking closing balance for the day
- Xero/QB bank account balance at the same date

Tolerance: 0.1% (banks are exact — anything bigger is a real issue).

This is the gold-standard verification: "the cash position my accounting shows actually matches the bank."

---

## Acceptance criteria

- [ ] OAuth flow works against TrueLayer sandbox
- [ ] At least one bank account connects in production
- [ ] Balances refresh every 15 minutes
- [ ] Transactions sync hourly
- [ ] 90-day consent expiry reminder fires 7 days before
- [ ] `bank_vs_accounting` reconciliation control runs cleanly
