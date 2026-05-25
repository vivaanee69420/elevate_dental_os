# Permissions Model

Role-based access control with five roles, page-level permissions, and practice-level data scope.

The five roles map directly to GM Dental Group's org chart. Add a new role only when it's structurally different — not just a different person.

---

## Roles

| Role code | Label | Description |
|---|---|---|
| `owner` | Owner | Full access. Wealth + Launch Control + admin config all visible. |
| `practice_manager` | Practice Manager | Operational + CRM + Compliance + most Finance summary. No Wealth, no admin. |
| `reception` | Reception | Inbox + Leads + Today + Lead detail. CRM-only role. |
| `clinician` | Clinician | Own patients + own diary + Training + CPD. No commercial data. |
| `finance_lead` | Finance Lead | Finance full + Reconciliation + Board Pack. No CRM detail, no Wealth, no patient PII beyond AR. |

---

## Page access matrix (default)

This is the seed permissions matrix. Owners can edit it in-app via the Permissions page.

Legend: ✅ visible · 👁 read-only · ❌ hidden

| Page area | Owner | PM | Reception | Clinician | Finance |
|---|:---:|:---:|:---:|:---:|:---:|
| **Overview** |  |  |  |  |  |
| Command Centre | ✅ | ✅ | ❌ | ❌ | ✅ |
| AI Insights | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mastermind AI | ✅ | ✅ | ❌ | ❌ | ❌ |
| Alerts | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Finance** |  |  |  |  |  |
| Finance Pro | ✅ | ❌ | ❌ | ❌ | ✅ |
| Practice IQ | ✅ | 👁 | ❌ | ❌ | ✅ |
| Unified Dashboard | ✅ | 👁 | ❌ | ❌ | ✅ |
| Cash Flow Insights | ✅ | ❌ | ❌ | ❌ | ✅ |
| Practice IQ Manager | ✅ | ✅ | ❌ | ❌ | ✅ |
| Profit & Loss | ✅ | ❌ | ❌ | ❌ | ✅ |
| Patient Payments | ✅ | 👁 | ❌ | ❌ | ✅ |
| KPI Scorecard | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Ops** |  |  |  |  |  |
| Operations Hub | ✅ | ✅ | ❌ | 👁 | ❌ |
| Associates | ✅ | ✅ | ❌ | ❌ | 👁 |
| Scheduling | ✅ | ✅ | 👁 | 👁 (own) | ❌ |
| Associate Pay | ✅ | ❌ | ❌ | ❌ | ✅ |
| Chair Utilisation | ✅ | ✅ | ❌ | ❌ | ❌ |
| Treatments / Treatment Master | ✅ | ✅ | ❌ | 👁 | ❌ |
| UDA Tracker | ✅ | ✅ | ❌ | 👁 (own) | ✅ |
| **Growth** |  |  |  |  |  |
| Marketing Pro | ✅ | ❌ | ❌ | ❌ | ❌ |
| Marketing OS Hub | ✅ | ✅ | ❌ | ❌ | ❌ |
| Pipeline & Leads | ✅ | ✅ | ✅ | ❌ | ❌ |
| CRM Today | ✅ | ✅ | ✅ | ❌ | ❌ |
| Inbox | ✅ | ✅ | ✅ | ❌ | ❌ |
| Call Centre | ✅ | ✅ | ✅ | ❌ | ❌ |
| Reviews | ✅ | ✅ | ❌ | ❌ | ❌ |
| Patients | ✅ | ✅ | ❌ | ✅ (own) | 👁 |
| **Wealth** (owner only) |  |  |  |  |  |
| Wealth Pro | ✅ | ❌ | ❌ | ❌ | ❌ |
| Wealth Builder | ✅ | ❌ | ❌ | ❌ | ❌ |
| Net Worth | ✅ | ❌ | ❌ | ❌ | ❌ |
| Practice Valuations | ✅ | ❌ | ❌ | ❌ | ❌ |
| Property / Pensions / Other / Exit | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Training** |  |  |  |  |  |
| Module Library / My Modules | ✅ | ✅ | ✅ | ✅ | ✅ |
| Mentorship Calls | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Compliance** |  |  |  |  |  |
| Compliance Pro | ✅ | ✅ | ❌ | ❌ | ❌ |
| Compliance Hub | ✅ | ✅ | 👁 | 👁 | ❌ |
| CPD Tracker | ✅ | ✅ | ❌ | ✅ (own) | ❌ |
| Audits / Incidents / Breaches | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Rota** |  |  |  |  |  |
| HR Pro | ✅ | ✅ | ❌ | ❌ | ❌ |
| Rota Hub / Calendar | ✅ | ✅ | 👁 | 👁 (own) | ❌ |
| Leave | ✅ | ✅ | ✅ (own) | ✅ (own) | ❌ |
| **System** |  |  |  |  |  |
| Settings Hub | ✅ | ❌ | ❌ | ❌ | ❌ |
| Data Hub | ✅ | ❌ | ❌ | ❌ | ✅ |
| Integrations | ✅ | ❌ | ❌ | ❌ | ❌ |
| Permissions | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Launch Control** (owner-only by default) |  |  |  |  |  |
| Launch Readiness | ✅ | ❌ | ❌ | ❌ | ❌ |
| Integration Health | ✅ | ✅* | ❌ | ❌ | ✅ |
| Data Reconciliation | ✅ | ❌ | ❌ | ❌ | ✅ |
| Manual Feed Manager | ✅ | ✅* | ❌ | ❌ | ✅ |
| Board Pack & QoE | ✅ | ❌ | ❌ | ❌ | ✅ |
| Security & Audit | ✅ | ❌ | ❌ | ❌ | ❌ |

