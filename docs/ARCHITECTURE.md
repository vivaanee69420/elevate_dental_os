# Architecture — Elevate Dental OS

## High-level diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          USERS                                  │
│  👑 Owner (Gaurav, Nadia)    💼 Practice Manager    🎧 Reception │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              RAILWAY · service web (Frontend, Docker)           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Next.js 14 App Router · React Server + Client         │   │
│  │  Pages: 39 (dashboard, CRM, finance, wealth, etc.)     │   │
│  │  Auth: Supabase SSR · State: React Query               │   │
│  └─────────────────────────────────────────────────────────┘   │
│  Domain: app.elevate.app                                        │
└────────────────────┬────────────────────────────────────────────┘
                     │ Bearer JWT
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RAILWAY (Backend)                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Fastify TypeScript · /api/* endpoints                  │   │
│  │  Auth middleware → reads JWT, sets req.user             │   │
│  │  Audit middleware → logs every mutation                 │   │
│  │  Routes: leads, contacts, payments, p4g-ai AI, etc.    │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Workers (cron):                                         │   │
│  │  · Monthly snapshots (1st @ 02:00 UTC)                   │   │
│  │  · Weekly digest (Mon @ 06:00 UTC)                       │   │
│  │  · Workflow runner (every minute)                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│  Domain: api.elevate.app                                        │
└─────┬───────────┬───────────┬───────────┬──────────┬────────────┘
      │           │           │           │          │
      ▼           ▼           ▼           ▼          ▼
┌────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐ ┌───────────┐
│Supabase│  │Anthropic│  │ Stripe  │  │  AWS   │ │ Postmark  │
│  +RLS  │  │ Claude  │  │ Billing │  │   S3   │ │ + Twilio  │
│Postgres│  │ Sonnet  │  │ +Portal │  │ +KMS   │ │ + TrueLay │
│  Auth  │  │  4.6    │  │         │  │        │ │           │
└────────┘  └─────────┘  └─────────┘  └────────┘ └───────────┘
```

## Multi-tenancy model

Every business table has `organisation_id UUID NOT NULL`. RLS policies use:

```sql
CREATE POLICY "tenant_isolation" ON leads
  USING (organisation_id = current_org_id());

CREATE FUNCTION current_org_id() RETURNS UUID AS $$
  SELECT (current_setting('request.jwt.claims', true)::json->>'organisation_id')::UUID;
$$ LANGUAGE SQL STABLE;
```

The Supabase Custom Access Token Hook injects `organisation_id` + `role` into the JWT at issue time. Without this hook, RLS returns zero rows.

## Request flow

1. User makes request from browser with Supabase session cookie
2. Next.js middleware validates session, redirects if needed
3. Frontend code calls `fetch('/api/leads')` with JWT in `Authorization: Bearer` header
4. Fastify auth middleware:
   - Validates JWT with Supabase
   - Loads `users` row for org + role
   - Creates tenant-scoped Supabase client with user's JWT
   - Attaches `req.user` + `req.db`
5. Route handler runs query through `req.db` — RLS enforces tenant isolation at the database
6. Audit middleware logs the mutation (if non-GET)
7. Response returned

## Why this design

| Question | Answer |
|---|---|
| Why not Supabase Edge Functions only? | Need long-running workers (workflow runner, AI calls, integrations). Fastify gives us full control. |
| Why RLS at all if backend filters by org? | Defence in depth. If backend has a bug, data still can't leak across tenants. |
| Why pence not pounds? | Float arithmetic is lossy. All accounting code uses integers. |
| Why Supabase Auth? | Built-in MFA, magic links, password reset, SSO future-proofing. |
| Why Next.js App Router? | SSR for fast first paint, RSC for streaming dashboards. |
| Why Anthropic Claude vs OpenAI? | Better at structured output (JSON insights), longer context, better tone for advisory role. |

## Security model

### Defence in depth

1. **Frontend** filters UI based on role
2. **Backend middleware** validates JWT + checks role per route
3. **RLS policies** enforce tenant isolation at the database
4. **Audit log** records every mutation with diff
5. **S3 KMS encryption** protects file storage
6. **TLS 1.3** everywhere · **HSTS** preload list

### Sensitive data handling

- Passwords: never logged, redacted in pino
- JWT tokens: never logged, redacted in pino
- Patient names: not in URL params or query strings
- Integration credentials: encrypted with KMS before DB storage
- PII in AI prompts: stripped before sending to Anthropic (per data agreement)

### Compliance posture

- **GDPR**: Right to access via `/settings/export-my-data`. Right to erasure via `/settings/delete-account`.
- **Data residency**: All data in `eu-west-2` (London). Railway (`api` + `web`) to `europe-west4`.
- **Audit log retention**: 7 years (HIPAA-equivalent for medical-adjacent data)
- **DPA**: Required with Anthropic, Stripe, Postmark, Twilio (all on file)

## Performance budget

| Page | Target FCP | Target TTI |
|---|---|---|
| Login | < 1.0s | < 1.5s |
| Dashboard | < 1.5s | < 2.5s |
| Pipeline (kanban) | < 2.0s | < 3.0s |
| Health Setup | < 1.5s | < 2.0s |

Achieve via:
- Static prerendering of marketing pages
- React Server Components for dashboard shell
- Streaming UI with `<Suspense>` boundaries
- React Query stale-while-revalidate caching
- Image optimisation via `next/image`
- Bundle analysis in CI

## Scaling targets

| Tier | Concurrent users | DB connections | API rps |
|---|---|---|---|
| MVP (Year 1) | 100 | 50 | 100 |
| Growth (Year 2) | 1,000 | 200 | 1,000 |
| Scale (Year 3) | 10,000 | 1,000 | 10,000 |

Bottlenecks (in order):
1. Fastify single-process — scale horizontally on Railway (auto-scaling enabled at 70% CPU)
2. Supabase connection pool — use PgBouncer connection mode for queries, direct for transactions
3. Anthropic API rate limits — implement queue + circuit breaker for AI features
