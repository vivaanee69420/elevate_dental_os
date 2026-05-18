# Elevate Dental OS — Developer Handoff

**Multi-tenant SaaS for UK dental practice groups. Production-ready handoff package.**

Target launch: **Friday 30 May 2026 17:00** · GA: **Friday 27 June 2026**

---

## What's in this package

```
elevate-handoff/
├── README.md                       ← you are here
├── docs/                           ← read these next
│   ├── DAILY_TASKS.md              · 10-day Mon-Fri schedule (19-30 May 2026)
│   ├── ARCHITECTURE.md             · System diagram + design decisions
│   ├── API.md                      · Every endpoint with examples
│   ├── DEPLOYMENT.md               · Step-by-step prod setup
│   ├── FORMULAS.md                 · All financial calcs (for accountant review)
│   └── TESTING.md                  · Acceptance criteria per feature
├── db/                             ← run these in order
│   ├── 01_schema.sql               · 25+ tables, indexes, triggers
│   ├── 02_rls.sql                  · Row-Level Security policies
│   └── 03_seed.sql                 · GM Dental demo data
├── backend/                        ← Fastify TypeScript API
│   ├── src/
│   │   ├── server.ts               · Entry point
│   │   ├── middleware/             · auth, audit, error handling
│   │   ├── routes/                 · 19 route modules
│   │   ├── lib/                    · supabase, claude, formulas, postmark, twilio
│   │   └── workers/                · cron jobs
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── frontend/                       ← Next.js 14 web app
│   ├── app/
│   │   ├── (auth)/                 · login, signup, forgot-password
│   │   └── (dashboard)/            · 39 dashboard pages
│   ├── components/                 · layout, ui primitives
│   ├── lib/                        · api client, supabase helpers
│   ├── middleware.ts               · auth gating
│   ├── package.json
│   └── .env.example
├── manus-briefs/                   ← copy-paste prompts for Manus
│   ├── 01-build-full-app.md
│   ├── 02-business-health-wizard.md
│   ├── 03-role-system.md
│   ├── 04-p4g-ai-ai.md
│   ├── 05-crm-pipeline.md
│   └── 06-financial-pages.md
├── scripts/                        ← deployment automation
│   ├── deploy-staging.sh
│   ├── deploy-prod.sh
│   ├── seed-tenant.ts
│   └── setup-aws.sh
└── .github/workflows/
    ├── ci.yml                      · typecheck, lint, test, build on PR
    └── deploy.yml                  · auto-deploy on push to main
```

## Tech stack

| Layer | Tech | Hosted on |
|---|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind, React Query | Railway (Docker) |
| Backend | Fastify, TypeScript, Zod | Railway |
| Database | Postgres 15 + Row-Level Security | Supabase |
| Auth | Supabase Auth + Custom Access Token Hook | Supabase |
| AI | Claude Sonnet 4.6 (`claude-sonnet-4-5-20250929`) | Anthropic API |
| Payments | Stripe Billing + Customer Portal + Payment Links | Stripe |
| Email | Postmark | Postmark |
| SMS | Twilio | Twilio |
| Files | S3 (eu-west-2) + KMS | AWS |
| Open Banking | TrueLayer | TrueLayer |
| Monitoring | Sentry + Logflare | Sentry / Better Stack |

## Who's working on what

| Person | Role | Owns |
|---|---|---|
| **Gaurav Mehta** | Owner / CEO | Product vision, customer feedback, GM Dental tenant |
| **Maryam** | Tech lead | Backend, Supabase, integrations, architecture decisions |
| **Nikhil** | Frontend + DevOps | All Next.js pages, Railway, design polish |
| **Ruhith** | Backend + AWS | API endpoints, workers, S3/KMS, monitoring |
| **Abhishek** | Design | Brand assets, marketing site, UI polish — non-technical |
| **Sona** | Content | Copy, marketing emails, social — non-technical |
| **Shishir Khadka FCCA** | Accountant | Review FORMULAS.md before launch |
| **Nadia Reinolds** | Co-founder | Strategy, partnerships (not coding) |

## Day-1 setup (for Maryam, 19 May 2026)

