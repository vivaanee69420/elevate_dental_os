# Elevate Dental OS · Complete Developer Handoff

**Version:** 1.1 · **Date:** 25 May 2026 · **Owner:** Gaurav Mehta, GM Dental Group

Everything a developer needs to take the Elevate Dental OS prototype from a single-file demo to a multi-tenant live production system.

---

## 🎯 What this is

A working prototype of a dental CEO platform (single-file HTML, runs in any browser) + every spec, schema, integration guide, runbook and backend starter needed to make it live.

**Current state of integrations: all at zero.** Nothing is wired to Dentally, Xero, QuickBooks, GoHighLevel, Stripe or Open Banking yet. This package tells you exactly how to wire each one, in what order, with concrete code.

---

## 🗂 Folder map

```
elevate-dental-os-COMPLETE/
├── README.md                          ← You are here · master index
├── QUICKSTART_FOR_DEVELOPER.md        ← Read this second · critical path zero-to-live
│
├── 01-prototype/
│   ├── elevate-dental-os.html         ← The single-file working UI (2.3MB)
│   └── elevate-data-dictionary.html   ← Every data point · source · sync frequency
│
├── 02-launch-control-handoff/         ← Strategic docs (the "what to build" layer)
│   ├── LAUNCH_CONTROL_OVERVIEW.md     ← Section overview · how UI maps to docs
│   ├── DATA_CONNECTION_PLAYBOOK.md    ← Implementation-ready Dentally / Xero / QB / GHL
│   ├── INTEGRATION_REPORT.md          ← Strategic summary
│   └── manual-feed-templates/         ← 5 CSV fallback templates
│
├── 03-backend-spec/                   ← The "what to build technically" layer
│   ├── DATABASE_SCHEMA.sql            ← Full PostgreSQL DDL · ready to run
│   ├── API_CONTRACT.md                ← REST endpoint specs with payloads
│   ├── DATA_MODEL.md                  ← Entity relationships & normalization rules
│   ├── PERMISSIONS_MODEL.md           ← RBAC: owner / PM / reception / clinician / finance
│   └── RECONCILIATION_RULES.md        ← Variance controls · exception queue · sign-off
│
├── 04-integrations/                   ← Per-system OAuth & wiring guides
│   ├── INTEGRATION_PRIORITY.md        ← What to build first · time estimates
│   ├── DENTALLY_SETUP.md              ← OAuth · webhooks · field mapping · sync cadence
│   ├── XERO_SETUP.md                  ← OAuth · granular scopes · reports API
│   ├── QUICKBOOKS_SETUP.md            ← OAuth · webhooks · CDC · reports
│   ├── GOHIGHLEVEL_SETUP.md           ← API · deep links · sidebar-collapse pattern
│   ├── STRIPE_SETUP.md                ← Patient payments · subscriptions · webhooks
│   └── OPEN_BANKING_SETUP.md          ← TrueLayer / Plaid / Tink
│
├── 05-backend-starter/                ← Node + Express + Postgres scaffold · runs locally
│   ├── README.md                      ← Setup instructions
│   ├── package.json                   ← All dependencies pinned
│   ├── .env.example                   ← Every required environment variable
│   ├── docker-compose.yml             ← Postgres + Redis + app · one command up
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.js                  ← Express entrypoint
│   │   ├── config/                    ← DB + env config
│   │   ├── routes/                    ← REST endpoints
│   │   ├── webhooks/                  ← Receivers for Dentally / Xero / GHL / Stripe
│   │   ├── connectors/                ← One folder per external system
│   │   ├── reconciliation/            ← Daily / weekly / monthly job runners
│   │   ├── auth/                      ← MFA · RBAC middleware
│   │   └── jobs/                      ← Cron-style sync workers
│   └── migrations/                    ← SQL migration files
│
├── 06-deployment/                     ← Production go-live
│   ├── DEPLOYMENT_RUNBOOK.md          ← Day-by-day go-live sequence
│   ├── INFRASTRUCTURE_OPTIONS.md      ← AWS · Azure · Vercel · cost comparison
│   ├── SECURITY_BASELINE.md           ← MFA · RBAC · audit · secrets · retention
│   └── nginx.conf.example
│
├── 07-test-plan/                      ← Validate before go-live
│   ├── ACCEPTANCE_CRITERIA.md         ← Go / no-go criteria
│   └── UAT_CHECKLIST.md               ← Per-module test cases
│
└── 08-source-reference/               ← Prototype JS chunks (already inlined in 01-prototype)
    └── chunk2.js … chunk11.js
```

