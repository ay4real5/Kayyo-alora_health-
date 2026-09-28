'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { StaffForm } from '@/components/staff/staff-form';
import { Alert } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import type { StaffCandidate, StaffDetail } from '@/lib/types/people';

export default function NewStaffPage() {
  const { request, can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const candidates = useQuery({
    queryKey: ['staff', 'candidates'],
    queryFn: async () => (await request<StaffCandidate[]>('/staff/candidates')).data,
  });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Add staff profile"
        subtitle="A staff profile adds employment details to an existing login. Create the login in Users first."
      />
      {candidates.data?.length === 0 && (
        <Alert tone="info">Everyone who can sign in already has a staff profile. Add the person in Users first.</Alert>
      )}
      <StaffForm
        candidates={candidates.data}
        showPay={can('payroll:read')}
        submitLabel="Create staff profile"
        onSubmit={async (body) => {
          const { data } = await request<StaffDetail>('/staff', { method: 'POST', body });
          await queryClient.invalidateQueries({ queryKey: ['staff'] });
          router.push(`/staff/${data.id}`);
        }}
      />
    </div>
  );
}
