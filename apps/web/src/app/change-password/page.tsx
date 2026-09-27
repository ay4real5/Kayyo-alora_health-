'use client';

import { checkPassword } from '@alora/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';
import type { SessionTokens } from '@/lib/auth/types';

function ChangePasswordForm() {
  const { status, request, adoptTokens } = useAuth();
  const router = useRouter();
  const required = useSearchParams().get('required') === '1';
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = newPassword ? checkPassword(newPassword).problems : [];

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('newPassword') !== form.get('confirm')) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The API ends every other session and returns fresh tokens for this one.
      const { data } = await request<SessionTokens>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') },
        cookieAuth: true, // so the API puts the new refresh token in the httpOnly cookie
      });
      adoptTokens(data);
      router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Change your password</h1>
        {required && (
          <Alert tone="warning" className="my-4">
            Your password was set by an administrator or has expired. Choose a new one to continue.
          </Alert>
        )}
        {error && <Alert className="my-4">{error}</Alert>}
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
          <Field
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint="At least 12 characters, with upper and lower case letters, a number and a symbol."
            error={problems.length ? `Password ${problems.join(', ')}` : undefined}
          />
          <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
          <Button type="submit" disabled={busy || problems.length > 0}>
            {busy ? 'Saving…' : 'Change password'}
          </Button>
        </form>
      </Card>
    </main>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense>
      <ChangePasswordForm />
    </Suspense>
  );
}
