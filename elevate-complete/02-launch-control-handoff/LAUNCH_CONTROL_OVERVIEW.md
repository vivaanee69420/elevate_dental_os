# 05 · Launch Control

The trust layer that makes the prototype launch-ready.

This folder contains the implementation handoff for everything in the new **Launch Control** section of the app (red `Launch` button at the bottom of the sidebar).

---

## What the section adds to the app

| Page in app | What it does | Source data / control |
|---|---|---|
| Launch Readiness | Go-live score · 8-stage implementation checklist · acceptance criteria · v1 boundaries | See `DATA_CONNECTION_PLAYBOOK.md` · *Delivery Order* + *Go-Live Acceptance Criteria* |
| Integration Health | Connector sync status · webhook delivery log · token / OAuth health | `DATA_CONNECTION_PLAYBOOK.md` · *Dentally / Xero / QuickBooks* sections |
| Data Reconciliation | Dentally-to-accounting controls · open exception queue · approved exception categories | `DATA_CONNECTION_PLAYBOOK.md` · *Reconciliation Rules* |
| Manual Feed Manager | Five CSV templates · upload rules · approval gates · audit trail | `manual-feed-templates/` (this folder) |
| Board Pack & QoE | 10-section monthly pack · Quality-of-Earnings add-backs · investor-readiness checklist | Owner + Finance workflow |
| Security & Audit | MFA · RBAC · audit log · secrets · retention · incident response | `DATA_CONNECTION_PLAYBOOK.md` · *Security And Compliance Baseline* |

All six pages are **owner-only by default**. Practice Managers can be granted `Integration Health` and `Manual Feed Manager` via the existing `Permissions` page if needed.

---

## Files

- `DATA_CONNECTION_PLAYBOOK.md` — implementation-ready handoff: Dentally · Xero · QuickBooks · GHL · reconciliation · security baseline · delivery order · go-live acceptance criteria.
- `INTEGRATION_REPORT.md` — shorter strategic summary of the same scope.
- `manual-feed-templates/` — five fallback CSV templates plus their README:
  - `monthly_financials_template.csv`
  - `appointments_template.csv`
  - `payments_template.csv`
  - `treatment_plans_template.csv`
  - `leads_template.csv`

---

## How this fits with the original bundle

The original bundle (folders `00`–`04`) is **unchanged**. This section sits alongside it as a launch-readiness addendum:

- `01-build/elevate-dental-os.html` — the same single-file app, now with the new Launch Control nav section and six pages already wired in.
- `02-data-dictionary/` — unchanged.
- `03-source-chunks/` — unchanged.
- `04-industry standard-research/` — unchanged.
- `05-launch-control/` — **new** · launch trust layer docs + manual feed templates.

No features were removed from the original. Launch Control was added on top.

---

## Delivery order (from the playbook)

1. Freeze canonical entity, practice and role model.
2. Ship Dentally read sync and webhook receiver.
3. Ship Xero **or** QuickBooks per entity (not both for the same ledger).
4. Build reconciliation tables and approval flow.
5. Wire GoHighLevel CRM mirror.
6. Add manual-feed ingestion as fallback.
7. Run UAT with one real practice before group rollout.

**Go-live only when** all seven acceptance criteria in the playbook are green for two consecutive weekly checks.
