'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await fetch('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name: fullName, organisation_name: orgName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Signup failed' }));
        throw new Error(data.error || 'Signup failed');
      }
      // Account created + signed in server-side (httpOnly cookies set).
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="card-padded w-full max-w-md">
        <h1 className="display text-3xl font-bold text-brand mb-2">Create your account</h1>
        <p className="text-ink-muted text-sm mb-6">14-day free trial · No card required</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" className="input w-full" />
          <input required value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Practice / group name" className="input w-full" />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" className="input w-full" />
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ chars)" className="input w-full" />
          {error && <div className="text-danger text-sm">{error}</div>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Creating…' : 'Start free trial'}
          </button>
        </form>
        <div className="text-center mt-4 text-sm text-ink-muted">
          Already have an account? <Link href="/login" className="text-brand hover:underline">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
