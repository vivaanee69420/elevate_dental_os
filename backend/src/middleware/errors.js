import * as zod_1 from "zod";

// AppError lets services throw with an explicit status code.
export class AppError extends Error {
    statusCode;
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err, req, res, _next) {
    if (err instanceof zod_1.ZodError) {
        return res.status(400).json({
            error: 'Validation failed',
            issues: err.issues,
        });
    }
    req.log?.error({ err }, 'Request error');
    const status = err instanceof AppError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : 'Internal server error';
    return res.status(status).json({
        error: status >= 500 ? 'Internal server error' : message,
    });
}
