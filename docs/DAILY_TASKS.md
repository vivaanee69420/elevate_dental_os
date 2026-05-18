# 10-Day Build Schedule — Mon-Fri, May 19 to May 30, 2026

**Hours/day:** 8 hours per developer (9:00-17:00 UK with 1hr lunch)
**Total:** 80 hours per developer × 3 = 240 dev-hours
**Output:** Full working Elevate Dental OS by Friday 30 May

Each day has a **Maryam track**, **Nikhil track**, and **Ruhith track** running in parallel.

---

## WEEK 1 — Foundations (19-23 May)

### MONDAY 19 MAY — Infrastructure Day

**9:00 AM standup:** Confirm everyone has the handoff package, Vercel/Railway/Supabase/AWS accounts ready

#### Maryam (Tech lead)
- 9:15-10:30: Set up Supabase project (`elevate-prod` + `elevate-dev`)
- 10:30-12:00: Run `db/schema.sql` migration on both projects
- 13:00-14:30: Set up GitHub repo `elevate-dental-os` with branch protection on `main`
- 14:30-16:00: Initialize Next.js 14 app in `apps/web/` with Tailwind + shadcn/ui
- 16:00-17:00: Push initial commit, deploy to Vercel dev environment
- **EOD deliverable:** `dev.elevate.app` shows Next.js welcome page

#### Nikhil (Frontend + DevOps)
- 9:15-11:00: Set up Vercel account, link GitHub repo
- 11:00-12:00: Configure custom domain `app.elevate.app` + DNS
- 13:00-15:00: Set up GitHub Actions CI workflow (`.github/workflows/ci.yml`)
- 15:00-17:00: Build the design system file (`packages/ui/`) with all CSS variables from the prototype
- **EOD deliverable:** CI runs green on every PR; design tokens documented

#### Ruhith (Backend + AWS)
- 9:15-11:00: Set up Railway account, link GitHub
- 11:00-12:00: AWS S3 bucket `elevate-files-eu-west-2` with KMS encryption
- 13:00-15:00: Initialize Fastify app in `apps/api/` with TypeScript + Zod
- 15:00-17:00: Deploy stub `/healthcheck` endpoint to Railway
- **EOD deliverable:** `api.elevate.app/healthcheck` returns 200 OK

**EOD report by 17:15:** All three deliverables ✓ → green. Any not ✓ → blocker, escalate to Gaurav.

---

### TUESDAY 20 MAY — Auth + Database

#### Maryam
- 9:15-12:00: Implement Supabase Auth flows (sign up, sign in, forgot password, magic link)
- 13:00-15:00: Build the **Custom Access Token Hook** that injects `organisation_id` into JWT (CRITICAL — without this, RLS returns zero rows)
- 15:00-17:00: Test multi-tenant isolation — create 2 test orgs, verify data scoped
- **EOD deliverable:** Auth working end-to-end with tenant isolation

#### Nikhil
- 9:15-12:00: Build login + signup pages from the prototype design
- 13:00-15:00: Build the protected app shell (sidebar nav, top bar, content area)
- 15:00-17:00: Wire up navigation routing for all 39 page slugs (404 stub for unbuilt ones)
- **EOD deliverable:** Can log in, see the full sidebar, click nav items

#### Ruhith
- 9:15-12:00: Run `db/schema.sql` on prod Supabase + apply `db/rls.sql`
- 13:00-15:00: Build `apps/api/src/middleware/auth.ts` — validates Supabase JWT
- 15:00-17:00: Build `apps/api/src/middleware/audit.ts` — logs every mutation to `audit_log` table
- **EOD deliverable:** Auth middleware + audit log working

---

### WEDNESDAY 21 MAY — Business Health Setup (THE core feature)

**This is the day. The setup wizard is the most important feature.**

#### Maryam
- 9:15-12:00: Build the 7-step setup wizard frontend (use code in `frontend/pages/healthsetup.tsx`)
- 13:00-15:00: Build the `/api/health` endpoints (GET, PUT)
- 15:00-17:00: Build the snapshot capture endpoint `/api/health/snapshot`
- **EOD deliverable:** Setup wizard works end-to-end, saves to DB

#### Nikhil
- 9:15-12:00: Build the dashboard banner that shows setup % complete
- 13:00-15:00: Build the Progress Tracker page (`/progress`)
- 15:00-17:00: Test the data flow: setup → DB → progress tracker → metrics update
- **EOD deliverable:** Dashboard banner + Progress Tracker connected

