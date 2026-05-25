'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Sign in failed');
      return;
    }
    // The route decides the destination: /dashboard for tenants,
    // /platform/overview for a platform superadmin.
    router.push(data.redirect || '/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex">
      {/* Brand panel */}
      <div className="hidden lg:flex w-1/2 bg-brand text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute -bottom-32 -right-32 w-[380px] h-[380px] rounded-full bg-white/5" />
        <div className="absolute top-[30%] -left-20 w-[280px] h-[280px] rounded-full bg-white/5" />
        <div className="relative z-10 flex items-center gap-2">
          <div className="w-9 h-9 rounded-md bg-white/10 flex items-center justify-center font-display font-bold text-lg">E</div>
          <span className="font-display text-lg font-semibold">Elevate Dental OS</span>
        </div>
        <div className="relative z-10">
          <h1 className="font-display text-4xl font-semibold leading-tight mb-4 max-w-md">
            The operating system every UK dental practice owner has been waiting for.
          </h1>
          <p className="text-white/80 text-sm max-w-md">
            One platform. Cash flow, P&amp;L, patient pipeline, lab invoices, associate pay,
            and an AI CFO that answers any question about your business in plain English.
          </p>
        </div>
        <div className="relative z-10 text-[11px] text-white/60">© 2026 Elevate Dental OS · UK</div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-semibold mb-1">Welcome back</h2>
          <p className="text-ink-muted mb-6">Sign in to your practice dashboard</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Email</label>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@practice.co.uk"
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Password</label>
              <input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input w-full"
              />
            </div>
            {error && <div className="text-danger text-sm">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="text-center mt-4 text-sm">
            <Link href="/forgot-password" className="text-brand hover:underline">Forgot password?</Link>
          </div>
          <p className="text-center text-ink-muted text-sm mt-5">
            No account?{' '}
            <Link href="/signup" className="text-brand font-medium hover:underline">
              Start your 14-day trial
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
