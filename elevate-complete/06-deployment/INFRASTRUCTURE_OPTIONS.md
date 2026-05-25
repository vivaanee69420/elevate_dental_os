# Infrastructure Options

Three production-ready paths, costed for the GM Dental Group scale (1 org, 5 practices, ~50 users, ~5000 patients/month, ~100 webhooks/min).

---

## Option A: AWS (recommended · most mature ecosystem)

| Component | Service | Sizing | Monthly cost (London) |
|---|---|---|---|
| Database | RDS PostgreSQL 16 | db.t4g.medium · 100GB SSD · Multi-AZ | ~£140 |
| Cache | ElastiCache Redis 7 | cache.t4g.small · 1 node + failover | ~£35 |
| API | ECS Fargate | 2× 0.5vCPU 1GB | ~£40 |
| Worker | ECS Fargate | 1× 0.5vCPU 1GB | ~£20 |
| Load balancer | ALB | + 5GB/month | ~£18 |
| Storage | S3 | 20GB + requests | ~£2 |
| Secrets | KMS + Secrets Manager | 50 secrets | ~£15 |
| Monitoring | CloudWatch + X-Ray | basic | ~£25 |
| DNS | Route 53 | 1 zone + queries | ~£3 |
| WAF | Cloudflare Pro (in front of ALB) | | ~£20 |
| **Total** | | | **~£318/month** |

Add ~£40/month for one of:
- Datadog (better observability than CloudWatch)
- Sentry (error tracking with traces)

Free tier eligibility: most services have 12-month free tiers, but you'll outgrow them quickly.

---

## Option B: Azure (better for orgs already on Microsoft 365)

| Component | Service | Sizing | Monthly cost |
|---|---|---|---|
| Database | Azure Database for PostgreSQL Flexible | B2s · 100GB | ~£120 |
| Cache | Azure Cache for Redis | Basic C1 | ~£40 |
| API + Worker | Azure App Service | P1v3 plan, 2 slots | ~£140 |
| Load balancer | Front Door Standard | | ~£25 |
| Storage | Blob Storage | 20GB | ~£3 |
| Secrets | Key Vault | 5000 ops | ~£10 |
| Monitoring | Application Insights + Log Analytics | basic | ~£30 |
| DNS | Azure DNS | 1 zone | ~£3 |
| **Total** | | | **~£371/month** |

---

## Option C: GCP (cheapest if Cloud Run usage stays low)

| Component | Service | Sizing | Monthly cost |
|---|---|---|---|
| Database | Cloud SQL PostgreSQL | db-custom-2-7680 · HA | ~£155 |
| Cache | Memorystore Redis | 1GB · Standard | ~£40 |
| API | Cloud Run | scale-to-zero, ~5M req/month | ~£8 |
| Worker | Cloud Run Jobs | scheduled | ~£3 |
| Load balancer | HTTPS LB | | ~£15 |
| Storage | Cloud Storage | 20GB | ~£2 |
| Secrets | Secret Manager | | ~£5 |
| Monitoring | Cloud Logging + Cloud Monitoring | | ~£20 |
| DNS | Cloud DNS | | ~£2 |
| **Total** | | | **~£250/month** |

GCP is cheapest at low scale because Cloud Run scales to zero. As traffic grows, AWS becomes more cost-effective.

---

## Option D: Minimal viable (single VPS)

For pre-launch / one-practice pilot only:

| Component | Service | Cost |
|---|---|---|
| Everything | Hetzner CX32 VPS · 4vCPU 8GB · Ubuntu | £15/month |
| Backups | Hetzner Storage Box 100GB | £3/month |
| **Total** | | **£18/month** |

Single point of failure. No managed backups. No autoscale. **Don't run production patient data on this** — but fine for the first 4 weeks of dev / UAT.

---

## Decision matrix

| You are... | Pick |
|---|---|
| Already on Microsoft 365 / Azure AD | Azure |
| Already on AWS / S3 / RDS elsewhere | AWS |
| Cost-sensitive · OK with GCP learning curve | GCP |
| In pre-launch · pilot only | VPS |

GM Dental Group's existing tech: Ruhith already runs AWS (S3, DNS). Recommendation: **AWS**.

---

## Architecture diagram

```
Internet
   │
   ▼
Cloudflare (WAF + CDN + DDoS)
   │
   ▼
Application Load Balancer
   │
   ├──► ECS Service: api (2-4 tasks)  ◄─┐
   │                                    │
   └──► ECS Service: worker (1-2 tasks) │
                                        │
   ┌────────────────────────────────────┘
   ▼              ▼              ▼
RDS Postgres    ElastiCache    S3 Bucket
(Multi-AZ)      Redis          (uploads, packs)
   │
   ▼
Daily snapshots → S3 backup bucket (encrypted, lifecycle to Glacier after 90d)
```

---

## Scaling triggers

| Trigger | Action |
|---|---|
| API CPU > 70% for 10 min | Add 1 task (max 6) |
| Postgres connections > 80% | Add connection pooler (PgBouncer) |
| Postgres CPU > 70% sustained | Upgrade instance size |
| Redis memory > 70% | Upgrade or enable LRU eviction |
| Queue depth > 1000 sustained | Add worker tasks |

---

## When to consider multi-region

Not for v1. GM Dental Group is single-region (UK). Add a DR region when:
- You have UK + non-UK practices
- RTO requirement drops below 60 minutes
- Regulatory requirement appears (none anticipated for dental SaaS in the UK)
