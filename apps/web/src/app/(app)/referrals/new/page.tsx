'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ReferralForm } from '@/components/referrals/referral-form';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Referral } from '@/lib/types/referrals';

export default function NewReferralPage() {
  const { request, can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: async (body: Record<string, string | null>) => (await request<Referral>('/referrals', { method: 'POST', body })).data,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['referrals'] });
      router.push(`/referrals/${r.id}`);
    },
  });
  if (!can('referrals:manage')) return <PageHeader title="Add referral" subtitle="You don't have access to add referrals." />;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Add referral" subtitle="Someone asking about care — a call, a hospital discharge planner, a family member." />
      <Card className="p-5">
        <ReferralForm busy={create.isPending} error={create.error} submitLabel="Add referral" onSubmit={(body) => create.mutate(body)} />
      </Card>
    </div>
  );
}