#### Ruhith
- 9:15-12:00: Build the AI Coach endpoint that analyzes baseline + returns insights (uses Claude Sonnet 4.6)
- 13:00-15:00: Build cron job for auto-monthly snapshots (`workers/snapshot.ts`)
- 15:00-17:00: Stripe Customer Portal integration — webhook for subscription events
- **EOD deliverable:** Plan4Growth AI AI returns real insights based on user's data

---

### THURSDAY 22 MAY — Financial Pages

#### Maryam
- 9:15-12:00: P&L page — pulls from `elevate-health` baseline first, calculates from records second
- 13:00-15:00: Cash Flow page (13-week rolling forecast)
- 15:00-17:00: Financial Statements page (balance sheet + director loan)
- **EOD deliverable:** All 3 finance pages live

#### Nikhil
- 9:15-12:00: Valuation page (3-model: Principal-led, Associate-led, DSO)
- 13:00-15:00: KPI Scorecard page (23 KPIs traffic-lighted)
- 15:00-17:00: Patient Payments page (Stripe connection, transactions feed)
- **EOD deliverable:** Valuation + KPIs + Payments live

#### Ruhith
- 9:15-12:00: TrueLayer open banking integration (`/api/integrations/truelayer`)
- 13:00-15:00: Xero integration (`/api/integrations/xero`) — pull P&L data
- 15:00-17:00: Build the formula library (`apps/api/src/lib/formulas.ts`) — all calculations as pure functions
- **EOD deliverable:** Open banking + Xero connect successfully

---

### FRIDAY 23 MAY — Operations Pages + END WEEK 1 DEMO

#### Maryam
- 9:15-12:00: Associates page + Associate Pay run
- 13:00-15:00: Chair Utilisation page
- 15:00-16:00: Treatments page
- 16:00-17:00: **DEMO PREP** for end-of-week presentation
- **EOD deliverable:** Operations pages live

#### Nikhil
- 9:15-12:00: UDA Tracker page
- 13:00-15:00: Staff Scheduling page
- 15:00-16:00: Scenarios page
- 16:00-17:00: **DEMO PREP**
- **EOD deliverable:** All operations + scenarios live

#### Ruhith
- 9:15-12:00: Tax (MTD) page — pulls from HMRC API for VAT deadlines
- 13:00-15:00: Debt Recovery page + Alerts page
- 15:00-16:00: Backend optimization (DB indexes, query performance)
- 16:00-17:00: **DEMO PREP**
- **EOD deliverable:** Tax + Debt + Alerts live

**17:00 FRIDAY DEMO** — 30 min Zoom with Gaurav, walk through everything built this week. Loom recording required.

---

## WEEK 2 — Growth, CRM, Wealth (26-30 May)

### MONDAY 26 MAY — Growth Pages

#### Maryam
- 9:15-12:00: Patients page (active base, lapsed, LTV cohorts)
- 13:00-15:00: Marketing page (cost per lead/consult/treatment by channel)
- 15:00-17:00: Benchmark page (vs UK industry averages)
- **EOD deliverable:** Patients + Marketing + Benchmark live

#### Nikhil
- 9:15-12:00: Loyalty & Members page (Smile Club tiers, auto-rewards)
- 13:00-15:00: Reviews page (Google/Trustpilot aggregation)
- 15:00-17:00: Online Booking page (widget settings, source tracking)
- **EOD deliverable:** Loyalty + Reviews + Booking live

#### Ruhith
- 9:15-12:00: Google Business Profile API integration (for reviews)
- 13:00-15:00: Trustpilot integration
- 15:00-17:00: Booking webhook endpoint (receive bookings from website widget)
- **EOD deliverable:** All review integrations live

---

### TUESDAY 27 MAY — CRM Pages

#### Maryam
- 9:15-12:00: Inbox page (unified email/SMS/WhatsApp)
- 13:00-15:00: Pipeline page (kanban with drag-drop)
- 15:00-17:00: Contacts page (full patient/lead records)
- **EOD deliverable:** Inbox + Pipeline + Contacts live

#### Nikhil
- 9:15-12:00: Workflows page (visual builder)
- 13:00-15:00: Landing Pages page (templates, hosted pages)
- 15:00-17:00: Mobile responsive QA — every page tested on iPhone 12 viewport
- **EOD deliverable:** Workflows + Pages + mobile QA done

