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
        // PII collection enabled (IP address) per owner decision, but request
        // bodies, query strings, auth headers and cookies are scrubbed below —
        // UK dental SaaS handles patient + financial special-category data, so
        // payloads must never leave the process. Scrubbing happens here at the
        // transport, not only at the snapshot layer.
        sendDefaultPii: true,
        beforeSend: scrubEvent,
        beforeSendTransaction: scrubEvent,
    });
}

// Strip request bodies, query strings, and sensitive headers from every event
// before it is sent to Sentry. Defensive against patient/financial data leaking
// into error reports. Keys are matched case-insensitively.
const SENSITIVE_HEADERS = new Set([
    "authorization", "cookie", "set-cookie", "x-api-key",
    "x-webhook-signature", "stripe-signature",
]);
function scrubEvent(event) {
    try {
        const req = event.request;
        if (req) {
            // Request/response bodies can carry patient names, notes, amounts.
            delete req.data;
            // Query strings can carry search terms / ids tied to a person.
            if (typeof req.query_string !== "undefined") req.query_string = "[scrubbed]";
            if (req.headers && typeof req.headers === "object") {
                for (const key of Object.keys(req.headers)) {
                    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
                        req.headers[key] = "[scrubbed]";
                    }
                }
            }
            if (req.cookies) req.cookies = "[scrubbed]";
        }
        // Drop any extra context bags that might carry domain payloads.
        if (event.extra) delete event.extra;
    } catch {
        // Never let scrubbing throw — drop the event rather than risk a leak.
        return null;
    }
    return event;
}

export default Sentry;