*PM access to Integration Health and Manual Feed Manager is optional — granted only when the PM is operationally responsible for uploads at their practice.

---

## Data scope

Even if a role can *view* a page, they only see records for practices they have access to (`user_practice_access` table). Owners see all practices in the organization.

A clinician sees:
- Own appointments only (`appointments.practitioner_id = current_user.practitioner_id`)
- Own patients only (patients linked via own appointments / treatment plans)
- Own CPD
- The shared training library

A reception sees:
- All leads / inbox / pipeline for their assigned practices
- No financial data
- No clinical detail beyond appointment status

---

## Enforcement

Three layers, all required. None is sufficient on its own.

### 1. UI gate (prototype-level)
`canAccessPage(pageId)` in the HTML checks the user's role. Hides the nav link and renders a `🔒 Not authorised` page if the user navigates directly via URL.

This is convenience only — never trust the client.

### 2. API gate (middleware)
`src/auth/middleware.js`:

```js
function requirePermission(pageId) {
  return async (req, res, next) => {
    const allowed = await permissionsCache.canAccess(req.user.role_id, pageId);
    if (!allowed) {
      await audit.log({ action: 'access_denied', actor_id: req.user.id, object_type: 'page', object_id: pageId });
      return res.status(403).json({ error: { code: 'forbidden', message: 'Access denied' } });
    }
    return next();
  };
}
```

Apply to every protected route:

```js
app.get('/v1/finance/pnl', requireAuth, requirePermission('profit'), getPnL);
```

### 3. Query gate (data scope)
Every query that returns practice-scoped data must filter by `user_practice_access`:

```sql
SELECT *
FROM appointments a
WHERE a.practice_id IN (
  SELECT practice_id FROM user_practice_access WHERE user_id = $1
  UNION
  SELECT id FROM practices WHERE organization_id = $2 AND $3 = 'owner'
);
```

Wrap in a helper so it's automatic, not a per-query reminder.

---

## Wealth: owner-only forever

`Wealth` is owner-only and the API never returns Wealth data to any other role, even with elevated permissions toggled in the UI. This is a hard rule encoded server-side.

```js
if (PAGE_META[pageId].owner_only && req.user.role !== 'owner') {
  return res.status(403).json({ error: { code: 'wealth_owner_only' } });
}
```

The UI's Permissions editor refuses to expose Wealth pages — they're filtered out of the editable matrix.

---

## Token lifetime

- Access token: 30 minutes
- Refresh token: 14 days
- MFA verification: re-required if the session is older than 12 hours
- Owner-only pages: re-MFA on entry to Wealth or Launch Control

---

## Change log

Every change to permissions writes an audit event with the diff:

```json
{
  "action": "permission_change",
  "actor_id": "<owner uuid>",
  "object_type": "role_permissions",
  "object_id": "<role uuid>",
  "metadata": {
    "role_code": "practice_manager",
    "page_id": "finance-pro",
    "before": { "can_view": false, "can_edit": false },
    "after":  { "can_view": true,  "can_edit": false }
  }
}
```
