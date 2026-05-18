'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase-browser';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="card-padded w-full max-w-md">
        <h1 className="display text-2xl font-bold mb-2">Reset password</h1>
        {sent ? (
          <p className="text-sm">Check your email for reset link.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" className="input w-full" />
            <button type="submit" className="btn-primary w-full">Send reset link</button>
          </form>
        )}
        <Link href="/login" className="text-brand text-sm mt-4 block text-center hover:underline">← Back to sign in</Link>
      </div>
    </div>
  );
}
