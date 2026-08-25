// ============================================================================
// ELEVATE DENTAL OS — Express application factory (native ESM)
// ============================================================================
// Express 4 + Supabase + Zod
// Layering: routes -> controllers -> services -> repositories -> models
// Deploy to Railway. ENV vars set via Railway dashboard.
// ============================================================================
import "dotenv/config";
import * as express_1 from "express";
import * as cors_1 from "cors";
import * as helmet_1 from "helmet";
import * as express_rate_limit_1 from "express-rate-limit";
import * as pino_http_1 from "pino-http";
import * as auth_1 from "./middleware/auth.js";
import * as audit_1 from "./middleware/audit.js";
import * as errors_1 from "./middleware/errors.js";
import { analystLock } from "./middleware/analyst-lock.js";
import * as Sentry from "@sentry/node";
// Route modules (each default-exports an express.Router)
import * as health_routes_1 from "./routes/health.routes.js";
import * as health_business_routes_1 from "./routes/health-business.routes.js";
import * as auth_routes_1 from "./routes/auth.routes.js";
import * as leads_routes_1 from "./routes/leads.routes.js";
import * as contacts_routes_1 from "./routes/contacts.routes.js";
import * as appointments_routes_1 from "./routes/appointments.routes.js";
import * as tasks_routes_1 from "./routes/tasks.routes.js";
import * as comms_routes_1 from "./routes/comms.routes.js";
import * as payments_routes_1 from "./routes/payments.routes.js";
import * as pay_runs_routes_1 from "./routes/pay-runs.routes.js";
import * as workflows_routes_1 from "./routes/workflows.routes.js";
import * as crm_templates_routes_1 from "./routes/crm-templates.routes.js";
import * as crm_settings_routes_1 from "./routes/crm-settings.routes.js";
import * as files_routes_1 from "./routes/files.routes.js";
import * as csv_import_routes_1 from "./routes/csv-import.routes.js";
import * as billing_routes_1 from "./routes/billing.routes.js";
import * as webhooks_routes_1 from "./routes/webhooks.routes.js";
import * as integrations_routes_1 from "./routes/integrations.routes.js";
import * as oauth_routes_1 from "./routes/oauth.routes.js";
import * as p4g_ai_routes_1 from "./routes/p4g-ai.routes.js";
import * as analytics_routes_1 from "./routes/analytics.routes.js";
import * as cockpit_routes_1 from "./routes/cockpit.routes.js";
import * as monthly_financials_routes_1 from "./routes/monthlyFinancials.routes.js";
import * as finance_quickbooks_routes_1 from "./routes/finance-quickbooks.routes.js";
import * as permissions_routes_1 from "./routes/permissions.routes.js";
import * as members_routes_1 from "./routes/members.routes.js";
import * as memberships_routes_1 from "./routes/memberships.routes.js";
import * as reviews_routes_1 from "./routes/reviews.routes.js";
import * as growth_routes_1 from "./routes/growth.routes.js";
import * as wealth_routes_1 from "./routes/wealth.routes.js";
import * as training_routes_1 from "./routes/training.routes.js";
import * as practices_routes_1 from "./routes/practices.routes.js";
import * as chair_utilisation_routes_1 from "./routes/chair-utilisation.routes.js";
import * as associate_routes_1 from "./routes/associate.routes.js";
import * as treatment_routes_1 from "./routes/treatment.routes.js";
import * as staff_routes_1 from "./routes/staff.routes.js";
import * as debt_routes_1 from "./routes/debt.routes.js";
import * as notification_routes_1 from "./routes/notification.routes.js";
import * as ad_attribution_routes_1 from "./routes/ad-attribution.routes.js";
import * as call_reporting_routes_1 from "./routes/call-reporting.routes.js";
import * as data_room_routes_1 from "./routes/data-room.routes.js";
import platformAdminRouter from "./routes/platform-admin.routes.js";
import platformCoursesRouter from "./routes/platform-courses.routes.js";
import * as logs_routes_1 from "./routes/logs.routes.js";
import { logger } from "./lib/logger.js";
const CORS_ALLOWED = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://app.elevate.app',
    'https://dev.elevate.app',
    'https://staging.elevate.app',
    'https://app.elevatedentalos.co.uk',
    'https://elevatedentalos.co.uk',
    'https://www.elevatedentalos.co.uk',
    'https://talented-solace-production-cd10.up.railway.app',
    process.env.FRONTEND_URL,
].filter(Boolean);
export function buildApp() {
    const app = (0, express_1.default)();
    // Trust exactly one proxy hop (Railway's edge). `true` trusted the entire
    // X-Forwarded-For chain, letting a client spoof XFF to rotate req.ip and
    // defeat the per-IP rate limiter. Override with TRUST_PROXY_HOPS if the
    // deploy fronts the app with additional proxies.
    app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
    // Logger configured in lib/logger.js (stdout always; + rotating app/error
    // files when LOG_DIR points at a persistent Volume). pino-http logs every
    // request through it; route errors/fatals also land in error.<date>.log.
    app.use((0, pino_http_1.pinoHttp)({ logger }));
    app.use((0, cors_1.default)({
        origin(origin, cb) {
            if (!origin || CORS_ALLOWED.includes(origin))
                cb(null, true);
            else
                cb(new Error('CORS blocked'));
        },
        credentials: true,
    }));
    // Helmet sets HSTS, nosniff, frameguard, etc. CSP is enabled in REPORT-ONLY
    // mode first: it logs violations (incl. the inline-styled / status page)
    // without blocking, so we can tighten to enforce mode once the report is
    // clean. Set CSP_ENFORCE=true to switch from report-only to blocking.
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: {
            useDefaults: true,
            reportOnly: process.env.CSP_ENFORCE !== 'true',
            directives: {
                defaultSrc: ["'self'"],
                // The public status page at / uses an inline <style> block.
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                // API serves JSON/HTML only — no third-party connect targets.
                upgradeInsecureRequests: [],
            },
        },
    }));
    app.use((0, express_rate_limit_1.default)({
        windowMs: 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        // Key by IP only. The previous x-user-id fallback was attacker-
        // controlled (any header value = a fresh bucket), which defeated the
        // limit on public routes. Authenticated /api uses a second limiter
        // keyed by the VERIFIED req.user.id below.
        keyGenerator: (req) => req.ip || 'anon',
    }));
    // Stripe webhook needs the raw body for signature verification.
    // Mount raw parser on that exact path BEFORE the global JSON parser.
    app.use('/webhooks/stripe', express_1.default.raw({ type: '*/*', limit: '10mb' }));
    // Dentally webhook also needs the raw body for HMAC signature verification.
    app.use('/webhooks/dentally', express_1.default.raw({ type: '*/*', limit: '10mb' }));
    app.use('/webhooks/ses-events', express_1.default.raw({ type: '*/*', limit: '1mb' }));
    // Emergent webhook needs the raw body for HMAC signature verification.
    app.use('/webhooks/emergent', express_1.default.raw({ type: '*/*', limit: '1mb' }));
    // Global JSON parser for everything else.
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use(express_1.default.urlencoded({ extended: true }));
    // ---- Root status page (public) ----
    app.get('/', (_req, res) => {
        res
            .status(200)
            .type('html')
            .send(`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Elevate Dental OS API</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #ffffff; color: #0f172a;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .card {
    width: 100%; max-width: 480px;
    border: 1px solid #e2e8f0; border-radius: 16px;
    padding: 40px; text-align: left;
  }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 600; color: #047857;
    background: #ecfdf5; border: 1px solid #a7f3d0;
    padding: 6px 12px; border-radius: 999px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
  h1 { font-size: 22px; font-weight: 700; margin: 24px 0 8px; }
  p { font-size: 14px; color: #64748b; line-height: 1.6; }
  .meta { margin-top: 28px; border-top: 1px solid #f1f5f9; padding-top: 20px; }
  .row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; }
  .row span:first-child { color: #94a3b8; }
  .row span:last-child { color: #0f172a; font-weight: 600; }
  a { color: #2563eb; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main class="card">
    <span class="badge"><span class="dot"></span>Operational</span>
    <h1>Elevate Dental OS API</h1>
    <p>This is the backend API service. There is no user interface here &mdash; the application is served separately.</p>
    <div class="meta">
      <div class="row"><span>Environment</span><span>${process.env.NODE_ENV || 'development'}</span></div>
      <div class="row"><span>Health</span><span><a href="/healthcheck">/healthcheck</a></span></div>
    </div>
  </main>
</body>
</html>`);
    });
    // ---- Public routes (no auth) ----
    app.use('/healthcheck', health_routes_1.default);
    app.use('/webhooks', webhooks_routes_1.default);
    // Public OAuth callbacks — browser redirects with no JWT; org from signed state.
    app.use('/oauth', oauth_routes_1.default);
    app.use('/auth', auth_routes_1.default);
    // ---- Platform-admin routes (own auth — see middleware/platform-auth.js) ----
    // Mounted BEFORE the tenant /api router so /api/platform/* skips
    // tenant `authenticate` entirely. Hard auth isolation between tenants
    // (Supabase JWT) and SaaS owners (PLATFORM_ADMIN_JWT_SECRET).
    // Module Library (LMS) authoring — mounted BEFORE platformAdminRouter so the
    // broad '/api/platform' mount doesn't shadow '/api/platform/courses'.
    app.use('/api/platform/courses', platformCoursesRouter);
    app.use('/api/platform', platformAdminRouter);

    // ---- Authenticated routes ----
    const api = express_1.default.Router();
    api.use(auth_1.authenticate);
    // Confines the `analyst` role (data.export only) to the Data Room
    // server-side — several legacy feature routers below carry no
    // requirePermission gate, so nav hiding alone is not a boundary.
    api.use(analystLock);
    // Per-user API rate limit: 300 requests / minute, keyed by the VERIFIED
    // user id (authenticate ran above, so req.user is trusted — unlike the
    // coarse global limiter keyed by a spoofable header). Falls back to IP if
    // req.user is somehow absent. 429 on exceed. A data-heavy dashboard page
    // fans out many parallel reads (business-hub + marketing-roi + ghl + me + …),
    // so 50/min tripped on normal navigation; 300/min keeps abuse protection
    // while comfortably covering a few page loads a minute.
    const API_RATE_MAX = Number(process.env.API_RATE_LIMIT_PER_MIN) || 300;
    api.use((0, express_rate_limit_1.default)({
        windowMs: 60 * 1000,
        max: API_RATE_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id || req.ip || 'anon',
        message: { error: `Rate limit exceeded: ${API_RATE_MAX} requests per minute` },
    }));
    api.use(audit_1.audit);
    api.use('/health', health_business_routes_1.default);
    api.use('/leads', leads_routes_1.default);
    api.use('/contacts', contacts_routes_1.default);
    api.use('/appointments', appointments_routes_1.default);
    api.use('/chair-utilisation', chair_utilisation_routes_1.default);
    api.use('/associates', associate_routes_1.default);
    api.use('/treatments', treatment_routes_1.default);
    api.use('/staff', staff_routes_1.default);
    api.use('/tasks', tasks_routes_1.default);
    api.use('/comms', comms_routes_1.default);
    api.use('/notifications', notification_routes_1.default);
    api.use('/payments', payments_routes_1.default);
    api.use('/debt', debt_routes_1.default);
    api.use('/pay-runs', pay_runs_routes_1.default);
    api.use('/workflows', workflows_routes_1.default);
    api.use('/crm/templates', crm_templates_routes_1.default);
    api.use('/crm/settings', crm_settings_routes_1.default);
    api.use('/files', files_routes_1.default);
    api.use('/imports', csv_import_routes_1.default);
    api.use('/billing', billing_routes_1.default);
    api.use('/integrations', integrations_routes_1.default);
    api.use('/p4g-ai', p4g_ai_routes_1.default);
    api.use('/analytics', analytics_routes_1.default);
    api.use('/cockpit', cockpit_routes_1.default);
    api.use('/monthly-financials', monthly_financials_routes_1.default);
    api.use('/finance/quickbooks', finance_quickbooks_routes_1.default);
    api.use('/memberships', memberships_routes_1.default);
    api.use('/reviews', reviews_routes_1.default);
    api.use('/admin/permissions', permissions_routes_1.default);
    api.use('/admin/team', members_routes_1.default);
    api.use('/growth', growth_routes_1.default);
    api.use('/wealth', wealth_routes_1.default);
    api.use('/training', training_routes_1.default);
    api.use('/practices', practices_routes_1.default);
    api.use('/ad-attribution', ad_attribution_routes_1.default);
    api.use('/call-reporting', call_reporting_routes_1.default);
    api.use('/data-room', data_room_routes_1.default);
    // Owner-only: read/download the on-disk production logs (LOG_DIR). Gated
    // here at the mount point so every route in the module is owner-restricted.
    api.use('/admin/logs', (0, auth_1.requireRole)('owner'), logs_routes_1.default);
    app.use('/api', api);
    // Sentry Express error handler — must come AFTER routes, BEFORE our handler.
    Sentry.setupExpressErrorHandler(app);
    app.use(errors_1.errorHandler);
    return app;
}
