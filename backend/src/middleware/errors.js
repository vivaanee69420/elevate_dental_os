import * as zod_1 from "zod";

// AppError lets services throw with an explicit status code.
export class AppError extends Error {
    statusCode;
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
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
    // Some services throw a plain Error decorated with a numeric `.status`
    // (Object.assign(new Error(...), { status })) rather than AppError —
    // treat that the same as AppError for status-code purposes so those
    // operator-authored 4xx messages surface instead of collapsing to 500.
    const hasPlainStatus = !isApp && Number.isInteger(err?.status) && err.status >= 400 && err.status < 600;
    const status = isApp ? err.statusCode : (hasPlainStatus ? err.status : 500);
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
    if (!isProd && !isApp && err instanceof Error && err.stack) {
        body.stack = err.stack.split('\n').slice(0, 6);
    }
    return res.status(status).json(body);
}
