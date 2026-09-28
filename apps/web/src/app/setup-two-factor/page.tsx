'use client';

import qrcode from 'qrcode-generator';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';

interface Setup {
  otpauthUri: string;
  secret: string;
}

/**
 * Two-factor setup (D-045): scan the QR code with an authenticator app, confirm with a code, save the backup codes.
 * Admins are sent here until it's done; anyone else can open it to turn 2FA on.
 */
export default function SetupTwoFactorPage() {
  const { status, user, request, refreshSession, logout } = useAuth();
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  // Start once per visit; the secret isn't active until confirmed with a code.
  useEffect(() => {
    if (status !== 'authenticated' || !user || user.is2faEnabled || started.current) return;
    started.current = true; // each setup call makes a new secret; only one may be in flight
    request<Setup>('/auth/2fa/setup', { method: 'POST', body: {} })
      .then(({ data }) => setSetup(data))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not start the setup.'));
  }, [status, user, request]);

  const qr = useMemo(() => {
    if (!setup) return null;
    const code = qrcode(0, 'M');
    code.addData(setup.otpauthUri);
    code.make();
    return code.createDataURL(5, 2);
  }, [setup]);

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      const { data } = await request<{ recoveryCodes: string[] }>('/auth/2fa/enable', { method: 'POST', body: { code } });
      setRecoveryCodes(data.recoveryCodes);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    await refreshSession(); // new token without the setup-only restriction
    router.replace('/');
  };

  if (status !== 'authenticated' || !user) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</main>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md p-6">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Set up two-factor authentication</h1>
        {user.is2faRequired && !recoveryCodes && (
          <Alert tone="warning" className="my-4">
            Your role requires a second step at sign-in. Set it up now to continue.
          </Alert>
        )}
        {error && <Alert className="my-4">{error}</Alert>}

        {recoveryCodes ? (
          <div className="mt-4 flex flex-col gap-4">
            <Alert tone="info">
              Two-factor authentication is on. Save these backup codes somewhere safe — each works once if you lose your
              phone. They won&apos;t be shown again.
            </Alert>
            <ul aria-label="Backup codes" className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <li key={c} className="rounded bg-slate-100 px-2 py-1 text-center">
                  {c}
                </li>
              ))}
            </ul>
            <Button onClick={() => void finish()} disabled={busy}>
              I&apos;ve saved them — continue
            </Button>
          </div>
        ) : user.is2faEnabled ? (
          <p className="mt-4 text-sm text-slate-700">Two-factor authentication is already on.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <ol className="list-decimal pl-5 text-sm text-slate-700">
              <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
              <li>Scan this code, or type the key below.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            {qr ? (
              // A data: URL generated in the browser — the secret never leaves this page.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code for your authenticator app" className="mx-auto h-48 w-48" />
            ) : (
              <div className="mx-auto h-48 w-48 animate-pulse rounded bg-slate-100" />
            )}
            {setup && (
              <p className="break-all text-center font-mono text-xs text-slate-600" aria-label="Setup key">
                {setup.secret}
              </p>
            )}
            <form onSubmit={confirm} className="flex flex-col gap-3">
              <Field
                label="Code from the app"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
              <Button type="submit" disabled={busy || !setup}>
                Turn on two-factor authentication
              </Button>
            </form>
          </div>
        )}
        <button type="button" className="mt-6 text-sm text-slate-600 underline" onClick={() => void logout()}>
          Sign out
        </button>
      </Card>
    </main>
  );
}
