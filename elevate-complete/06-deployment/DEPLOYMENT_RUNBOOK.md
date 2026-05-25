# Deployment Runbook

Day-by-day sequence to take Elevate Dental OS from the developer's laptop to a multi-practice production environment.

Read this when the backend is built and connectors are working in staging — i.e. at the end of Week 6 of the QUICKSTART timeline.

---

## Phase 0: Pre-flight (3 days before go-live)

### Infrastructure

- [ ] Production Postgres provisioned (managed: RDS / Azure Database / Cloud SQL · min 4 vCPU · 16GB RAM · 100GB SSD · point-in-time recovery enabled)
- [ ] Production Redis provisioned (managed: ElastiCache / Azure Cache / Memorystore · 2GB · failover enabled)
- [ ] Application server provisioned (ECS / App Service / Cloud Run · 2 vCPU · 4GB RAM × 2 instances behind a load balancer)
- [ ] Worker process provisioned (separate instance from API · runs BullMQ workers + cron schedulers)
- [ ] Object storage configured (S3 / Blob / GCS for board pack PDFs and CSV uploads)
- [ ] Secrets manager configured (AWS KMS / Azure Key Vault / GCP Secret Manager)
- [ ] DNS records set: `app.elevateos.co` (frontend) · `api.elevateos.co` (backend)
- [ ] TLS certificates issued (Let's Encrypt via cert-manager or platform-managed)
- [ ] CDN / WAF in front of the app (Cloudflare or platform equivalent)

### Secrets

Move every secret out of `.env` into the secrets manager:

- JWT_SECRET (64-byte hex)
- ENCRYPTION_KEY (32-byte hex)
- Database connection string
- Redis connection string
- Per-integration OAuth client secrets (Xero, QBO, Stripe, TrueLayer)
- Webhook signing keys (Xero, QBO, Stripe)
- Sentry DSN

### Monitoring

- [ ] Application performance monitoring (Sentry, Datadog, or New Relic)
- [ ] Log aggregation (CloudWatch / Azure Monitor / GCP Logging)
- [ ] Uptime monitoring (`GET /health` from external — Pingdom, UptimeRobot, or platform)
- [ ] On-call rotation defined and tested
- [ ] PagerDuty / Opsgenie alerts wired for: health check failure, database CPU > 80%, queue depth > 1000, webhook delivery failure rate > 5%

---

## Phase 1: Database (Day 1, morning)

1. Run migrations against production database:
   ```bash
   DATABASE_URL=$PROD_DB_URL npm run migrate
   ```
2. Verify schema:
   ```sql
   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
   -- Expect 30+ tables
   ```
3. Seed roles + a single owner user:
   ```bash
   DATABASE_URL=$PROD_DB_URL node scripts/seed-production.js
   ```
4. Verify the audit log triggers are in place:
   ```sql
   INSERT INTO audit_logs (action) VALUES ('test');
   UPDATE audit_logs SET action = 'modified' WHERE action = 'test';  -- should ERROR
   ```

---

## Phase 2: Application deployment (Day 1, afternoon)

1. Build container:
   ```bash
   docker build -t elevate-api:1.1.0 .
   docker tag elevate-api:1.1.0 <registry>/elevate-api:1.1.0
   docker push <registry>/elevate-api:1.1.0
   ```
2. Deploy to ECS / App Service / Cloud Run. Start with 1 instance for the smoke test.
3. Verify `/health` returns 200 with both Postgres and Redis OK.
4. Verify the worker process is consuming jobs (push a test job, watch the logs).
5. Scale API instances to 2+ behind the load balancer.

---

## Phase 3: Authentication + first owner (Day 2, morning)

1. Owner logs in with the seeded credentials.
2. Owner is forced to:
   - Change password
   - Enrol MFA (scan QR, enter first TOTP code)
3. Owner creates additional users (Nikhil, Ruhith, Nadia, Philippa) — each enrols MFA on first login.
4. Owner edits the permissions matrix if any defaults need adjusting.

---

## Phase 4: Connect the first practice (Day 2-3)

Pick Ashford as the pilot — it has the cleanest data.

### Xero

1. Owner navigates to `/integrations` and clicks "Connect Xero".
2. OAuth flow → consent → returns to Elevate with tenant connected.
3. Backend runs the initial 24-month report backfill (takes ~30 min — owner can watch progress in Launch Control → Integration Health).
4. Run the chart-of-accounts mapping workshop with the practice's accountant — map every account to a `dental_bucket`.
5. Verify the Finance Pro page shows real numbers for Ashford and that they match Xero exactly.

### Dentally

1. Owner provides the Dentally API key (paste into the integration setup screen — never appears in URL, never logged).
2. Backend stores it encrypted, registers the webhook endpoint in Dentally.
3. Run 12-month backfill (~60 min for one practice).
4. Verify webhooks are firing — create a test appointment in Dentally and watch it land in Elevate within 60 seconds.

### GoHighLevel

1. Owner generates a Private Integration Token in the Ashford GHL sub-account.
2. Pastes it into Elevate's integration screen.
3. Set the location ID.
4. Run initial contacts + opportunities sync.
5. Configure deep-link URLs for inbox / pipeline / calls / calendar.
6. Verify a contact created in GHL appears in Elevate's inbox within 15 minutes.

---

## Phase 5: Reconciliation (Day 4-5)

1. Trigger each control manually from the Launch Control UI:
   - `cash_received` for yesterday
   - `revenue_by_practice` for last week
   - `aged_debt` snapshot
   - `treatment_starts` for the last 30 days
   - `entity_totals` for last closed month
2. Each control writes a row to `reconciliation_runs` and any breaches to `reconciliation_exceptions`.
3. Owner + finance lead work through the exception queue together — categorise each, resolve or route.
4. Expect the first run to have 10-30 exceptions. Most will be one of: `unmapped_account_code`, `missing_practice_mapping`, `crm_patient_match_failure`. Fix the underlying mapping, re-run.
5. Goal: get each control to **green with zero open exceptions** for two consecutive runs.

---

## Phase 6: UAT (Day 6-10)

Use the `07-test-plan/UAT_CHECKLIST.md`. Run every test case with the pilot practice. Don't promote to other practices until:

- All P0 test cases pass
- Two consecutive weekly reconciliations come in green
- Owner signs off the first board pack

---

## Phase 7: Group rollout (Week 2)

One practice per day, in this order:

1. Rochester
2. Warwick Lodge (Herne Bay)
3. Barnet
4. FTS Bexleyheath

After connecting each:

- Watch reconciliation for 48 hours before adding the next
- Don't run multiple onboardings in parallel — saturate one before starting the next

---

## Phase 8: Steady-state monitoring

Once all 5 practices are live:

| Metric | Target | Alert threshold |
|---|---|---|
| API p95 latency | < 500ms | > 1500ms for 5 min |
| Webhook delivery success rate | > 99% | < 95% over 1h |
| Daily reconciliation completion time | < 15 min | > 30 min |
| Open exceptions | < 5 per practice | > 20 per practice |
| Queue depth | < 100 | > 1000 |
| Database CPU | < 50% sustained | > 80% for 10 min |
| Redis memory | < 50% | > 80% |
| Error rate | < 0.1% | > 1% over 5 min |

---

## Rollback plan

If a deployment introduces a regression:

1. **Application code:** redeploy the previous container tag. The deployment platform should keep the previous 3 versions warm-cached for instant rollback.
2. **Database migrations:** never down-migrate in production. If a schema change broke something, write a forward-fix migration. The schema is append-only.
3. **Data:** point-in-time recovery is enabled on the database. To restore: bring up a new instance from the PITR snapshot, dual-write briefly while reconciling, cut over.
4. **Integration tokens:** if tokens were lost, the OAuth flow can be re-run by the owner — no data loss, just a few minutes of downtime per integration.

---

## Disaster recovery RTO / RPO

- **RPO (max data loss):** 5 minutes (Postgres continuous WAL backup)
- **RTO (max downtime):** 60 minutes (full restore from PITR + container redeploy)

Run a DR drill at least quarterly. Restore to a staging environment, validate, then tear down.

---

## Go-live signoff

Before announcing "we're live":

- [ ] All 5 practices connected and reconciling green
- [ ] Owner has run through every Wealth + Launch Control page on production
- [ ] One closed month with finance-approved board pack numbers
- [ ] Monitoring + alerting verified by triggering a synthetic failure
- [ ] Backup restore tested into staging
- [ ] All `.env` secrets purged from anywhere outside the secrets manager
- [ ] MFA enrolled for every user
- [ ] Owner-only pages confirmed inaccessible to non-owner roles via direct URL
