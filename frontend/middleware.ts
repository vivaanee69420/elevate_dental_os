import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
