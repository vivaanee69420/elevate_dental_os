/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Dev writes to .next-dev, `next build` keeps .next. Both used to share
  // .next, so running `next build` while `next dev` was up overwrote the
  // running server's webpack-runtime.js and chunk layout underneath it —
  // the runtime then resolved chunks it could no longer find
  // ("Cannot find module './8948.js'"), every route 500'd, and the CSS
  // request fell through to the HTML 404 page, rendering the whole app
  // unstyled. Separate directories make that collision impossible.
  // Production output stays at .next — the Dockerfile copies
  // .next/standalone and .next/static.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  experimental: { instrumentationHook: true },
  webpack: (config, { dev }) => {
    // Dev: use memory-only webpack cache. The default on-disk PackFileCache
    // persists corrupted chunks across restarts, causing chunk 404s -> CSS/JS
    // served as the HTML 404 page -> "MIME type ('text/html')" errors.
    // Memory cache makes a plain restart self-healing.
    if (dev) {
      config.cache = { type: 'memory' };
    }
    return config;
  },
  async headers() {
    return [
      // Kill-switch service worker: never cache, allow root scope.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      // Default security headers everywhere.
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // CSP in REPORT-ONLY mode: surfaces violations without breaking the
          // UI so the policy can be tuned, then promoted to enforcing
          // (Content-Security-Policy) once clean. Next.js needs 'unsafe-inline'
          // for its injected styles and (in this setup) inline hydration; tighten
          // toward nonces before flipping to enforce. connect-src covers the
          // same-origin API proxy and the Supabase project.
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}`.trim(),
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
