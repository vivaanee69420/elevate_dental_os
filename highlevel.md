# highlevel.md

This document outlines the complete implementation plan for integrating **GoHighLevel (GHL)** with **Elevate Dental OS**. It covers both the fully automated OAuth sync flow and the fallback manual data entry mode inside the Elevate CRM tabs, detailing all edge cases and their mitigation strategies.

---

## 1. Executive Summary & Goal

Elevate Dental OS aims to provide dental practices with a premium CRM workspace. Many practices use GoHighLevel for lead generation, landing pages, and automated outreach. To avoid double-entry, Elevate needs a seamless integration.

### Goals
1. **OAuth 2.0 GoHighLevel Integration**: Allow practice owners to securely connect their GHL location.
2. **Bi-directional/Inbound Sync**: Automatically sync GHL Opportunities and Contacts into Elevate's `leads` and `contacts` tables.
3. **Manual CRM Mode**: For practices not using GHL (or choosing not to connect it), provide robust, premium manual forms to add, edit, and advance leads through the CRM pipeline.
4. **Coexistence & Conflict Resolution**: Support a hybrid approach where manual data entry and GHL sync do not create duplicates, overwrite user changes, or cause data leakage.

---

## 2. Architecture & Data Flow

```
+─────────────────────────────────────────────────────────────────────────+
|                           ELEVATE FRONTEND                              |
|   - CRM Settings: Connect GHL button / status / mapping interface       |
|   - Pipeline/Enquiries: Add/Edit Lead modals (Manual or GHL-synced)     |
+────────────────────────────────────┬────────────────────────────────────+
                                     │
                                     ▼
+─────────────────────────────────────────────────────────────────────────+
|                           ELEVATE BACKEND                               |
|   - Express integrations router & oauth callback                        |
|   - GHL Provider (authorize, callback, refresh, sync)                   |
|   - Webhook controller (POST /api/integrations/gohighlevel/webhook)     |
+────────────────────────────────────┬────────────────────────────────────+
                                     │
                                     ▼
+─────────────────────────────────────────────────────────────────────────+
|                           SUPABASE DATABASE                             |
|   - integrations (encrypted credentials, GHL location_id)               |
|   - contacts & leads (pms_external_id / ghl_opportunity_id)             |
+─────────────────────────────────────────────────────────────────────────+
```

---

## 3. Database Modifications

To track GoHighLevel-specific entities without polluting generic fields, we will create a migration `20260101000012_gohighlevel_integration.sql`.

```sql
-- Add GoHighLevel mappings to contacts
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_ghl_id 
  ON contacts(organisation_id, ghl_contact_id) 
  WHERE ghl_contact_id IS NOT NULL;

-- Add GoHighLevel mappings to leads
ALTER TABLE leads 
  ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_pipeline_id TEXT,
  ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'synced' CHECK (sync_status IN ('synced', 'manual', 'pending_sync'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_ghl_opportunity 
  ON leads(organisation_id, ghl_opportunity_id) 
  WHERE ghl_opportunity_id IS NOT NULL;

-- Add configuration storage for pipeline stage mappings
-- e.g. config: { stage_mappings: { "ghl_stage_id_1": "contact_made" } }
```

---

## 4. Backend Implementation Plan

### A. GoHighLevel OAuth Provider (`gohighlevel-provider.js`)
We will create a custom provider in `backend/src/lib/integrations/gohighlevel-provider.js` to implement GHL's specific OAuth 2.0 parameters.

#### Flow Highlights:
1. **Authorize**: Redirects user to GHL's chooser screen:
   `https://marketplace.leadconnectorhq.com/oauth/chooselocation?response_type=code&client_id=...&redirect_uri=...&scope=contacts.readonly+contacts.write+opportunities.readonly+opportunities.write&state=...`
2. **Callback**: Exchanges authorization code for `access_token` and `refresh_token`. It fetches the GHL `locationId` (and `companyId` if agency app) and saves it to the `config` column.
3. **Symmetric Encryption**: The `access_token` and `refresh_token` are encrypted at rest via `encryptSecret()` in `crypto.js` and stored in the database.

