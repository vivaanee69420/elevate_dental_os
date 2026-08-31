import * as zod_1 from "zod";

// AppError lets services throw with an explicit status code.
export class AppError extends Error {
    statusCode;
    code;
    // `code` is an optional machine-readable tag (e.g. 'FEATURE_DISABLED')
    // surfaced alongside `message` for callers that branch on it instead of
    // parsing the human-readable string. Existing 2-arg call sites are
    // unaffected — `code` stays undefined and is omitted from the response.
    constructor(message, statusCode = 500, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

// _next is required so Express treats this as error-handling middleware.
export function errorHandler(err, req, res, _next) {
    if (err instanceof zod_1.ZodError) {
        return res.status(400).json({
            error: 'Validation failed',
            issues: err.issues,
        });
    }
    req.log?.error({ err }, 'Request error');
    const isApp = err instanceof AppError;
    const status = isApp ? err.statusCode : 500;
    // Always surface unexpected 5xx to the server console — req.log may not be
    // wired in every context, and a masked generic 500 is undebuggable otherwise.
    if (!isApp && status >= 500) {
        console.error(`[error] ${req.method} ${req.originalUrl} →`, err?.stack || err);
    }
    // AppError messages are operator-authored and safe to surface at ANY status
    // (e.g. a 501 "not configured"). Only mask UNEXPECTED (non-AppError) errors,
    // which may leak internals — those always read as a generic 500.
    // In non-production we surface the real message (+ stack) to speed debugging.
    const isProd = process.env.NODE_ENV === 'production';
    const message = isApp
        ? err.message
        : (status >= 500
            ? (isProd ? 'Internal server error' : (err instanceof Error ? err.message : 'Internal server error'))
            : (err instanceof Error ? err.message : 'Internal server error'));
    const body = { error: message };
    if (isApp && err.code) body.code = err.code;
    if (!isProd && !isApp && err instanceof Error && err.stack) {
        body.stack = err.stack.split('\n').slice(0, 6);
    }
    return res.status(status).json(body);
}