#### Ruhith
- 9:15-12:00: Twilio SMS integration (workflow messages)
- 13:00-15:00: Postmark email integration (transactional emails)
- 15:00-17:00: Workflow engine (cron job that executes triggered workflows)
- **EOD deliverable:** SMS + email + workflow engine running

---

### WEDNESDAY 28 MAY — Wealth + AI

#### Maryam
- 9:15-12:00: Net Worth page
- 13:00-15:00: Property Portfolio page
- 15:00-17:00: Pensions page
- **EOD deliverable:** Wealth pages 1-3 live

#### Nikhil
- 9:15-12:00: FIRE Plan page (compound investment modelling)
- 13:00-15:00: AI Insights page (anomaly detection)
- 15:00-17:00: Mobile App download page
- **EOD deliverable:** FIRE + AI Insights + Mobile live

#### Ruhith
- 9:15-12:00: Plan4Growth AI AI chat endpoint (with conversation memory)
- 13:00-15:00: Anomaly detection cron (runs daily, flags unusual patterns)
- 15:00-17:00: Weekly digest email job (sends Mon AM to all users)
- **EOD deliverable:** AI fully operational

---

### THURSDAY 29 MAY — System + Testing

#### Maryam
- 9:15-12:00: Integrations page (15 third-party connectors UI)
- 13:00-15:00: Settings page (org, users, billing, GDPR)
- 15:00-17:00: End-to-end testing — full user journey from signup to setup to dashboard
- **EOD deliverable:** Settings live + E2E tested

#### Nikhil
- 9:15-12:00: Onboarding tour (first-time user walkthrough)
- 13:00-15:00: Empty states for every page (when no data)
- 15:00-17:00: Performance optimization — lazy load, image optimization, code splitting
- **EOD deliverable:** Tour + empty states + perf done

#### Ruhith
- 9:15-12:00: Backup automation (daily Postgres snapshot to S3)
- 13:00-15:00: Monitoring setup (Sentry + Logflare)
- 15:00-17:00: Load testing (simulate 100 concurrent users)
- **EOD deliverable:** Production-ready infrastructure

---

### FRIDAY 30 MAY — LAUNCH DAY

**Morning: Final QA pass**

#### All three (9:15-12:00)
- Test every page on production with real GM Dental data
- Fix any critical bugs found (P0 only — defer P1/P2 to June)
- Final mobile QA
- Run smoke tests

**Afternoon: Soft launch**

#### Maryam (13:00-17:00)
- Set up live tenant for GM Dental Group in production
- Import all 5 practice data + 8 associates
- Run setup wizard with Gaurav live
- Onboard Nadia, Shishir, Maryam herself as users

#### Nikhil (13:00-17:00)
- Final Lighthouse audit (target: all green)
- Set up uptime monitoring (pingdom.com or better-stack)
- Set up status page (status.elevate.app)

#### Ruhith (13:00-17:00)
- Production monitoring dashboard
- Alert escalation paths configured (PagerDuty)
- Final backup verified working

**17:00 LAUNCH CALL** — All hands, Loom recording, demo to Gaurav. App goes live for GM Dental Group.

**17:30 CELEBRATE** 🎉

---

## JUNE — Teething issues + GA (1-30 June)

**Week of 2 June:** Bug triage. Fix P0 → P1 → P2 in order.
**Week of 9 June:** Polish, performance, edge cases.
**Week of 16 June:** Beta with 3 friendly UK dental groups (Gaurav's network).
**Week of 23 June:** Final hardening, marketing assets, sales materials.

**Friday 27 June:** GA launch. Public website live. Start onboarding paid customers.

---

## What if we slip?

If a day's tasks aren't done by 17:00:

1. **Identify the blocker** — code, design, decision, third party?
2. **Decide:** push to tomorrow (acceptable for non-critical) or get help (Gaurav, Maryam can pair)
3. **Document in standup** the next morning — what's pushed, what's now today's plan
4. **Adjust the schedule** — if a feature is too big, scope it down

**Hard rule:** Setup wizard + dashboard banner + progress tracker MUST be done by end of Wednesday Week 1. If not, escalate immediately.

---

## Reward for hitting deadline

Per Gaurav: completed end of May with no critical bugs in June = team bonus tbd.
