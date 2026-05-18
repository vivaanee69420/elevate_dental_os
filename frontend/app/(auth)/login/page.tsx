'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase-browser';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    router.push('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="card-padded w-full max-w-md">
        <h1 className="display text-3xl font-bold text-brand mb-2">Elevate Dental OS</h1>
        <p className="text-ink-muted text-sm mb-6">Sign in to your account</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="input w-full" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="input w-full" />
          {error && <div className="text-danger text-sm">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="text-center mt-4 text-sm text-ink-muted">
          <Link href="/forgot-password" className="text-brand hover:underline">Forgot password?</Link>
          <span className="mx-2">·</span>
          <Link href="/signup" className="text-brand hover:underline">Create account</Link>
        </div>
      </div>
    </div>
  );
}
