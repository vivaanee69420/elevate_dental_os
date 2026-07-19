// POST a flat JSON payload to a GoHighLevel Inbound Webhook URL.
//
// GHL inbound webhooks are unauthenticated — the URL itself is the secret.
// They return 200 on accept; anything else is a failure.
//
// This never throws: a failed report must not take down the cron for other
// organisations, so the caller gets a result object instead of an exception.

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Failure results are persisted (last_status/last_error) and shown in the UI,
// so nothing that reaches them may carry the webhook URL — it is the
// send-anything credential. The observed Node/undici error classes for this
// path don't embed it today, but nothing structurally prevents a future one
// from doing so (some network errors do include the request URL), so scrub
// both the full URL and its origin out of any error string before it can be
// stored or shown.
function scrubUrl(message, url) {
    if (!message || !url) return message;
    let scrubbed = message.split(url).join('[webhook url]');
    try {
        const origin = new URL(url).origin;
        if (origin) scrubbed = scrubbed.split(origin).join('[webhook url]');
    } catch {
        // Not a parseable URL — nothing more to scrub.
    }
    return scrubbed;
}

export async function postToInboundWebhook(url, payload, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = opts.retries ?? DEFAULT_RETRIES;
    const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    let last = { ok: false, status: 0, error: 'not attempted' };

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            if (res.ok) return { ok: true, status: res.status };

            const body = await res.text().catch(() => '');
            last = { ok: false, status: res.status, error: scrubUrl(`HTTP ${res.status}: ${body.slice(0, 200)}`, url) };

            // 4xx is a configuration problem — a bad URL will still be bad in a second.
            if (res.status < 500) return last;
        } catch (err) {
            last = { ok: false, status: 0, error: scrubUrl(String(err?.message ?? err), url) };
        } finally {
            clearTimeout(timer);
        }

        if (attempt < retries) await sleep(retryDelayMs);
    }

    return last;
}
