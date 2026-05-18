import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

// httpOnly session cookies: browser JS cannot read the JWT.
// Only server code (route handlers, middleware, server components) touches it.
const SECURE = process.env.NODE_ENV === 'production';

function cookieOpts(options: CookieOptions): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    secure: SECURE,
    sameSite: 'lax',
    path: '/',
  };
}

// Read-only client for server components (cookie writes are a no-op there —
// Next forbids setting cookies during render; middleware/route handlers refresh).
export function getSupabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
      },
    }
  );
}

// Writable client for Route Handlers / Server Actions — sets httpOnly cookies.
export function getSupabaseRoute() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...cookieOpts(options) });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...cookieOpts(options), maxAge: 0 });
        },
      },
    }
  );
}
