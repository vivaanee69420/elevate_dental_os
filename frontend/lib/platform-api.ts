// Client for the platform-owner API surface. Same pattern as lib/api.ts but
// hits /api/platform-backend/* (which reads the platform_token httpOnly cookie
// and forwards as Bearer).
const PROXY_BASE = '/api/platform-backend';

export async function platformApi<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
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

// NOTE: platform login is unified into the main /login page (POST /auth/login),
// which sets the platform_token cookie for a superadmin. There is intentionally
// no separate platform login client here — one login path only.

export async function platformLogout() {
  await fetch('/api/platform-auth/logout', { method: 'POST' });
}