```javascript
// backend/src/lib/integrations/gohighlevel-provider.js
import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret } from '../crypto.js';

const GHL_CLIENT_ID = process.env.GHL_CLIENT_ID;
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

export const GoHighLevelProvider = {
  async authorize(orgId) {
    if (!GHL_CLIENT_ID) throw new Error('GHL_CLIENT_ID is not configured');
    const state = Buffer.from(JSON.stringify({ orgId, provider: 'gohighlevel', ts: Date.now() })).toString('base64url');
    
    const url = new URL('https://marketplace.leadconnectorhq.com/oauth/chooselocation');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', GHL_CLIENT_ID);
    url.searchParams.set('scope', 'contacts.readonly contacts.write opportunities.readonly opportunities.write');
    url.searchParams.set('redirect_uri', `${APP_URL}/api/integrations/gohighlevel/callback`);
    url.searchParams.set('state', state);

    await integrationsRepository.upsert(orgId, 'gohighlevel', { status: 'pending' });
    return { redirectUrl: url.toString() };
  },

  async callback(orgId, { code }) {
    if (!GHL_CLIENT_ID || !GHL_CLIENT_SECRET) throw new Error('GoHighLevel OAuth env vars missing');
    
    const res = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GHL_CLIENT_ID,
        client_secret: GHL_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${APP_URL}/api/integrations/gohighlevel/callback`,
        user_type: 'Location',
      }).toString(),
    });

    const body = await res.json();
    if (!res.ok) {
      await integrationsRepository.markFailed(orgId, 'gohighlevel', body.error_description ?? 'oauth_failed');
      throw new Error(body.error_description ?? 'GoHighLevel OAuth exchange failed');
    }

    await integrationsRepository.upsertSecrets(orgId, 'gohighlevel', {
      config: {
        locationId: body.locationId,
        companyId: body.companyId,
        scope: body.scope,
      },
      secrets: encryptSecret(JSON.stringify({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      })),
      status: 'active',
      verified_at: new Date().toISOString(),
      expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
    return { ok: true };
  },

  async refresh(orgId) {
    // Standard OAuth token refresh using the encrypted refresh_token
    // Generates a new access token and a single-use refresh token, saving both immediately.
  },

  async revoke(orgId) {
    await integrationsRepository.markRevoked(orgId, 'gohighlevel');
    return { ok: true };
  },

  async sync(orgId) {
    // Scheduled/forced pull sync of opportunities and contacts
  }
};

