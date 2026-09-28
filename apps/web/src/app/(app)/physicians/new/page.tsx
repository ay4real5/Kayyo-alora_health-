'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { PhysicianForm } from '@/components/physicians/physician-form';
import { PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

export default function NewPhysicianPage() {
  const { request } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Add physician" />
      <PhysicianForm
        submitLabel="Add physician"
        onSubmit={async (body) => {
          await request('/physicians', { method: 'POST', body });
          await queryClient.invalidateQueries({ queryKey: ['physicians'] });
          router.push('/physicians');
        }}
      />
    </div>
  );
}
