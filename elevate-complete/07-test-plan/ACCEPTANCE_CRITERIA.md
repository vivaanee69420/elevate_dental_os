# Acceptance Criteria

Go / no-go for production launch. Every P0 must pass. P1 should pass.

---

## P0 · Blocking · all must pass before any production user logs in

### Authentication & access

- [ ] Owner can log in with email + password + MFA
- [ ] Failed login attempts are rate-limited and audit-logged
- [ ] Session cookie is `httpOnly` `secure` `sameSite=strict` (verify in browser devtools)
- [ ] Non-owner role gets 403 (not 200, not 404) when accessing Wealth or Launch Control via direct URL
- [ ] Permissions changes by owner reflect immediately for affected users
- [ ] Audit log entry written for every login, logout, permission change, and access denial

### Data integrity

- [ ] One full month of accounting data reconciles green for `cash_received`
- [ ] One full week reconciles green for `revenue_by_practice`
- [ ] `aged_debt` reconciles with zero unmatched at week close
- [ ] `treatment_starts` reconciles with < 5% unmatched (rest move to exception queue)
- [ ] Closed-month numbers in the dashboard match the accounting source exactly
- [ ] Refreshing the same query 5 times in a row returns identical numbers

### Integration health

- [ ] Xero / QBO P&L pull works for at least one entity
- [ ] Dentally appointments sync within 60 seconds of changes
- [ ] GHL contacts + opportunities sync within 15 minutes
- [ ] Webhook signature verification rejects forged requests with 401
- [ ] Token refresh works automatically before expiry
- [ ] `Integration Health` page shows accurate connector status

### Security

- [ ] MFA enrolled for every user with `owner`, `practice_manager`, or `finance_lead` role
- [ ] No secrets in source control (`gitleaks` clean)
- [ ] No `.env` in production — secrets manager only
- [ ] TLS A grade on SSL Labs (or platform equivalent)
- [ ] WAF active
- [ ] Audit log cannot be updated or deleted (DB trigger test)

### Operations

- [ ] `/health` returns 200 with both DB and Redis OK
- [ ] Database backup restore tested into staging in < 60 minutes
- [ ] Monitoring receives traffic; alert routes to on-call
- [ ] At least one P1 alert was triggered and acknowledged during the dry run

---

## P1 · High priority · resolve in week 1 post-launch if any open

- [ ] Manual feed CSV uploads work for all 5 templates with line-level validation
- [ ] Dual sign-off enforced on manual upload approval
- [ ] Board pack generates as a PDF with all required sections
- [ ] QoE add-backs flow through to the valuation calculation correctly
- [ ] Compliance + HR pages render for practice managers
- [ ] Mastermind AI chat responds within 10 seconds
- [ ] Reviews page shows real GHL review data
- [ ] Call Centre deep-link opens the right GHL view
- [ ] Mobile / tablet layout doesn't break (test on iPad)

---

## P2 · Nice to have · v1.1

- [ ] Peer benchmark cohort populated with anonymised data from 4+ practice groups
- [ ] Leak Finder shows real opportunities (not sample data)
- [ ] NHS UDA CSV upload + tracker works end-to-end
- [ ] Marketing Pro ROAS shows correct values from Meta / Google Ads connectors
- [ ] Compliance calendar exports to iCal
- [ ] User-level dark mode preference (despite Gaurav's preference, individual users may want it)

---

## What we explicitly are NOT testing in v1

- Online patient booking
- Patient portal login
- Mobile app
- Multi-language support
- Multi-currency reporting
- Real-time notifications (push / email beyond standard alerts)
- API for third parties to read Elevate data
