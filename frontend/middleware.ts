import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { canAccessRoute, type Permissions } from '@/lib/permissions';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

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
  const isPublic = ['/', '/api/health'].includes(req.nextUrl.pathname);

  if (!session && !isAuthPage && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (session && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // Per-route permission enforcement. For an authenticated, non-public,
  // non-auth page request, resolve the route id (first path segment) and,
  // if it maps to a permission key, verify the user holds it. We fetch the
  // effective permissions from the backend /auth/me using the session's
  // Bearer token (the same contract the sidebar consumes). On any failure
  // we treat the user as having no permissions — Overview-level routes
  // still resolve (canAccessRoute returns true for unmapped ids); mapped
  // routes redirect to /dashboard.
  if (session && !isAuthPage && !isPublic) {
    const routeId = req.nextUrl.pathname.split('/').filter(Boolean)[0];
    if (routeId) {
      let permissions: Permissions | null = null;
      try {
        const meRes = await fetch(`${BACKEND_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          permissions = (me?.permissions ?? null) as Permissions | null;
        }
      } catch {
        permissions = null;
      }
      if (!canAccessRoute(routeId, permissions)) {
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth|api|.*\\.png).*)'],
};
