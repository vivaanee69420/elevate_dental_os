# Stripe Setup

Two days. Optional for v1 — only needed if any practice takes online patient payments, deposits or subscription billing.

**Current state:** zero. No connection exists.

---

## Should you build this in v1?

| Practice scenario | Build Stripe? |
|---|---|
| All payments in-chair via card terminal posted in Dentally | ❌ No — defer |
| Online consultation deposits via website | ✅ Yes |
| Recurring payment plans (membership, finance) handled outside Medenta/Tabeo | ✅ Yes |
| Online shop selling whitening / aftercare | ✅ Yes |
| Future-proofing only | ❌ No — defer |

GM Dental Group v1 leans towards deferring unless the Academy / Elevate Accounts brand starts taking subscription payments directly (currently planned for Oct 2026).

---

## Day 1: OAuth + Connect

### Choose the model

**Stripe Connect** vs **single account**:
- **Single account:** all payments hit one Stripe account; you allocate to practices internally. Simpler. Use when one entity owns all the practices.
- **Stripe Connect (Standard):** each entity has its own connected Stripe account. Each goes through OAuth. Use when entities are separate legal companies that need their own payouts.

For GM Dental Group: Connect Standard, since each entity is a separate Ltd company with its own bank account.

### Register at Stripe

At https://dashboard.stripe.com/settings/connect register the platform application. Get:
- `STRIPE_CLIENT_ID` (Connect OAuth client ID)
- `STRIPE_SECRET_KEY` (platform secret key)
- `STRIPE_WEBHOOK_SECRET` (per-endpoint signing secret, set in Day 2)

### OAuth flow

```js
// src/connectors/stripe/oauth.js
router.get('/connect', requireAuth, requireOwner, async (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  await redis.setex(`stripe-oauth:${state}`, 600, JSON.stringify({
    userId: req.user.id,
    entityId: req.query.entity_id
  }));

  const url = new URL('https://connect.stripe.com/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.STRIPE_CLIENT_ID);
  url.searchParams.set('scope', 'read_write');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const ctx = JSON.parse(await redis.get(`stripe-oauth:${state}`));

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const response = await stripe.oauth.token({
    grant_type: 'authorization_code',
    code
  });

  const integrationId = await createIntegration({
    organization_id: orgId,
    entity_id: ctx.entityId,
    system: 'stripe',
    config: { stripe_user_id: response.stripe_user_id, livemode: response.livemode },
    status: 'connected'
  });

  await storeTokens(integrationId, {
    access_token: response.access_token,
    refresh_token: response.refresh_token
  });

  res.redirect('/launch-health?stripe=connected');
});
```

---

## Day 2: Webhooks + sync

### Webhook endpoint

In Stripe Dashboard → Developers → Webhooks add a connected-account endpoint:

```
POST https://api.elevateos.co/v1/webhooks/stripe
```

Subscribe to:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

### Receiver with signature verification

```js
// src/webhooks/stripe.js
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.get('stripe-signature'),
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: 'Signature failed' });
  }

  // Resolve which connected account this is for
  const integrationId = await resolveByStripeAccount(event.account);

  await db.query(`
    INSERT INTO raw_events (integration_id, event_type, external_id, payload)
    VALUES ($1, $2, $3, $4)
  `, [integrationId, event.type, event.id, event]);

  res.status(200).json({ received: true });
  await queue.add('stripe-normalize', { eventId: row.id });
});
```

### Normalizing payments

`payment_intent.succeeded` events get mapped into `payments` with `source_system = 'stripe'`. The matching to a Dentally patient happens via metadata — when you create the PaymentIntent in Stripe, include:

```js
metadata: {
  practice_id: '...',
  patient_external_id: '...',
  invoice_external_id: '...'
}
```

Without metadata, the payment lands without patient linkage and gets surfaced as an unmatched-payment exception.

---

## Acceptance criteria

- [ ] Connect OAuth flow works for at least one entity
- [ ] Webhook deliveries verify signature successfully
- [ ] A test `payment_intent.succeeded` event creates a `payments` row
- [ ] Refunds reverse the original payment (set `reversed = true`)
- [ ] Patient matching via metadata works · unmatched gets flagged

---

## Out of scope for v1

- Stripe Identity (KYC) integration
- Stripe Terminal (use Dentally's card readers instead)
- Stripe Tax automation
- Marketplace / split payments
