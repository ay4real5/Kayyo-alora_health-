'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';
import type { LoginOutcome } from '@/lib/auth/types';

const REASONS: Record<string, string> = {
  idle: 'You were signed out after 15 minutes without activity.',
  expired: 'Your session ended. Please sign in again.',
};

function LoginForm() {
  const { login, verifyTwoFactor, status } = useAuth();
  const router = useRouter();
  const reason = useSearchParams().get('reason');
  const [step, setStep] = useState<'password' | 'two-factor'>('password');
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once sign-in has chosen where to go (e.g. the forced password change), so the effect below doesn't override it.
  const redirected = useRef(false);

  useEffect(() => {
    if (status === 'authenticated' && step === 'password' && !busy && !redirected.current) router.replace('/');
  }, [status, step, busy, router]);

  const proceed = (outcome: LoginOutcome) => {
    if (outcome.kind === 'two-factor') {
      setTwoFactorToken(outcome.twoFactorToken);
      setStep('two-factor');
      return;
    }
    redirected.current = true;
    router.replace(
      outcome.mustChangePassword ? '/change-password?required=1' : outcome.mustEnable2fa ? '/setup-two-factor' : '/',
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (step === 'password') {
        proceed(await login(String(form.get('email')), String(form.get('password'))));
      } else {
        const value = String(form.get('code')).trim();
        proceed(await verifyTwoFactor(twoFactorToken, useRecovery ? { recoveryCode: value } : { code: value }));
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
      setError(message);
      if (e instanceof ApiError && e.status === 401 && step === 'two-factor' && /expired/i.test(e.message)) {
        setStep('password');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold text-slate-900">Alora Health</h1>
        <p className="mb-6 text-sm text-slate-600">
          {step === 'password' ? 'Sign in to your agency account' : 'Two-step verification'}
        </p>

        {reason && REASONS[reason] && step === 'password' && (
          <Alert tone="info" className="mb-4">
            {REASONS[reason]}
          </Alert>
        )}
        {error && <Alert className="mb-4">{error}</Alert>}

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {step === 'password' ? (
            <>
              <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
              <Field label="Password" name="password" type="password" autoComplete="current-password" required />
            </>
          ) : (
            <>
              <Field
                key={useRecovery ? 'recovery' : 'code'}
                label={useRecovery ? 'Backup code' : 'Authentication code'}
                name="code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                placeholder={useRecovery ? 'XXXX-XXXX-XXXX-XXXX' : '123456'}
                hint={useRecovery ? 'Each backup code works once.' : 'The 6-digit code from your authenticator app.'}
                required
                autoFocus
              />
              <button
                type="button"
                className="self-start text-sm text-teal-800 underline"
                onClick={() => setUseRecovery((v) => !v)}
              >
                {useRecovery ? 'Use my authenticator app instead' : "I don't have my phone — use a backup code"}
              </button>
            </>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Checking…' : step === 'password' ? 'Sign in' : 'Verify'}
          </Button>
        </form>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
