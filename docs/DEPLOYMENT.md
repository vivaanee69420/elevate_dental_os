# Deployment Guide

Step-by-step setup for getting Elevate Dental OS into production.

## Pre-requisites

- Node.js 20+ installed
- Railway account (Hobby plan minimum — hosts both `api` + `web` services)
- Supabase account (Pro tier for production)
- Stripe account (live mode keys for production)
- AWS account with admin access
- Postmark account (verified sender domain)
- Twilio account (purchased UK phone number)
- Anthropic API account (Claude API key)
- Sentry account (optional but recommended)

## Domain setup

Buy `elevate.app` (or use existing). Configure these DNS records:

| Record | Type | Value |
|---|---|---|
| `app.elevate.app` | CNAME | (Railway domain — service `web`) |
| `api.elevate.app` | CNAME | (Railway domain — service `api`) |
| `mail.elevate.app` | MX/SPF/DKIM | per Postmark docs |
| `elevate.app` | A | (marketing site IP) |

## 1. Supabase setup (do first — everything depends on this)

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Create project (or via dashboard)
# Note the project ref and URL
```

In Supabase Dashboard:
1. Project settings → API → copy `URL`, `anon` key, `service_role` key
2. Authentication → URL Configuration → add `https://app.elevate.app/**` as redirect URL
3. Authentication → Email templates → customise sender name "Elevate Dental OS"

Run migrations:
```bash
cd db
supabase db push --project-ref <your-ref>
```

### Custom Access Token Hook (CRITICAL)

Without this, RLS returns zero rows. Create the Edge Function:

```bash
mkdir -p supabase/functions/custom-access-token-hook
cat > supabase/functions/custom-access-token-hook/index.ts << 'EOF'
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const { user_id, claims } = await req.json();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: user } = await supabase
    .from('users')
    .select('organisation_id, role')
    .eq('id', user_id)
    .single();

  if (!user) return new Response(JSON.stringify({ claims }), {
    headers: { 'Content-Type': 'application/json' },
  });

  return new Response(
    JSON.stringify({
      claims: {
        ...claims,
        organisation_id: user.organisation_id,
        role: user.role,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
EOF

supabase functions deploy custom-access-token-hook --project-ref <your-ref>
```

Then in Supabase Dashboard → Authentication → Hooks → enable Custom Access Token Hook and point it at the deployed function URL.

**Verify by running a query** as a user:
```sql
SELECT current_setting('request.jwt.claims', true)::json;
-- Should include organisation_id and role
```

## 2. AWS setup

```bash
# Configure AWS CLI
aws configure  # use admin keys initially, create service user later

# Run setup script (creates KMS key + S3 bucket)
./scripts/setup-aws.sh production
```

Create IAM user for the backend:
1. IAM → Users → Add user → `elevate-api`
2. Attach policy with S3 + KMS permissions for the new bucket
3. Save Access Key ID + Secret Access Key

## 3. Stripe setup

1. Stripe Dashboard → Activate live mode
2. Create products:
   - **Starter** £197/mo
   - **Group** £497/mo
   - **Enterprise** £997/mo
3. Settings → Customer Portal → enable, allow cancellations
4. Webhooks → add endpoint `https://api.elevate.app/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `customer.subscription.*`
   - Copy signing secret

## 4. Postmark setup

1. Create server → "Elevate Production"
2. Verify sender domain `elevate.app` (add DNS records)
3. Copy server API token
4. Create message stream "outbound" for transactional

## 5. Twilio setup

1. Buy UK phone number (£1/mo)
2. Configure messaging service
3. Copy Account SID + Auth Token

## 6. Anthropic setup

1. Console → API Keys → Create key
2. Add billing details
3. Set monthly spend limit (start at $100, raise as needed)

## 7. Sentry setup (recommended)

1. Create project → Next.js (frontend) + Node (backend)
2. Copy DSN for each

## 8. Deploy backend (Railway)

```bash
# Install CLI
npm install -g @railway/cli

# Login
railway login

# Link or create project
cd backend
railway init

# Set environment variables (from .env.example)
railway variables set NODE_ENV=production
railway variables set SUPABASE_URL=...
railway variables set SUPABASE_SERVICE_ROLE_KEY=...
railway variables set SUPABASE_ANON_KEY=...
railway variables set ANTHROPIC_API_KEY=...
railway variables set STRIPE_SECRET_KEY=...
railway variables set STRIPE_WEBHOOK_SECRET=...
railway variables set POSTMARK_SERVER_TOKEN=...
railway variables set POSTMARK_FROM=no-reply@elevate.app
railway variables set TWILIO_ACCOUNT_SID=...
railway variables set TWILIO_AUTH_TOKEN=...
railway variables set TWILIO_FROM_NUMBER=+44...
railway variables set AWS_ACCESS_KEY_ID=...
railway variables set AWS_SECRET_ACCESS_KEY=...
railway variables set AWS_REGION=eu-west-2
railway variables set S3_BUCKET=elevate-files-production-eu-west-2
railway variables set SENTRY_DSN=...
railway variables set APP_URL=https://app.elevate.app

