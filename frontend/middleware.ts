import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          res.cookies.set({ name, value: '', ...options });
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
  if (!session && !isAuthPage && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (session && isAuthPage) {
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
