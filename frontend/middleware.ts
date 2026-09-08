import { NextRequest, NextResponse } from 'next/server';
import { SESSION_MARKER } from '@/lib/session-boundary';
import { createServerClient } from '@supabase/ssr';

const SECURE = process.env.NODE_ENV === 'production';

// Force httpOnly + Secure (prod) + SameSite on any session cookie this
// middleware writes, preserving the library-supplied maxAge/expires/domain.
function secureCookieOpts(options: any) {
  return {
    ...options,
    httpOnly: true,
    secure: SECURE,
    sameSite: 'lax' as const,
    path: options?.path ?? '/',
  };
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // ---- Platform-admin surface (parallel auth, separate cookie) ----
  // /platform/* is the SaaS-owner UI, guarded by its own httpOnly cookie
  // (platform_token) — independent of the tenant Supabase session below.
  // Login is unified on the main /login page (which sets platform_token for a
  // superadmin), so an unauthenticated platform request goes there.
  const path = req.nextUrl.pathname;
  if (path.startsWith('/platform')) {
    const platformTok = req.cookies.get('platform_token')?.value;
    if (!platformTok) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    return res;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return req.cookies.get(name)?.value; },
        set(name: string, value: string, options: any) {
          // Force the security flags rather than trusting whatever @supabase/ssr
          // passes — behind a TLS-terminating proxy the inbound request is plain
          // HTTP, so the library may emit the refreshed session cookie WITHOUT
          // Secure. Mirror lib/supabase-server.ts cookieOpts().
          res.cookies.set({ name, value, ...secureCookieOpts(options) });
        },
        remove(name: string, options: any) {
          res.cookies.set({ name, value: '', ...secureCookieOpts(options), maxAge: 0 });
        },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();

  const isAuthPage = ['/login', '/signup', '/forgot-password'].some((p) => req.nextUrl.pathname.startsWith(p));
  // /sw.js is the kill-switch service worker — must be reachable when logged
  // out (the browser fetches it before the user reaches login). /robots.txt
  // and favicons fall in the same bucket.
  const isPublic =
    req.nextUrl.pathname === '/' ||
    req.nextUrl.pathname === '/api/health' ||
    req.nextUrl.pathname === '/sw.js' ||
    req.nextUrl.pathname === '/robots.txt' ||
    req.nextUrl.pathname === '/manifest.json';

  // A signed-in platform admin who lands on an auth page goes to their console
  // (checked before the tenant session so a stray sb cookie can't shadow it).
  if (isAuthPage && req.cookies.get('platform_token')?.value) {
    return NextResponse.redirect(new URL('/platform/overview', req.url));
  }
  // ONE DAY, then sign in again. Supabase's refresh token has no absolute
  // expiry, so without this a session ran until the browser stopped using it —
  // eight weeks, on the oldest live one. The marker cookie is set at sign-in
  // with a 24h max-age, so the browser deletes it on our behalf and its
  // absence beside a live Supabase session means the day is over.
  const expiredForToday = session && !req.cookies.get(SESSION_MARKER)?.value;
  if (expiredForToday && !isAuthPage && !isPublic) {
    const out = NextResponse.redirect(new URL('/login', req.url));
    // Clear the session too, or the next request walks straight back in.
    for (const c of req.cookies.getAll()) {
      if (c.name.startsWith('sb-')) out.cookies.set({ name: c.name, value: '', path: '/', maxAge: 0 });
    }
    return out;
  }

  if ((!session || expiredForToday) && !isAuthPage && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (session && !expiredForToday && isAuthPage) {
    return NextResponse.redirect(new URL('/business-hub', req.url));
  }

  // NOTE: per-route permission enforcement is NOT done here. A blocking
  // backend /auth/me round-trip on every navigation made page loads slow.
  // It is defence-in-depth only: the sidebar hides routes the user lacks
  // (via the shared cached useMe()), and the backend independently enforces
  // permissions on every data/admin endpoint (requirePermission). Middleware
  // stays cheap — session presence + auth-page redirects only.
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth|api|.*\\.png).*)'],
};
