'use client';

import { checkPassword } from '@alora/shared';
import Link from 'next/link';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ApiError, apiRequest } from '@/lib/api';

/** The token travels in the URL fragment (#token=…), which browsers never send to a server (D-072). */
const readToken = () => /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(window.location.hash)?.[1] ?? '';
const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

export default function ResetPasswordPage() {
  const token = useSyncExternalStore(subscribe, readToken, () => '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const problems = newPassword ? checkPassword(newPassword).problems : [];

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
      await apiRequest('/auth/reset-password', { method: 'POST', body: { token, newPassword: form.get('newPassword') } });
      // The link is used up; drop it from the address bar and history.
      window.history.replaceState(null, '', '/reset-password');
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Choose a new password</h1>
        {done ? (
          <div role="status" className="mt-4 flex flex-col gap-4 text-sm text-slate-700">
            <p>Your password was changed and you were signed out everywhere. Sign in with the new password.</p>
            <Link href="/login" className="text-teal-800 underline">
              Sign in
            </Link>
          </div>
        ) : !token ? (
          <div className="mt-4 flex flex-col gap-4 text-sm text-slate-700">
            <Alert>This page needs the link from your reset email. Open the link again, or ask for a new one.</Alert>
            <Link href="/forgot-password" className="text-teal-800 underline">
              Send me a new link
            </Link>
          </div>
        ) : (
          <>
            {error && <Alert className="my-4">{error}</Alert>}
            <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
              <Field
                label="New password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                autoFocus
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                hint="At least 12 characters, with upper and lower case letters, a number and a symbol."
                error={problems.length ? `Password ${problems.join(', ')}` : undefined}
              />
              <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
              <Button type="submit" disabled={busy || problems.length > 0}>
                {busy ? 'Saving…' : 'Set new password'}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
