"use strict";
// ============================================================================
// ELEVATE DENTAL OS — Express application factory
// ============================================================================
// Express 4 + TypeScript + Supabase + Zod
// Layering: routes -> controllers -> services -> repositories -> models
// Deploy to Railway. ENV vars set via Railway dashboard.
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const pino_http_1 = require("pino-http");
const auth_1 = require("./middleware/auth");
const audit_1 = require("./middleware/audit");
const errors_1 = require("./middleware/errors");
const Sentry = require("@sentry/node");
// Route modules (each exports an express.Router)
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const health_business_routes_1 = __importDefault(require("./routes/health-business.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const leads_routes_1 = __importDefault(require("./routes/leads.routes"));
const contacts_routes_1 = __importDefault(require("./routes/contacts.routes"));
const appointments_routes_1 = __importDefault(require("./routes/appointments.routes"));
const tasks_routes_1 = __importDefault(require("./routes/tasks.routes"));
const comms_routes_1 = __importDefault(require("./routes/comms.routes"));
const payments_routes_1 = __importDefault(require("./routes/payments.routes"));
const pay_runs_routes_1 = __importDefault(require("./routes/pay-runs.routes"));
const workflows_routes_1 = __importDefault(require("./routes/workflows.routes"));
const files_routes_1 = __importDefault(require("./routes/files.routes"));
const billing_routes_1 = __importDefault(require("./routes/billing.routes"));
const webhooks_routes_1 = __importDefault(require("./routes/webhooks.routes"));
const integrations_routes_1 = __importDefault(require("./routes/integrations.routes"));
const p4g_ai_routes_1 = __importDefault(require("./routes/p4g-ai.routes"));
const analytics_routes_1 = __importDefault(require("./routes/analytics.routes"));
const permissions_routes_1 = __importDefault(require("./routes/permissions.routes"));
const memberships_routes_1 = __importDefault(require("./routes/memberships.routes"));
const reviews_routes_1 = __importDefault(require("./routes/reviews.routes"));
const CORS_ALLOWED = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://app.elevate.app',
    'https://dev.elevate.app',
    'https://staging.elevate.app',
    'https://talented-solace-production-cd10.up.railway.app',
    process.env.FRONTEND_URL,
].filter(Boolean);
function buildApp() {
    const app = (0, express_1.default)();
    app.set('trust proxy', true);
    app.use((0, pino_http_1.pinoHttp)({
        level: process.env.LOG_LEVEL || 'info',
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    }));
    app.use((0, cors_1.default)({
        origin(origin, cb) {
            if (!origin || CORS_ALLOWED.includes(origin))
                cb(null, true);
            else
                cb(new Error('CORS blocked'));
        },
        credentials: true,
    }));
    app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
    app.use((0, express_rate_limit_1.default)({
        windowMs: 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.headers['x-user-id'] || req.ip || 'anon',
    }));
    // Stripe webhook needs the raw body for signature verification.
    // Mount raw parser on that exact path BEFORE the global JSON parser.
    app.use('/webhooks/stripe', express_1.default.raw({ type: '*/*', limit: '10mb' }));
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
    app.use('/auth', auth_routes_1.default);
    // ---- Authenticated routes ----
    const api = express_1.default.Router();
    api.use(auth_1.authenticate);
    api.use(audit_1.audit);
    api.use('/health', health_business_routes_1.default);
    api.use('/leads', leads_routes_1.default);
    api.use('/contacts', contacts_routes_1.default);
    api.use('/appointments', appointments_routes_1.default);
    api.use('/tasks', tasks_routes_1.default);
    api.use('/comms', comms_routes_1.default);
    api.use('/payments', payments_routes_1.default);
    api.use('/pay-runs', pay_runs_routes_1.default);
    api.use('/workflows', workflows_routes_1.default);
    api.use('/files', files_routes_1.default);
    api.use('/billing', billing_routes_1.default);
    api.use('/integrations', integrations_routes_1.default);
    api.use('/p4g-ai', p4g_ai_routes_1.default);
    api.use('/analytics', analytics_routes_1.default);
    api.use('/memberships', memberships_routes_1.default);
    api.use('/reviews', reviews_routes_1.default);
    api.use('/admin/permissions', permissions_routes_1.default);
    app.use('/api', api);
    // Sentry Express error handler — must come AFTER routes, BEFORE our handler.
    Sentry.setupExpressErrorHandler(app);
    app.use(errors_1.errorHandler);
    return app;
}
