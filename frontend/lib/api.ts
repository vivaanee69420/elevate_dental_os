// Calls the same-origin proxy (/api/backend/*). The JWT lives in an httpOnly
// cookie sent automatically; the proxy injects the Bearer token server-side.
const PROXY_BASE = '/api/backend';

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
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
