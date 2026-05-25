# Elevate Backend Starter

Node 20 + Express + Postgres 16 + Redis 7. Designed to be cloned, configured, and running locally in 15 minutes.

## Prerequisites

- Docker Desktop running
- Node 20+ installed locally (for `npm install` outside the container)

## Quick start

```bash
cp .env.example .env
# Edit .env at minimum: set JWT_SECRET, ENCRYPTION_KEY
docker-compose up -d postgres redis
npm install
npm run migrate
npm run seed
npm run dev
```

Then `curl http://localhost:4000/health` → `{ "ok": true }`.

## Folder layout

```
src/
├── server.js                 ← Express entrypoint
├── config/
│   ├── db.js                 ← Postgres pool
│   ├── redis.js
│   ├── env.js                ← Validates required env vars at boot
│   └── secrets.js            ← Reads encrypted secrets (KMS in prod, local in dev)
├── auth/
│   ├── middleware.js         ← requireAuth, requirePermission, requireOwner
│   ├── jwt.js
│   └── mfa.js
├── routes/
│   ├── index.js              ← Router composition
│   ├── auth.js
│   ├── finance.js
│   ├── clinical.js
│   ├── crm.js
│   ├── launch.js
│   ├── reconciliation.js
│   ├── uploads.js
│   ├── integrations.js
│   └── audit.js
├── connectors/
│   ├── dentally/             ← API client + sync jobs
│   ├── xero/
│   ├── quickbooks/
│   ├── ghl/
│   └── stripe/
├── reconciliation/
│   ├── runner.js             ← Orchestrates all controls
│   └── controls/
│       ├── cash-received.js
│       ├── revenue-by-practice.js
│       ├── aged-debt.js
│       ├── treatment-starts.js
│       └── entity-totals.js
├── webhooks/
│   ├── dentally.js
│   ├── xero.js
│   ├── quickbooks.js
│   ├── ghl.js
│   └── stripe.js
├── jobs/
│   └── queue.js              ← BullMQ setup
└── lib/
    ├── audit.js
    └── crypto.js
```

## Running migrations

`migrations/` contains numbered SQL files (`001_initial.sql` etc). `npm run migrate` runs them in order, tracking applied state in `schema_migrations` table.

## Tests

```bash
npm test
```

Vitest runs against the schema. Reconciliation control tests use fixture data from `tests/fixtures/`.

## Production

- Don't run `docker-compose up` in production. Use real managed Postgres + Redis.
- Use a secrets manager (AWS KMS / Azure Key Vault) — never `.env` files.
- Run behind a reverse proxy (nginx config in `../06-deployment/nginx.conf.example`).
- See `../06-deployment/DEPLOYMENT_RUNBOOK.md`.
