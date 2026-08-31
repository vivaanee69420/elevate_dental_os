import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRoute } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Defence-in-depth against path traversal / host repointing. The base host is
// fixed server-side; this rejects any catch-all path that could escape it
// (scheme prefix, protocol-relative //, backslash, .. traversal, leading /).
// Next normalises segments before this runs, but we don't want to rely on that.
function safeBackendPath(path: string[]): string | null {
  const joined = path.join('/');
  if (
    joined.startsWith('/') ||
    joined.includes('\\') ||
    joined.includes('//') ||
    /(^|\/)\.\.(\/|$)/.test(joined) ||
    /^[a-z][a-z0-9+.-]*:/i.test(joined) ||
    !/^[A-Za-z0-9/_\-.]+$/.test(joined)
  ) {
    return null;
  }
  return joined;
}

// Same-origin proxy. Browser never sees the JWT (httpOnly cookie).
// This handler reads the session server-side and injects the Bearer token.
async function proxy(req: NextRequest, path: string[]) {
  const supabase = getSupabaseRoute();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const safe = safeBackendPath(path);
  if (safe === null) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }
  const search = req.nextUrl.search;
  const target = `${BACKEND_URL}/${safe}${search}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  };
  // Agency switch (A2): re-inject the httpOnly switch cookie as a header the
  // backend validates per request. Absent cookie -> header absent -> home org.
  const agencySwitch = req.cookies.get('agency_switch')?.value;
  if (agencySwitch) headers['x-agency-switch'] = agencySwitch;
  // Multi-org membership: which of the caller's accounts they are acting in.
  // The backend re-validates it against their memberships every request, so an
  // stale or forged value simply falls back to their home account.
  const activeOrg = req.cookies.get('active_org')?.value;
  if (activeOrg) headers['x-active-org'] = activeOrg;
  const contentType = req.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
    });
  } catch {
    // Backend unreachable (e.g. BACKEND_URL unset → localhost in a deployed
    // container). Surface a clear 502 instead of an opaque Next 500.
    return NextResponse.json(
      { error: 'Backend unreachable. Check BACKEND_URL configuration.' },
      { status: 502 }
    );
  }

  const resContentType = res.headers.get('content-type') || 'application/json';

  // File downloads (Data Room CSV export) are streamed straight through so a
  // 200k-row export never sits in this process's memory. Everything else
  // keeps the buffered path (unchanged behaviour).
  if (resContentType.startsWith('text/csv')) {
    const headers: Record<string, string> = { 'Content-Type': resContentType };
    const disposition = res.headers.get('content-disposition');
    if (disposition) headers['Content-Disposition'] = disposition;
    const cache = res.headers.get('cache-control');
    if (cache) headers['Cache-Control'] = cache;
    return new NextResponse(res.body, { status: res.status, headers });
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'Content-Type': resContentType },
  });
}

type Ctx = { params: { path: string[] } };

export const GET = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const POST = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const PUT = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const PATCH = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const DELETE = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
