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
const memberships_routes_1 = __importDefault(require("./routes/memberships.routes"));
const reviews_routes_1 = __importDefault(require("./routes/reviews.routes"));
const CORS_ALLOWED = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://app.elevate.app',
    'https://dev.elevate.app',
    'https://staging.elevate.app',
];
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
    app.use('/api', api);
    app.use(errors_1.errorHandler);
    return app;
}
