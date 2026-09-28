'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { PhysicianForm } from '@/components/physicians/physician-form';
import { Button } from '@/components/ui/button';
import { DetailList, ErrorAlert, PageHeader, StatusBadge } from '@/components/ui/data-display';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Physician } from '@/lib/types/people';

/** View a physician; people with physicians:update can edit and (de)activate. Physicians are never deleted. */
export default function PhysicianPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const physician = useQuery({
    queryKey: ['physicians', id],
    queryFn: async () => (await request<Physician>(`/physicians/${id}`)).data,
  });
  const toggle = useMutation({
    mutationFn: (isActive: boolean) => request(`/physicians/${id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['physicians'] }),
  });

  if (physician.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!physician.data) return <ErrorAlert error={physician.error} />;
  const p = physician.data;
  const canEdit = can('physicians:update');

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Dr. {p.firstName} {p.lastName} <StatusBadge status={p.isActive ? 'active' : 'inactive'} />
          </span>
        }
        subtitle={p.practiceName ?? undefined}
        actions={
          canEdit && (
            <Button variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate(!p.isActive)}>
              {p.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          )
        }
      />
      <ErrorAlert error={toggle.error} />
      {canEdit ? (
        <PhysicianForm
          physician={p}
          submitLabel="Save changes"
          onSubmit={async (body) => {
            await request(`/physicians/${id}`, { method: 'PATCH', body });
            await queryClient.invalidateQueries({ queryKey: ['physicians'] });
            router.push('/physicians');
          }}
        />
      ) : (
        <Card className="p-5">
          <DetailList
            items={[
              ['NPI', p.npi],
              ['Phone', p.phone],
              ['Fax', p.fax],
              ['Email', p.email],
              ['Address', [p.addressLine1, p.city, p.state, p.zip].filter(Boolean).join(', ')],
            ]}
          />
        </Card>
      )}
    </div>
  );
}
