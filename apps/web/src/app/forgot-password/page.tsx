'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ApiError, apiRequest } from '@/lib/api';
import { AuthLayout } from '@/components/layout/auth-layout';

/** "Forgot password" (D-072): the answer never says whether the address has an account. */
export default function ForgotPasswordPage() {
  const [result, setResult] = useState<{ emailAvailable: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiRequest<{ accepted: true; emailAvailable: boolean }>('/auth/forgot-password', {
        method: 'POST',
        body: { email: String(form.get('email')) },
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Card className="w-full p-6 sm:p-8">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Forgot your password?</h1>
        {result ? (
          <div role="status" className="mt-4 flex flex-col gap-4 text-sm text-slate-700">
            {result.emailAvailable ? (
              <p>
                If that address belongs to an Primordial Health account, we’ve sent it a link to choose a new password. The link works
                once, for 30 minutes. Check your spam folder if it doesn’t arrive.
              </p>
            ) : (
              <p>
                Password reset by email isn’t set up for your agency yet. Ask your agency administrator to reset your password
                for you.
              </p>
            )}
            <Link href="/login" className="text-brand-800 underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-600">Enter your email and we’ll send you a link to choose a new one.</p>
            {error && <Alert className="mb-4">{error}</Alert>}
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>
              <Link href="/login" className="text-sm text-brand-800 underline">
                Back to sign in
              </Link>
            </form>
          </>
        )}
      </Card>
    </AuthLayout>
  );
}
