# Testing Protocol

What to test before each deployment + acceptance criteria for each feature.

## Test pyramid

```
                  ▲
                  │     E2E (Playwright) — 10%
                  │     · Critical user flows
                  ╱
                ╱ │
              ╱   │   Integration (Vitest) — 30%
            ╱     │   · API + DB roundtrip
          ╱       │   · Auth + RLS
        ╱         │
      ╱___________│   Unit (Vitest) — 60%
                      · Formulas
                      · Pure functions
                      · React components
```

## What to test before every PR merge

### Backend
```bash
cd backend
npm run typecheck    # zero TS errors
npm run lint         # zero ESLint errors
npm test             # all unit + integration pass
npm run build        # produces dist/
```

### Frontend
```bash
cd frontend
npm run typecheck
npm run lint
npm run build        # produces .next/
```

### CI runs all of the above on every push. Branch protection: cannot merge to `main` without green CI.

---

## Acceptance criteria per feature

### Auth (signup, login, logout)
- [ ] Sign up with valid data → creates org + user with role=owner → redirects to `/dashboard`
- [ ] Sign up with existing email → returns "Email already in use" error
- [ ] Sign up with weak password (< 8 chars) → validation error
- [ ] Login with correct password → redirects to dashboard
- [ ] Login with wrong password → "Invalid credentials" error
- [ ] Forgot password → reset link arrives via email within 30s
- [ ] Reset link works exactly once
- [ ] Sign out → session cleared, redirected to /login
- [ ] Inactive session > 1h → forced re-login on next API call

### Business Health Setup Wizard
- [ ] Step 0 → "Let's start" button advances to Step 1
- [ ] Each field saves to API within 500ms of typing stops (debounced)
- [ ] Completion % updates as fields fill (top-right counter)
- [ ] Stepper at top: click any step → navigates directly (no validation gate)
- [ ] Back/Continue buttons work between steps
- [ ] Step 1: enter revenue 4,590,000 → margin insight appears showing 10%
- [ ] Step 4: cost % totals sum live at bottom; implied margin = 100 - total
- [ ] Step 5: with years=3, multiple=2 → "Required CAGR" shows 25.99%
- [ ] Step 7: Plan4Growth AI insights load within 5s (AI call) — fallback gracefully if API down
- [ ] Step 7: "Complete" button sets `setup_completed=true` AND inserts baseline snapshot AND redirects to /progress
- [ ] Refreshing mid-wizard restores last saved step + data
- [ ] Owner can edit setup; PM/Reception cannot access (403)

### Progress Tracker
- [ ] Empty state (setup_completed=false) → shows CTA to start setup
- [ ] Completed state → renders 3-column hero (baseline / now / target)
- [ ] Each of 8 metric rows shows: baseline, current, current delta %, target, progress %, progress bar
- [ ] Progress bar colour: green ≥70%, amber 35-69%, red <35%
- [ ] CAGR shown in hero matches Step 5 calculation
- [ ] Reception → redirect to /inbox (no access)

### Role-Based Access
- [ ] Logged in as owner → see all 39 pages in sidebar
- [ ] Logged in as practice_manager (no finance grants) → see Operations, Growth, CRM, Patients; finance hidden
- [ ] Logged in as practice_manager (cashflow granted) → see Cash Flow in Finance section
- [ ] Logged in as reception → see only Inbox, Pipeline, Contacts; lands on /inbox
- [ ] Crafting URL to /wealth-net as practice_manager → API returns 403
- [ ] Owner grants finance.profit to PM → PM sees /profit immediately on next page load
- [ ] Role switcher in sidebar (demo only) → switching role updates sidebar + redirects if current page is now restricted

### CRM — Pipeline (Kanban)
- [ ] All 9 status columns visible to PM and owner; only first 3 (CRM-relevant) to reception
- [ ] Drag card from "New" to "Contact attempted" → API call, lead.status updates, card visually moves
- [ ] Each column header shows correct count + £ total (live)
- [ ] "Add lead" button opens modal; submit creates lead + contact
- [ ] Click card → opens lead detail sheet on right
- [ ] Sheet shows: contact info, communications timeline, tasks, notes
- [ ] Stage change → fires workflow trigger if matching workflow exists

### CRM — Inbox
- [ ] Inbox loads conversations sorted by most-recent activity
- [ ] Click conversation → loads full thread in right pane
- [ ] Reply composer pre-fills channel based on thread
- [ ] Send email → appears in thread immediately (optimistic), Postmark MessageID stored
- [ ] Send SMS → Twilio SID stored, delivery_status updates via webhook
- [ ] Inbound email/SMS → appears in inbox within 30s (via webhook)

### Payments
- [ ] Owner can view all payments
- [ ] PM with payments-granted permission can view
- [ ] Reception cannot view (403)
- [ ] "Create payment link" → generates Stripe URL, copies to clipboard
- [ ] Patient pays via link → webhook fires → payment.status = 'settled' within 60s
- [ ] Refund via Stripe → status updates to 'refunded' via webhook