```bash
# 1. Clone repo
git clone https://github.com/gauravmehta/elevate-dental-os.git
cd elevate-dental-os

# 2. Install both apps
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 3. Set up local Supabase
npm install -g supabase
supabase start  # spins up local Postgres + Auth

# 4. Run migrations + seed
cd db
supabase db reset  # runs 01_schema.sql + 02_rls.sql + 03_seed.sql
cd ..

# 5. Configure env files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Fill in: Supabase URL/keys (from `supabase status`), Anthropic key, etc.

# 6. Start dev servers (in 2 terminals)
cd backend && npm run dev   # http://localhost:8080
cd frontend && npm run dev  # http://localhost:3000

# 7. Visit http://localhost:3000 and sign up
```

## Quality gates

**Cannot merge to `main` unless:**
- CI green (typecheck, lint, tests, build all pass)
- PR reviewed + approved by Maryam
- If new endpoint: API.md updated
- If new formula: FORMULAS.md updated + unit test added
- If new UI: matches design tokens + responsive on mobile

**Cannot deploy to prod unless:**
- Staging deploy successful + smoke tests pass
- Gaurav has approved (manually visits staging)
- No P0/P1 bugs open
- Database migrations tested on staging first

## Environments

| Env | URL | Branch | Auto-deploy? |
|---|---|---|---|
| Local | localhost:3000 / :8080 | (any) | n/a |
| Staging | staging.elevate.app | `develop` | Yes, on push |
| Production | app.elevate.app | `main` | Yes, on push (but with manual approval gate) |

## Where to read next

1. **`docs/DAILY_TASKS.md`** — your day-by-day schedule for the next 10 days
2. **`docs/ARCHITECTURE.md`** — understand the system before changing it
3. **`docs/API.md`** — endpoint reference
4. **`docs/DEPLOYMENT.md`** — when you're ready to ship to prod
5. **`docs/TESTING.md`** — what to verify before each merge
6. **`manus-briefs/*.md`** — paste any of these into Manus for a working slice
7. **Use the prototype at `preview/elevate-dental-os-v2.html` as the visual reference** — it has all 39 pages working with localStorage. Convert each to React using the structure laid out in `frontend/app/(dashboard)/`.

## Key principles (do not violate)

1. **No dark mode.** Owner dislikes dark themes. White/light only.
2. **All money in £ pence (integers).** Never floats. Display via `(pence / 100).toLocaleString('en-GB')`.
3. **Tenant isolation via RLS.** Every business table has `organisation_id`. RLS policies enforce isolation. Backend never bypasses this except in webhooks/workers.
4. **British English in all UI.** Organisation, colour, optimise, centre.
5. **Owner controls Practice Manager finance access.** Defaults: PM sees Ops/Growth/CRM. Finance pages OFF by default; Owner toggles per-page in Team Permissions.
6. **Reception = CRM only.** Inbox, Pipeline, Contacts. Nothing else. Ever.
7. **Italy Implant Residency is NOT a live offering.** Don't include it anywhere.
8. **No emojis in code/UI** except where explicitly specified (role icons, completion ticks, benefit tiles).
9. **Custom Access Token Hook is critical.** Without it, RLS returns zero rows and the app appears broken with no errors.
10. **Audit everything.** Every mutation logs to `audit_log` with user_id, org_id, diff.

## When stuck

- **Architecture question** → ask Maryam
- **Money/accounting question** → ask Shishir
- **Product/UX question** → ask Gaurav
- **Design question** → ask Abhishek
- **Copy question** → ask Sona
- **DevOps/AWS question** → ask Ruhith

## Launch checklist (Fri 30 May 2026)

- [ ] All CI green on main branch
- [ ] Production database migrations applied
- [ ] All env vars set in Railway (services `api` + `web`)
- [ ] Custom Access Token Hook enabled in Supabase
- [ ] Stripe webhook endpoint responding
- [ ] AT LEAST one paying customer in Stripe (Gaurav's GM Dental org)
- [ ] Test signup → setup → progress flow end-to-end on prod
- [ ] DNS records pointing to app.elevate.app + api.elevate.app
- [ ] Sentry receiving errors from both apps
- [ ] Status page live
- [ ] On-call rotation set
- [ ] Marketing site published
- [ ] Launch announcement drafted (don't send yet — June bug-fix window first)
