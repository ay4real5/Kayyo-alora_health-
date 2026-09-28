'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { StaffForm } from '@/components/staff/staff-form';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import type { StaffDetail } from '@/lib/types/people';

export default function EditStaffPage() {
  const { id } = useParams<{ id: string }>();
  const { request } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: ['staff', id], queryFn: async () => (await request<StaffDetail>(`/staff/${id}`)).data });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={staff.data ? `Edit ${staff.data.firstName} ${staff.data.lastName}` : 'Edit staff profile'} />
      <ErrorAlert error={staff.error} />
      {staff.data && (
        <StaffForm
          staff={staff.data}
          showPay={Boolean(staff.data.pay)}
          submitLabel="Save changes"
          onSubmit={async (body) => {
            await request(`/staff/${id}`, { method: 'PATCH', body });
            await queryClient.invalidateQueries({ queryKey: ['staff'] });
            router.push(`/staff/${id}`);
          }}
        />
      )}
    </div>
  );
}