# Deploy
railway up

# Get the URL
railway domain  # e.g., elevate-api-production.up.railway.app

# Add custom domain
# Railway dashboard → Settings → Custom Domain → api.elevate.app
```

Create a SECOND service for workers in the same project. The web service runs
`server.js` and does **not** start the cron jobs — node-cron lives in
`workers/index.js`, which only runs if a persistent process executes it. Without
this service, **zero crons fire** (and nothing shows in Sentry).

1. Railway dashboard → New Service → from same repo
2. Root directory: `backend`
3. Start command: `npm run worker` (= `node src/workers/index.js`)
4. Config-as-code: point the service's config path at `backend/railway.worker.json`
   (pins `numReplicas: 1` + restart-on-failure). **Single replica is mandatory** —
   node-cron schedules in-process, so 2+ replicas double-fire every job.
5. Leave Railway's own **Cron Schedule** panel EMPTY. node-cron handles timing and
   the process must stay alive 24/7; a Railway cron schedule would kill/restart it
   and the jobs would never reach their scheduled times. (Railway Cron Schedule is
   only for the one-shot `*-once.js` scripts that call `process.exit`.)
6. Use same env vars — in particular `INTEGRATIONS_SECRET_KEY` MUST be identical
   to the web service's value, or the worker cannot decrypt stored integration
   tokens (Dentally/Xero) and every poll fails with `no_auth`. Set `SENTRY_DSN`
   too, or cron check-ins never reach Sentry.
7. After deploy, confirm logs show `[workers] Started — cron schedules active`.

## 9. Deploy frontend (Railway)

Frontend runs as Railway service `web`, built from `frontend/Dockerfile`
(Next.js standalone output — see `frontend/next.config.js`).

```bash
# Install CLI
npm install -g @railway/cli

# Login
railway login

# Deploy (run from repo; service root = frontend/)
cd frontend
railway up --environment production --service web

# Set env vars in Railway dashboard (service: web):
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
# NEXT_PUBLIC_API_URL=https://api.elevate.app
# SUPABASE_SERVICE_ROLE_KEY (only used for SSR if needed)
# NEXT_PUBLIC_* must be present at BUILD time (Docker build args)

# Add custom domain: app.elevate.app
# Railway dashboard → service web → Settings → Networking → Custom Domain
```

## 10. Smoke test production

```bash
# Health check
curl https://api.elevate.app/healthcheck

# Sign up a test owner
curl -X POST https://api.elevate.app/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!","full_name":"Test Owner","organisation_name":"Test Dental"}'

# Visit app
open https://app.elevate.app/login
```

## 11. Production checklist

Before announcing launch:

- [ ] All env vars set in Railway (services `api` + `web`)
- [ ] Custom domains pointing correctly
- [ ] Supabase Custom Access Token Hook enabled (CRITICAL)
- [ ] RLS verified — non-auth queries return zero rows
- [ ] Stripe webhook endpoint receiving test events
- [ ] Postmark domain verified, test email sent
- [ ] Twilio test SMS sent and received
- [ ] AWS S3 bucket has block-public-access enabled
- [ ] Sentry receiving errors from both frontend + backend
- [ ] At least 1 paying customer in Stripe (Gaurav's own GM Dental org)
- [ ] Backup strategy: Supabase daily backups enabled, S3 versioning enabled
- [ ] Privacy policy + terms of service published
- [ ] DPA agreements signed: Anthropic, Stripe, Postmark, Twilio
- [ ] GDPR data export endpoint tested
- [ ] Cookie banner on marketing site
- [ ] Status page set up (e.g., statuspage.io or BetterStack)
- [ ] On-call coverage set up (Ruhith)

## 12. Rollback procedure

If a deployment goes wrong:

**Frontend (Railway — service `web`):**
```bash
railway rollback --service web
# Or use Railway dashboard → service web → Deployments → Redeploy
```

**Backend (Railway — service `api`):**
```bash
# Roll back to previous deployment
railway rollback
# Or redeploy specific commit
git checkout <previous-sha>
railway up
```

**Database (Supabase):**
```bash
# Restore from daily backup via Supabase dashboard → Settings → Database → Backups
```

## Notifications / AWS SES + SNS

The notification service sends in-app, email, and SMS notifications. Emails are dispatched via AWS SES; SMS via AWS SNS. An outbox-drain worker processes the queue every minute.

### Environment variables (backend)

| Variable | Description |
|---|---|
| `AWS_REGION` | AWS region for SES + SNS, e.g. `eu-west-2`. Defaults to `eu-west-2` if unset. Reuses the same region as the existing S3 bucket. |
| `SES_FROM` | Verified SES sender address, e.g. `notifications@elevate.app`. |
| `SES_CONFIGURATION_SET` | Name of the SES configuration set whose event destination publishes Bounce / Complaint / Delivery events to the SNS topic (enables bounce and complaint tracking). |
| `SNS_TOPIC_ARN` | **Required in production.** ARN of the SNS topic that fronts the SES events webhook (`/webhooks/ses-events`). Any inbound SNS message whose `TopicArn` does not match is rejected with `403`. Without this var the topic-allowlist check is skipped — acceptable for local/dev only. |
| `SNS_SENDER_ID` | *(Optional)* Alphanumeric SMS sender ID where supported by the carrier (e.g. `Elevate`). |
| `SNS_SMS_TYPE` | SMS message type: `Transactional` (default) or `Promotional`. |
| `USE_LEGACY_EMAIL` | Set to `true` to fall back to Postmark instead of SES (emergency use only). |
| `USE_LEGACY_SMS` | Set to `true` to fall back to Twilio instead of SNS SMS (emergency use only). |
| AWS credentials | The standard AWS SDK credential chain is used — no additional vars required if the same IAM user / role already set for S3 (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`) is granted the SES + SNS permissions listed below. |

