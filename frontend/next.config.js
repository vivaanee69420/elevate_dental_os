/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: { instrumentationHook: true },
  webpack: (config, { dev }) => {
    // Dev: use memory-only webpack cache. The default on-disk PackFileCache
    // persists corrupted chunks across restarts (e.g. when two dev servers
    // briefly share .next), causing chunk 404s -> CSS/JS served as the HTML
    // 404 page -> "MIME type ('text/html')" errors. Memory cache makes a plain
    // restart self-healing, so no more manual `rm -rf .next`.
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
        ],
      },
    ];
  },
};

module.exports = nextConfig;
