# UAT Checklist

Run with the pilot practice (Ashford) before promoting to the rest of the group.

Each row: tester signs and dates when the case passes.

---

## Authentication

| # | Test | Expected | Pass? | Date | By |
|---|---|---|---|---|---|
| A1 | Owner login with correct credentials | Lands on dashboard | | | |
| A2 | Owner login with wrong password | 401 + "invalid credentials" | | | |
| A3 | 5 failed logins in 10 min | Account locked, email sent | | | |
| A4 | MFA prompt appears after password | Yes | | | |
| A5 | Wrong MFA code | 401 + retry | | | |
| A6 | Right MFA code | Lands on dashboard | | | |
| A7 | Re-MFA prompt after 12h | Yes | | | |
| A8 | Re-MFA prompt entering Wealth | Yes | | | |
| A9 | Logout clears cookie | Yes | | | |

## RBAC

| # | Test | Expected | Pass? |
|---|---|---|---|
| R1 | Reception user logs in | Sees Inbox / Pipeline / Today only | |
| R2 | Reception navigates to `/profit` URL | 403 | |
| R3 | Reception navigates to `/wealth` URL | 403 | |
| R4 | Clinician sees only own diary | Yes | |
| R5 | Practice Manager edits permissions | 403 (owner only) | |
| R6 | Owner edits permissions | Saved + audit row | |
| R7 | Permission change reflects on affected user's next page load | Yes | |

## Finance

| # | Test | Expected | Pass? |
|---|---|---|---|
| F1 | Open Finance Pro for Ashford | P&L renders | |
| F2 | Numbers match Xero report | Exact | |
| F3 | Switch to Rochester | Different numbers, same UI | |
| F4 | Cash Flow Insights → Run-out Detector | 26-week projection chart visible | |
| F5 | Valuation page | TTM EBITDA + multiple shown | |
| F6 | Drill down on a revenue row | Transaction list opens | |

## Clinical

| # | Test | Expected | Pass? |
|---|---|---|---|
| C1 | Dashboard shows today's appointments | Yes, ≤60s after Dentally change | |
| C2 | Patient search by name | Returns matching patients | |
| C3 | Chair utilisation page | Shows real percentages, not sample | |
| C4 | DNA / FTA rate | Matches Dentally manual calc | |
| C5 | Associate productivity | Per-associate revenue + hours | |

## CRM

| # | Test | Expected | Pass? |
|---|---|---|---|
| M1 | Inbox shows recent GHL conversations | Yes | |
| M2 | New lead in GHL appears within 15 min | Yes | |
| M3 | "Open in GHL" deep-links to correct sub-account | Yes | |
| M4 | Sidebar collapses when GHL opens | Yes | |
| M5 | Pipeline shows correct stage counts | Match GHL exactly | |

## Launch Control

| # | Test | Expected | Pass? |
|---|---|---|---|
| L1 | Launch Readiness page lists 8 stages with status | Yes | |
| L2 | Integration Health shows last sync time per connector | Yes | |
| L3 | "Test connection" button works for Xero | Returns success | |
| L4 | Trigger `cash_received` reconciliation | Run row appears | |
| L5 | Open exceptions queue | Shows any breaches | |
| L6 | Resolve an exception | Status changes + audit row | |
| L7 | Sign off a green run | Run becomes immutable | |

## Manual Feed

| # | Test | Expected | Pass? |
|---|---|---|---|
| U1 | Upload valid monthly_financials.csv | Status: pending | |
| U2 | Upload CSV with bad rows | Validation errors shown per row | |
| U3 | Approve upload as owner | Rows promote to normalized tables | |
| U4 | Uploader cannot also approve | UI disables button + API 403 | |
| U5 | Audit row written for upload and approval | Both visible in `/audit-logs` | |

## Board Pack

| # | Test | Expected | Pass? |
|---|---|---|---|
| B1 | Create draft for closed month | Pack appears with sections | |
| B2 | Add QoE add-back | Reflected in normalized EBITDA | |
| B3 | Sign off | PDF generated | |
| B4 | Cannot sign off if exceptions open | Blocked | |

## Performance

| # | Test | Expected | Pass? |
|---|---|---|---|
| P1 | Dashboard first paint | < 2 seconds | |
| P2 | Page navigation | < 500ms | |
| P3 | API p95 latency under load test (50 concurrent users) | < 1500ms | |
| P4 | Webhook receiver handles 100 events in 1 minute | All processed within 5 min | |

## Disaster recovery

| # | Test | Expected | Pass? |
|---|---|---|---|
| D1 | Restore DB from PITR snapshot into staging | < 60 min | |
| D2 | Application survives 1 app instance failure | LB routes around | |
| D3 | Application survives Redis restart | Queue resumes, no data loss | |
| D4 | Application survives DB failover (Multi-AZ) | < 30s downtime | |

---

## Sign-off

This checklist is signed off by:

- Owner (Gaurav Mehta): __________________ Date: __________
- Finance lead: ____________________________ Date: __________
- Engineering lead: ________________________ Date: __________

Only after all P0 rows in this checklist pass and the above is signed: production go-live can proceed.