### One-time AWS setup

The following steps are performed once, via the AWS Console or IaC (Terraform / CloudFormation).

1. **SES — verify sending domain.** In SES → Verified identities, add `elevate.app` (or your sending domain), enable DKIM, and add the generated DNS records. **Request production access** (move out of the SES sandbox) — until granted, SES will only deliver to verified email addresses.

2. **SNS — create events topic.** In SNS → Topics, create a Standard topic (e.g. `elevate-ses-events-production`). Note its ARN and set `SNS_TOPIC_ARN` in the backend environment.

3. **SES — create configuration set.** In SES → Configuration sets, create a set (e.g. `elevate-production`). Add an event destination of type SNS; select the topic from step 2; tick the event types **Bounce**, **Complaint**, and **Delivery**. Set `SES_CONFIGURATION_SET` in the backend environment.

4. **SNS — subscribe the webhook endpoint.** In SNS → Subscriptions, create a subscription with protocol `HTTPS` and endpoint `https://<app-host>/webhooks/ses-events`. The backend will auto-confirm the subscription when SNS delivers the `SubscriptionConfirmation` message.

**IAM permissions** — the `elevate-api` IAM user requires:
```json
{
  "Effect": "Allow",
  "Action": ["ses:SendEmail", "ses:SendRawEmail", "sns:Publish"],
  "Resource": "*"
}
```

### Migration / runtime notes

- Migration `supabase/migrations/20260101000052_notifications.sql` adds four tables: `notifications`, `notification_preferences`, `notification_deliveries`, and `suppression_list`. After applying on hosted Supabase, run `NOTIFY pgrst, 'reload schema';` to flush the PostgREST schema cache (recurring gotcha — cache does not reload automatically).
- The outbox drain runs inside the worker process (`backend/src/workers/index.js`) on a one-minute cron. That process **must be running** for emails and SMS to actually send. Do **not** add the drain to `ghl-sync-once.js` — that file is a one-shot process that calls `process.exit` on completion.
- `USE_LEGACY_EMAIL` / `USE_LEGACY_SMS` are provided for emergency rollback only. In normal operation both should be unset (or set to `false`) so all sends go through SES / SNS.

### Production checklist additions

Add these items alongside the main checklist in §11:

- [ ] SES domain verified, DKIM DNS records propagated, production access granted
- [ ] SNS topic created and `SNS_TOPIC_ARN` set in the `api` service
- [ ] SES configuration set created, SNS event destination confirmed for Bounce/Complaint/Delivery; `SES_CONFIGURATION_SET` set
- [ ] `/webhooks/ses-events` HTTPS subscription confirmed (auto-confirmed on first SNS message)
- [ ] Migration `000052_notifications` applied on hosted; `NOTIFY pgrst, 'reload schema';` run
- [ ] Worker process (`src/workers/index.js`) running as a separate Railway service

## 13. Monitoring & alerts

Set up these alerts:

| Alert | Channel | Threshold |
|---|---|---|
| API 5xx errors | Slack #incidents | > 10/min |
| API p99 latency | Slack #incidents | > 2s |
| Failed Stripe webhooks | Slack #payments | any |
| DB connection pool > 80% | Slack #incidents | 80% |
| Anthropic API errors | Slack #incidents | > 5/min |
| S3 upload failures | Slack #incidents | > 5/min |

Tools:
- Railway: built-in CPU/memory/restart + deployment alerts (services `api`, `web`)
- Sentry: error alerts with grouping
- Stripe: webhook delivery alerts
- BetterStack: uptime monitoring + status page
