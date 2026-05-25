import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Same-origin proxy for /api/platform/* — reads the platform_token httpOnly
// cookie and injects it as a Bearer header to the backend. Browser JS never
// touches the platform JWT.
async function proxy(req: NextRequest, path: string[]) {
  const token = req.cookies.get('platform_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const search = req.nextUrl.search;
  const target = `${BACKEND_URL}/api/platform/${path.join('/')}${search}`;

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
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
    return NextResponse.json(
      { error: 'Backend unreachable. Check BACKEND_URL.' },
      { status: 502 },
    );
  }

  const text = await res.text();
  const out = new NextResponse(text, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/json',
    },
  });
  // If backend says the token is stale, clear the cookie so the user lands
  // back on /platform/login on the next nav instead of looping 401s.
  if (res.status === 401) {
    out.cookies.set('platform_token', '', { httpOnly: true, path: '/', maxAge: 0 });
  }
  return out;
}

type Ctx = { params: { path: string[] } };

export const GET = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const POST = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const PUT = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const PATCH = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const DELETE = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
