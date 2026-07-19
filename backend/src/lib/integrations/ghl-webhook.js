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
            last = { ok: false, status: res.status, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };

            // 4xx is a configuration problem — a bad URL will still be bad in a second.
            if (res.status < 500) return last;
        } catch (err) {
            last = { ok: false, status: 0, error: String(err?.message ?? err) };
        } finally {
            clearTimeout(timer);
        }

        if (attempt < retries) await sleep(retryDelayMs);
    }

    return last;
}
