// ============================================================================
// Sentry instrumentation — MUST be imported before any other module.
// No-op when SENTRY_DSN is unset (local/dev), so it is safe to always load.
// ============================================================================
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || "development",
        release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
        // Performance tracing. Tune down if event volume gets noisy.
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
        // PII collection enabled (IP address, request data) per owner decision.
        // Note: UK dental SaaS — keep Sentry data scrubbing on for patient/
        // financial fields; auth tokens are already redacted in logs.
        sendDefaultPii: true,
    });
}

export default Sentry;