---

## 🚀 Where to start

1. **Open `01-prototype/elevate-dental-os.html`** in a browser. Click around all 10 sidebar sections. This is the UI the backend will power.
2. **Read `QUICKSTART_FOR_DEVELOPER.md`** in this folder. It's the critical-path sequence: what to build first, what to defer, what's blocking.
3. **Run `05-backend-starter/`** locally — `docker-compose up` and you have Postgres + Express running with the schema loaded.
4. **Pick the first integration** from `04-integrations/INTEGRATION_PRIORITY.md` (it's Xero — fastest unlock).
5. **Follow the per-system guide** for that integration.
6. **Iterate**: connector → webhook → reconciliation → next system.

---

## ⏱ Realistic timeline (one experienced full-stack developer)

| Phase | Duration | Output |
|---|---|---|
| Week 1 | Setup + auth | Backend running · DB live · MFA + RBAC working · prototype hooked to real DB |
| Week 2 | Xero connector | OAuth done · P&L / Balance Sheet / Bank pulled · displayed in UI |
| Week 3 | Dentally connector | API client · webhooks live · appointments / patients / payments syncing |
| Week 4 | GoHighLevel connector | API sync + deep links · sidebar-collapse pattern working |
| Week 5 | Reconciliation engine | Daily controls running · exception queue functional · approval flow |
| Week 6 | Manual feed + Stripe | CSV upload + validation · patient payment processing |
| Week 7 | UAT with one practice | One real practice live · two clean weekly reconciliations |
| Week 8 | Group rollout | Other 4 practices onboarded · monitoring · alerting |

**~8 weeks to multi-practice live** with one experienced developer. Halve it with two.

---

## 🛡 Non-negotiables before go-live

From `06-deployment/SECURITY_BASELINE.md` — all of these must be green:

1. MFA required for every non-patient user
2. Tokens stored in a real secrets manager (not env files in source control)
3. Immutable audit logs for every sync · upload · approval · export · admin change
4. Wealth + Launch Control pages owner-only via RBAC enforcement
5. Two consecutive weekly reconciliations within tolerance before any practice goes live
6. Manual feed templates writing audit events on upload + approval
7. One closed month with finance-approved board pack numbers

---

## 📞 Owner contact & scope

- **Owner:** Gaurav Mehta (CEO, GM Dental Group)
- **Co-founder (Plan4Growth):** Nadia Reinolds
- **In-scope practices for v1:** Ashford · Rochester · Barnet · Warwick Lodge (Herne Bay) · FTS Bexleyheath
- **Tech support team:** Nikhil (paid ads, platform config), Ruhith (AWS / DNS / S3 / infra)
- **Out of scope for v1:** Mobile app · online booking · full CRM rebuild (GHL stays the CRM engine)

---

## 📜 Naming conventions

- **PIM** = Practice IQ Manager
- **UGD** = Unified Group Dashboard
- **CFI** = Cash Flow Insights
- **OCPSPD** = Operating Cost Per Surgery Per Day
- **FCF** = Free Cash Flow
- **UDA** = Units of Dental Activity (NHS)
- **BSA** = NHS Business Services Authority (treatment code source)
- **QoE** = Quality of Earnings
- **RBAC** = Role-Based Access Control
- **CDC** = Change Data Capture (QuickBooks)

---

**Built:** 25 May 2026 · **Pricing reference:** Elevate Accounts £397/mo (practice owners) · £97/mo (associates) · target launch: October 2026