registerProvider(
  { id: 'gohighlevel', label: 'GoHighLevel', authStyle: 'oauth', category: 'marketing' },
  GoHighLevelProvider
);
```

### B. Background Sync Script (`gohighlevel-sync.js`)
We will create a worker script `backend/src/workers/gohighlevel-sync.js` which is invoked by a cron job (every hour) to reconcile leads.

#### Sync Flow (Inbound from GHL):
1. Load active GoHighLevel integrations.
2. Decrypt `access_token` and verify expiration. Auto-refresh if expired.
3. Fetch recently updated opportunities from GHL API V2 (`GET /opportunities?locationId=...&limit=100`).
4. For each opportunity:
   - Check if contact already exists in Elevate database (via `ghl_contact_id`, fallback to `phone` or `email`).
   - If not found, create contact in `contacts` table.
   - Upsert opportunity into the `leads` table mapping:
     - `ghl_opportunity_id` -> `leads.ghl_opportunity_id`
     - Status -> Map GHL stage ID to Elevate's `leads.status` (via user mappings or default fallback).
     - Monetary value -> Map GHL opportunity value to `leads.estimated_value_pence` (converting currency to pence).
     - UTM metrics (`utm_source`, `utm_medium`, etc.) -> `leads` UTM columns.

---

## 5. Frontend & UI Design (Elevate CRM Tab)

### A. Integrated View & Connected Badge
When GoHighLevel is connected, the CRM interface should display a visual indicator that leads are automatically syncing. 

```
┌────────────────────────────────────────────────────────────────────────┐
│  CRM Pipeline                                      [ + Add Lead ]      │
│  [✓ Synced with GoHighLevel] Last updated: 10 mins ago                 │
├────────────────────────────────────────────────────────────────────────┤
│  NEW                │ CONTACT ATTEMPT      │ CONTACT MADE              │
│  ┌────────────────┐ │ ┌──────────────────┐ │ ┌──────────────────────┐  │
│  │ John Doe       │ │ │ Sarah Smith       │ │ │ James Carter         │  │
│  │ £4,500         │ │ │ £3,200           │ │ │ £6,000               │  │
│  │ [GHL Synced]   │ │ │ [Manual Entry]   │ │ │ [GHL Synced]         │  │
│  └────────────────┘ │ └──────────────────┘ │ └──────────────────────┘  │
└─────────────────────┴──────────────────────┴──────────────────────────┘
```

### B. Manual Data Entry Flow (Create / Edit Lead Modal)
Regardless of GHL connection status, practices need manual fallback abilities (e.g. walk-ins, phone calls).

1. **Add Lead Modal**:
   - Provide a toggle or clean selector: `Source: Manual Data Entry` vs `Sync with GoHighLevel`.
   - Form fields: First Name, Last Name, Phone, Email, Treatment, Expected Value, Initial Pipeline Stage, Lead Source.
   - On submission, write directly to the local PostgreSQL database:
     - Save contact details in `contacts` (or join existing contact).
     - Save lead details in `leads` setting `sync_status = 'manual'`.
2. **GHL Sync Lock**:
   - If a lead was imported from GHL (`ghl_opportunity_id` is present), disable direct modification of fields mastered by GHL (like Pipeline Stage) to prevent merge overrides. 
   - Instead, show a warning banner: *"This lead is managed by GoHighLevel. Update the pipeline stage in GHL to change it here."* or permit local updates and queue a push back to GHL (optional).

---

## 6. Edge Cases & Mitigation Strategies

### Edge Case 1: Refresh Token Expiration & Desynchronisation
*   **Problem**: GHL refresh tokens are single-use and valid only for a limited window. If a cron job fails or network drops during a refresh, the system is left with an invalid refresh token, resulting in authorization lock.
*   **Mitigation**: 
    1. Implement a database lock (e.g. `SELECT FOR UPDATE`) on the `integrations` table during the token refresh process to prevent race conditions from concurrent worker calls.
    2. Store the timestamp of the last successful token exchange.
    3. If the token refresh request fails with an invalid grant or expired credentials error, update the integration status in the database to `'error'` and record the failure context in the `last_error` field.
    4. Display a warning notification banner on the frontend CRM pages for owners: *"GoHighLevel connection expired. Please reconnect to resume automatic lead sync."*

### Edge Case 2: Custom GHL Pipeline Stages Mapping
*   **Problem**: GoHighLevel locations have bespoke pipeline stages (e.g., "Facebook Lead Out reached", "TCO consultation"). Elevate has standard stages (`new`, `contact_attempted`, `contact_made`, `consultation_booked`, `consultation_attended`, `treatment_started`, `treatment_completed`, `not_proceeding`, `failed_to_attend`).
*   **Mitigation**:
    - Under `CRM Settings -> Integrations -> GoHighLevel`, when connected, load GHL pipelines dynamically via the GHL API.
    - Provide a mapping UI: a list of GHL stages, each with a dropdown to map it to one of Elevate's standard stages.
    - Default back to a heuristic match (e.g. stage names containing "booked" map to `consultation_booked`, "won" or "started" map to `treatment_started`).
    - Store this mapping in `integrations.config.stage_mappings`.

### Edge Case 3: Contact Matching & De-duplication
*   **Problem**: A lead is manually entered into Elevate CRM (e.g., a phone call enquiry), and later GHL webhooks deliver the same contact from an online landing page.
*   **Mitigation**:
    - When GHL delivers a contact, search Elevate's database using the following priority:
      1. Matching `ghl_contact_id`
      2. Matching `email` (exact case-insensitive)
      3. Matching normalized `phone` numbers (removing whitespaces and international prefixes).
    - If a contact match is found, link the new GHL opportunity to the *existing* contact instead of creating a duplicate.
    - If a lead already exists for that contact with the same treatment type, flag it for manual review or merge the opportunities rather than opening a duplicate pipeline card.

### Edge Case 4: GHL Rate Limits (API V2)
*   **Problem**: GoHighLevel rate limits requests at 100 requests per 10 seconds. In large practices with thousands of leads, bulk syncing will cause rate limit errors (`429`).
*   **Mitigation**:
    - Build a task queue using a delay handler.
    - If GHL returns a `429 Too Many Requests`, catch the exception, extract the `retry-after` header, pause sync operations, wait the specified time (plus a 500ms safety buffer), and retry.

### Edge Case 5: Deleted Opportunities in GHL
*   **Problem**: An opportunity is deleted or moved to trash in GHL.
*   **Mitigation**:
    - A hard delete in Elevate would break financial valuation reports and historical logs.
    - If GHL notifies that an opportunity is deleted (or it's no longer returned in the active list), update its status in Elevate to `not_proceeding` or archive it via a soft-delete column, rather than dropping the database row.

---

## 7. Action Items & Checklist

### Phase 1: Database & Backend Foundation
- [ ] Run migration `20260101000012_gohighlevel_integration.sql` adding GHL fields to `leads` and `contacts`.
- [ ] Create `gohighlevel-provider.js` under `backend/src/lib/integrations/`.
- [ ] Register the new provider inside `backend/src/lib/integrations/index.js`.
- [ ] Set up GHL environment variables (`GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`) in `.env`.

### Phase 2: Sync Engine & Webhook
- [ ] Write token refresh logic with locking protection.
- [ ] Implement sync controller to poll opportunities and contacts.
- [ ] Map GHL opportunity status/stages to Elevate's native CRM enum.
- [ ] Register webhook endpoint `POST /api/integrations/gohighlevel/webhook` to handle real-time GHL triggers.

### Phase 3: Frontend Integration
- [ ] Update `IntegrationsScreen.tsx` to display GoHighLevel.
- [ ] Create a GoHighLevel mapping screen in `crm-settings` to configure custom pipeline stage transitions.
- [ ] Add the `Add Lead` modal on the Pipeline / Enquiries page for manual data entry.
- [ ] Add GHL badges, sync status text, and locked edit fields to the CRM interface.

### Phase 4: Testing & Edge Case Verification
- [ ] Mock GHL API calls and verify token exchange and refresh loops.
- [ ] Test contact matching heuristics (identical email, slightly different phone formatting).
- [ ] Test rate limiting handling with a simulated 429 response.