### Pay Runs
- [ ] Only owner can access /pay
- [ ] Create pay run for period → calculates gross/lab/net per associate
- [ ] Negative net → carries forward to next pay run as prev_balance
- [ ] Approve → status='approved', approved_by=user_id, approved_at=now()
- [ ] Mark paid → status='paid'

### Plan4Growth AI AI
- [ ] Chat page loads with 4 starter prompt cards when empty
- [ ] Click starter prompt → fills input, sends
- [ ] Response streams in (or shows "thinking…" if non-streaming)
- [ ] Replies reference user's actual numbers (e.g., "your £459k profit")
- [ ] Token usage tracked per request
- [ ] If trial user exceeds 100k tokens/month → upgrade gate

### Financial pages
- [ ] /profit shows correct P&L using baseline data
- [ ] /valuation shows 3 multiples — confirm matches Dental Elite multipliers
- [ ] /cashflow shows 13 weeks — confirm traffic lights correct
- [ ] /kpiscorecard shows all 23 metrics with traffic lights

### Multi-tenancy
- [ ] Create 2 orgs (A and B) with separate owners
- [ ] Login as A's owner → can only see A's data
- [ ] API request from A's owner for B's lead ID → returns 404 (RLS)
- [ ] Disable Custom Access Token Hook temporarily → all API queries return empty (RLS works)

### Audit log
- [ ] Every mutation creates an audit_log row (create/update/delete)
- [ ] Audit log includes user_id, org_id, ip_address
- [ ] Only owner can view /audit (future feature)
- [ ] Audit log can never be deleted (no DELETE policy on audit_log table)

### File uploads
- [ ] Owner can request presigned S3 URL
- [ ] Upload via presigned URL succeeds
- [ ] Uploaded file is KMS-encrypted (verify via AWS Console)
- [ ] File metadata stored in `files` table with org_id
- [ ] Cross-tenant access blocked (user A cannot download user B's file even with key)

### Workflows
- [ ] Create workflow with trigger "lead_created", 2 steps (email immediately, SMS at +24h)
- [ ] Create new lead → workflow_run created within 1 minute (cron tick)
- [ ] Email sent immediately, recorded in communications
- [ ] After 24h, SMS sent
- [ ] If contact has no email/phone → step skipped, error logged
- [ ] Inactive workflows do not run

---

## End-to-end test scenarios (Playwright)

### Scenario 1: New owner signup → setup → progress
1. Visit `/signup`
2. Fill form: email, password, name, org name
3. Submit → land on dashboard
4. See "Set up Business Health" banner
5. Click → wizard opens at Step 0
6. Click through all 7 steps with realistic data
7. On Step 7, verify insights load
8. Click "Complete" → land on /progress
9. Verify hero shows correct baseline/target
10. Sign out → sign in again → land on /dashboard
11. Banner gone, replaced with "Progress" callout

### Scenario 2: Reception user → CRM only
1. Owner invites a reception user
2. Reception clicks invite link, sets password
3. Logs in → lands on /inbox (not /dashboard)
4. Sidebar shows only CRM section expanded
5. Try to visit /wealth-net manually → 403 page
6. Try to visit /cashflow manually → 403 page
7. Can send email from inbox
8. Can drag lead in pipeline
9. Cannot see /payments (no link in sidebar, 403 if URL crafted)

### Scenario 3: Owner grants finance to PM
1. Owner invites PM user
2. PM logs in → sidebar shows Operations, Growth, CRM (no Finance)
3. Owner visits /team-permissions, toggles "Cash Flow" ON for PM
4. PM refreshes browser (or next API call within 1h) → /cashflow now visible
5. PM clicks /cashflow → loads correctly
6. Owner toggles back OFF → PM's next page load no longer shows /cashflow

---

## Performance acceptance

| Page | Target FCP | Target TTI | Tool |
|---|---|---|---|
| Login | < 1.0s | < 1.5s | Lighthouse |
| Dashboard | < 1.5s | < 2.5s | Lighthouse |
| Pipeline | < 2.0s | < 3.0s | Lighthouse |
| Health Setup | < 1.5s | < 2.0s | Lighthouse |

CI runs Lighthouse against staging on every deploy. PRs that regress > 100ms get a warning.

---

## Security tests

Run before each deployment:

```bash
# Backend: dependency vulnerabilities
cd backend && npm audit --audit-level=high

# Frontend: same
cd frontend && npm audit --audit-level=high

# OWASP ZAP automated scan against staging
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://staging.elevate.app

# Verify HTTPS + headers
curl -I https://app.elevate.app
# Expected: HSTS, X-Content-Type-Options, X-Frame-Options, CSP
```

Quarterly: external pen test (Cobalt or HackerOne).

---

## Definition of done

A feature ships only when:

- [ ] All acceptance criteria pass
- [ ] Unit tests cover happy path + 1 edge case
- [ ] No new ESLint or TS errors
- [ ] No new accessibility issues (run axe-core)
- [ ] Manus brief updated if interface changed
- [ ] API.md updated if endpoint added/changed
- [ ] FORMULAS.md updated if math changed
- [ ] Tested in staging
