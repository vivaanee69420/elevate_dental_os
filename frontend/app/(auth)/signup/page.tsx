'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase-browser';

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
      await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, full_name: fullName, organisation_name: orgName }),
      });
      // Sign in after signup
      await supabase.auth.signInWithPassword({ email, password });
      router.push('/dashboard');
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
