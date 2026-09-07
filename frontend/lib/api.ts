// Calls the same-origin proxy (/api/backend/*). The JWT lives in an httpOnly
// cookie sent automatically; the proxy injects the Bearer token server-side.
const PROXY_BASE = '/api/backend';

/**
 * The Error a failed call throws, carrying the response ALONGSIDE its message.
 *
 * It used to throw a bare `new Error(err.error)`, which discarded the status
 * and any structured payload. That is fine for a message a screen only
 * displays, and useless for a refusal the caller has to ACT on — a delete
 * blocked by the records it would destroy has to hand back which records, or
 * the UI can only repeat the sentence and offer no way forward.
 *
 * Additive: `message` is unchanged, so every existing caller behaves exactly
 * as before.
 */
export class ApiError extends Error {
  status: number;
  details?: unknown;
  code?: string;
  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = body.details;
    this.code = body.code as string | undefined;
  }
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new ApiError(err.error || `HTTP ${res.status}`, res.status, err);
  }
  return res.json();
}
