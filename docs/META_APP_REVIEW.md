# Meta App Review — lead retrieval (kickoff checklist)

Goal: let tenants' Meta lead-form leads be fetched directly by Elevate (Sub-project B of
the SaaS push). Today the Meta app only holds `ads_read` (spend sync). Retrieving actual
lead submissions requires **Advanced Access** to additional permissions, which means App
Review + Business Verification. This is the long pole (typically 2–4 weeks) — start it
before the code exists; review is granted against a screencast of the flow, which we can
record in dev mode against our own ad accounts.

## Permissions to request (Advanced Access)

| Permission | Why |
|---|---|
| `leads_retrieval` | Read lead-gen submissions from lead forms |
| `pages_show_list` | List the Pages the user manages (to pick the Page behind the forms) |
| `pages_read_engagement` | Read Page content incl. lead forms metadata |
| `pages_manage_metadata` | Only if/when we add real-time leadgen webhooks (can be a later submission) |
| `ads_read` | Already granted (spend sync) — unchanged |

## Prerequisites (do these first, in Meta Business Manager / developers.facebook.com)

1. **Business Verification** for the Plan4Growth business on the app — legal name,
   registration doc/utility bill, business website with matching domain + visible
   contact details. Required before any Advanced Access is granted.
2. App settings complete: privacy policy URL, app icon (1024px), category, app domain,
   data deletion instructions URL (a simple page on the Elevate site is fine).
3. App must be in **Live** mode at submission time (dev mode is fine while recording,
   but the toggle must be flipped for review).

## Submission contents

- **Screencast** per permission: log in to Elevate → Integrations → connect Meta →
  consent screen showing the requested permissions → the app displaying fetched leads.
  Meta reviewers must see the permission actually used in-product; a dev-mode flow
  against our own ad account satisfies this.
- **Step-by-step test instructions** + a test login for the reviewers (a scratch org on
  staging with a Meta test account connected).
- **Use-case text**: "Multi-tenant dental practice-management SaaS. Practice owners
  connect their own Meta ad accounts; the platform retrieves their lead-form
  submissions so front-desk staff can follow up. Leads are stored per-organisation and
  never shared across customers."

## Notes for the build (Sub-project B spec will detail)

- One approved app covers all tenants: each tenant OAuths through it and grants the
  permissions on their own Pages/ad accounts.
- Lead reads need a **Page access token** (derived from the user token via
  `/me/accounts`), not the ad-account user token we store today — provider change.
- Dev mode already returns real data for our own accounts — build and screencast
  without waiting for approval.
- Polling: `GET /{form_id}/leads` (or `/{page_id}/leadgen_forms` → forms → leads),
  filterable by `filtering=[{field:'time_created',operator:'GREATER_THAN',value:<ts>}]`.
  Webhooks (`leadgen` topic) are a later enhancement.
