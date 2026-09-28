'use client';

import { checkPassword } from '@alora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { RolePicker } from '@/components/users/role-picker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import type { UserView } from '@/lib/types/people';

export default function NewUserPage() {
  const { request } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const problems = password ? checkPassword(password).problems : [];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const phone = String(form.get('phone') ?? '').trim();
      const { data } = await request<UserView>('/users', {
        method: 'POST',
        body: {
          email: form.get('email'),
          firstName: form.get('firstName'),
          lastName: form.get('lastName'),
          ...(phone ? { phone } : {}),
          password,
          roleIds,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      router.push(`/users/${data.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Add user" subtitle="They must choose their own password the first time they sign in." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <ErrorAlert error={error} />
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="First name" name="firstName" required />
          <Field label="Last name" name="lastName" required />
          <Field label="Email" name="email" type="email" required autoComplete="off" />
          <Field label="Phone" name="phone" type="tel" />
          <Field
            label="Starting password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Share it securely; they will be asked to change it."
            error={problems.length ? `Password ${problems.join(', ')}` : undefined}
            className="sm:col-span-2"
          />
        </Card>
        <Card className="p-5">
          <RolePicker selected={roleIds} onChange={setRoleIds} />
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || problems.length > 0}>
            {busy ? 'Saving…' : 'Add user'}
          </Button>
        </div>
      </form>
    </div>
  );
}
