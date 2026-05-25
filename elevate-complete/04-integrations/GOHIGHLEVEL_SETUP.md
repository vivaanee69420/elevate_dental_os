# GoHighLevel Setup

Four days. GHL stays the CRM engine in v1 — Elevate is the command layer on top.

**Current state:** zero. No connection exists. This document gets you a working GHL connector with API sync, configurable deep links, and the sidebar-collapse pattern.

---

## Architectural principle

Do **not** rebuild the CRM in Elevate. Don't iframe GHL as a primary integration pattern either — GHL changes their UI often and iframe embedding is fragile. The right pattern is:

- **API sync** for the data Elevate needs to display (leads, opportunities, conversations, tasks)
- **Deep links** for interaction (when the user wants to actually reply or work in the CRM, they open GHL)
- **Sidebar collapse** in Elevate when GHL is open (maximises screen real estate)

This is the pattern in the prototype's "Collapse for GHL" button.

---

## Prerequisites

1. **Confirm whether single-location or agency.** Single-location (one practice's sub-account) → Private Integration Token. Multi-location (the agency / parent) → OAuth marketplace app. v1 uses Private Integration Token.
2. **Get the practice's API key** from GHL: Sub-Account Settings → Business Profile → API Keys → Create New. Save in secrets manager.
3. **Identify the sub-account ID** for each practice. You'll need this for the API base path.

Official references (last verified 25 May 2026):
- HighLevel API overview: https://help.gohighlevel.com/support/solutions/articles/48001060529
- API docs: https://marketplace.gohighlevel.com/docs/

---

## Day 1: HTTP client + auth

### Build the client

`src/connectors/ghl/client.js`:

```js
const axios = require('axios');

function makeClient(integrationId) {
  const apiKey = getSecret(`ghl.${integrationId}.api_key`);
  const locationId = getConfig(`ghl.${integrationId}.location_id`);
  return axios.create({
    baseURL: 'https://services.leadconnectorhq.com',  // GHL API v2 host
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',  // pin a stable API version
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    params: { locationId },
    timeout: 30_000
  });
}
```

### Rate limiting

GHL rate-limits at the location level. Use a `bottleneck` instance per integration capped at 10 req/s. Back off on `429`.

---

## Day 2: Sync jobs

The four collections to mirror:

| GHL object | Endpoint | Elevate table | Frequency |
|---|---|---|---|
| Contacts | `GET /contacts/` | `crm_contacts` | 15 min delta + webhook |
| Opportunities | `GET /opportunities/` | `crm_opportunities` | 15 min delta + webhook |
| Conversations | `GET /conversations/` | `crm_conversations` | 15 min delta + webhook |
| Tasks | `GET /contacts/{id}/tasks` | (mapped to UI tasks) | 30 min |

```js
// src/jobs/ghl-sync.js

cron.schedule('*/15 * * * *', async () => {
  for (const integration of await listGhlIntegrations()) {
    await syncContactsDelta(integration);
    await syncOpportunitiesDelta(integration);
    await syncConversationsDelta(integration);
  }
});

cron.schedule('*/30 * * * *', async () => {
  for (const integration of await listGhlIntegrations()) {
    await syncTasks(integration);
  }
});
```

### Delta sync

Use the `updatedAt` filter:

```js
async function syncContactsDelta(integration) {
  const since = await lastSync(integration.id, 'contacts');
  let cursor = null;
  do {
    const { data } = await client.get('/contacts/', {
      params: {
        startAfter: since.toISOString(),
        limit: 100,
        ...(cursor ? { startAfterId: cursor } : {})
      }
    });
    for (const contact of data.contacts) {
      await upsertContact(integration, contact);
    }
    cursor = data.contacts.at(-1)?.id;
  } while (cursor);
  await markSync(integration.id, 'contacts');
}
```

### Patient matching at ingest

This is the most important part. Every contact gets matched to a patient using the cascade from `DATA_MODEL.md`:

```js
async function matchContactToPatient(orgId, practiceId, contact) {
  const phone = normalizePhone(contact.phone);
  const email = (contact.email || '').toLowerCase().trim();

  if (phone) {
    const { rows } = await db.query(
      `SELECT id FROM patients WHERE practice_id = $1 AND phone = $2 LIMIT 1`,
      [practiceId, phone]
    );
    if (rows[0]) return rows[0].id;
  }
  if (email) {
    const { rows } = await db.query(
      `SELECT id FROM patients WHERE practice_id = $1 AND email = $2 LIMIT 1`,
      [practiceId, email]
    );
    if (rows[0]) return rows[0].id;
  }
  // Fuzzy match → exception queue
  await createMatchFailureException(orgId, practiceId, contact);
  return null;
}
```

---

## Day 3: Webhooks + deep links

### Webhooks

Configure webhooks in GHL: Sub-Account Settings → Integrations → Webhooks. Add:

```
POST https://api.elevateos.co/v1/webhooks/ghl
```

Subscribed events:
- `ContactCreate`, `ContactUpdate`, `ContactDelete`
- `OpportunityCreate`, `OpportunityUpdate`, `OpportunityStatusUpdate`
- `OutboundMessage`, `InboundMessage`
- `TaskCreate`, `TaskComplete`

### Receiver

`src/webhooks/ghl.js`:

```js
router.post('/', express.json(), async (req, res) => {
  const integrationId = await resolveByLocation(req.body.locationId);
  await db.query(`
    INSERT INTO raw_events (integration_id, event_type, external_id, payload, received_at)
    VALUES ($1, $2, $3, $4, now())
  `, [integrationId, req.body.type, req.body.id, req.body]);

  res.status(200).json({ received: true });
  await queue.add('ghl-normalize', { eventId: row.id });
});
```

GHL doesn't sign webhooks consistently across all event types — if signature is provided, verify; otherwise rely on IP allowlisting and the fact that the receiver is HTTPS-only.

### Deep link table

Build the `ghl_deep_links` table day one. For each practice's GHL sub-account, store the URL for each module:

```
inbox       https://app.gohighlevel.com/v2/location/{locationId}/conversations
pipeline    https://app.gohighlevel.com/v2/location/{locationId}/opportunities
calls       https://app.gohighlevel.com/v2/location/{locationId}/conversations?filter=calls
calendar    https://app.gohighlevel.com/v2/location/{locationId}/calendar
workflows   https://app.gohighlevel.com/v2/location/{locationId}/automation/workflows
```

Owners edit these via the Integrations page. **Never hardcode URLs** — GHL sometimes changes paths.

### Deep link UX in Elevate

When the user clicks "Open in GHL" from any CRM page:
1. Fetch `ghl_deep_links` for that practice + module
2. Open in a new tab (or in-app webview if you build a native wrapper later)
3. The Elevate sidebar collapses automatically (see "Collapse for GHL" button in the prototype)

---

## Day 4: GHL-specific Elevate features

### CRM Today page

Tasks shown here are a mix of:
- GHL tasks for the current user
- Elevate-local tasks (created from reconciliation exceptions, etc.)

Merge both into a single list, deduplicated by external ID.

### Lead status mapping

Elevate uses the prototype's pipeline stages:
- `new`, `contact_attempted`, `contact_made`, `consultation_booked`, `consultation_attended`, `treatment_started`, `treatment_completed`, `failed_to_attend`, `not_proceeding`, `paused`

GHL pipeline stages vary per practice. Build a mapping table during onboarding:

```
ghl_stage_mapping(integration_id, ghl_stage_id, elevate_status)
```

If a GHL stage isn't mapped, the opportunity stays in `crm_opportunities.stage` raw but doesn't appear in Elevate's status chips until mapped.

### Call Centre page

The prototype's Call Centre page is a deep link into GHL conversations filtered to phone calls. Don't try to rebuild the call recording UI.

### Reviews & Reputation

GHL has built-in review monitoring across Google Business Profile, Trustpilot, Facebook. Mirror review status (count, average rating, recent reviews) into Elevate's Reviews page but route "respond to review" actions back into GHL via deep link.

---

## What NOT to do

These are tempting but fight the architecture:

- ❌ **Don't iframe GHL.** UI changes break it. CRM apps often block iframe embedding via X-Frame-Options.
- ❌ **Don't proxy GHL through Elevate.** Adds latency and a failure point for no benefit.
- ❌ **Don't replicate GHL workflows.** Workflows stay in GHL. Elevate triggers them via API call when needed.
- ❌ **Don't auto-assume GHL pages render cleanly when embedded.** Even if iframe loads, GHL's own sidebar appears alongside Elevate's, halving usable space.
- ❌ **Don't build a CRM in Elevate.** This is the biggest scope creep risk. Push back when stakeholders ask for it.

---

## Marketplace OAuth path (v1.1+)

Once you outgrow single-location Private Integration Tokens (e.g. you want to multi-tenant across many GM-style groups), build the Marketplace OAuth flow:

1. Register as a HighLevel Marketplace developer
2. Build the OAuth consent UI
3. Each new GM-group customer installs your app from the Marketplace
4. Receive an OAuth token scoped to their agency/location

Don't do this in v1 — Private Integration Token is faster, and GM Dental Group is single-tenant for now.

---

## Acceptance criteria

- [ ] Private Integration Token configured for each practice's GHL sub-account
- [ ] All four objects sync (contacts, opportunities, conversations, tasks)
- [ ] Patient matching runs at ingest · unmatched contacts raise `crm_patient_match_failure`
- [ ] Webhooks deliver and persist to `raw_events`
- [ ] Deep links work for inbox / pipeline / calls / calendar
- [ ] Sidebar collapse on "Open in GHL" works in the prototype
- [ ] Treatment-starts reconciliation control runs and flags GHL won opps without corresponding Dentally starts
