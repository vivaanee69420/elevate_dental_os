# Security Baseline

Non-negotiable security requirements before go-live. Every item here is enforced server-side, not just in the UI.

---

## Authentication

- [x] **MFA required** for every non-patient user. TOTP via authenticator app (Google Auth, Authy, 1Password).
- [x] **Password rules:** min 12 chars · zxcvbn complexity score ≥ 3 · no common-password dictionary hits.
- [x] **Password hashing:** bcrypt cost factor 12 (rotates up as hardware improves).
- [x] **Session tokens:** 30-minute access tokens · 14-day refresh tokens · `httpOnly` `secure` `sameSite=strict` cookies.
- [x] **MFA re-verification:** required every 12 hours and on entry to Wealth / Launch Control / Permissions pages.
- [x] **Account lockout:** 5 failed logins in 10 minutes → 30-minute lock + email alert to user.
- [x] **No SSO in v1** — adds attack surface without proportional benefit at this scale. Add SAML/OIDC in v1.1 if requested.

---

## Authorization (RBAC)

Three-layer enforcement (UI · API · query). See `03-backend-spec/PERMISSIONS_MODEL.md`.

- [x] **Wealth + Launch Control are owner-only at the API layer.** The UI doesn't get the option to grant access to other roles.
- [x] **Data scope filters** in every practice-scoped query (via `user_practice_access` join).
- [x] **Audit on every denial.** Every 403 writes an `access_denied` event.

---

## Secrets

- [x] **No secrets in source control.** Pre-commit hook (`gitleaks` or `trufflehog`) blocks accidental commits.
- [x] **No secrets in `.env` in production.** Use AWS Secrets Manager / Azure Key Vault / GCP Secret Manager.
- [x] **Integration tokens encrypted at rest** with envelope encryption — see `src/config/secrets.js` for the AES-256-GCM wrapper.
- [x] **Encryption key rotation** every 90 days. Re-wrap stored tokens on rotation.
- [x] **JWT secret rotation** every 6 months with grace period (accept both old + new keys for 24h after rotation).

---

## Audit logging

- [x] **Immutable.** Database triggers prevent UPDATE or DELETE on `audit_logs`.
- [x] **Every mutating action writes an audit event.** Code review rule: any new route that mutates state must call `audit.log(...)`.
- [x] **Audit retention:** 7 years online (regulatory).
- [x] **Audit content:** actor, action, object, IP, user agent, before/after diff for permission changes.
- [x] **Owner can view but not edit** the audit log via UI.

---

## Data protection

- [x] **TLS everywhere.** HSTS with 1-year max-age + preload + includeSubDomains.
- [x] **Database encryption at rest** (managed Postgres flag).
- [x] **Backups encrypted** with KMS.
- [x] **PII minimisation.** Don't log patient names / emails / phones in application logs (use IDs).
- [x] **Raw webhook payloads** stored 90 days, then archived to cold storage. PII redaction available on request (GDPR).

---

## Network

- [x] **WAF in front of the application** (Cloudflare or platform-native).
- [x] **Rate limits:**
  - Per user: 600 req/min
  - Per org: 6000 req/min
  - Per IP for unauthenticated routes: 60/min
- [x] **CORS:** strict origin allow-list. No `*`.
- [x] **CSP header:** restrict to known asset hosts. Strict on production.
- [x] **DDoS protection:** Cloudflare auto-mitigation enabled.

---

## Application security

- [x] **No SQL string concatenation.** Parameterised queries everywhere.
- [x] **No `eval()`, `Function()`, or dynamic require.**
- [x] **Dependencies:**
  - `npm audit` clean (zero high/critical)
  - Dependabot or Renovate enabled
  - Lock file checked in (`package-lock.json`)
- [x] **Input validation** via Zod schemas at every route boundary.
- [x] **CSRF protection** on state-changing routes (double-submit cookie pattern).

---

## Webhooks

- [x] **Every webhook signature verified.** Reject unsigned requests with 401.
- [x] **Timestamp checks** to prevent replay (reject if older than 5 minutes).
- [x] **Idempotency** — receivers should be idempotent on the external ID.

---

## Incident response

- [x] **On-call rotation** defined with backup.
- [x] **Runbook for each P1 alert** (DB down, queue backlog, integration auth failure, suspicious login pattern).
- [x] **Communication plan:** owner notified within 15 min of any P1 affecting clinical data integrity.
- [x] **Post-mortem template** for any incident lasting > 30 minutes or affecting > 1 practice.

---

## Compliance posture

GM Dental Group operates in the UK, handling dental health records. The applicable regimes:

- **UK GDPR + Data Protection Act 2018** — patient data is "special category" personal data. Lawful basis: legitimate interest for analytics; explicit consent for any patient-facing marketing.
- **NHS Data Security and Protection Toolkit (DSPT)** — required if any NHS treatment is processed via this system. The toolkit covers most of the same items in this baseline.
- **CQC Regulation 17 (Good Governance)** — record keeping, audit trail, access control. Largely covered by the audit log + RBAC.

Out of scope for v1 (re-assess later):
- HIPAA (US — not applicable unless expanding to US)
- ISO 27001 (formal certification — useful for enterprise sales, expensive at this stage)
- Cyber Essentials Plus (UK gov contractor requirement)

---

## Pre-launch security checklist

- [ ] All items above implemented
- [ ] Penetration test by an external firm (CREST-registered if possible)
- [ ] Backup restore tested and timed
- [ ] All `.env.example` placeholder values replaced in production
- [ ] All admin / owner users have MFA enrolled
- [ ] Cloudflare + WAF rules active
- [ ] Sentry / monitoring receiving traffic from production
- [ ] On-call rotation tested with a synthetic alert
