'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { PatientForm } from '@/components/patients/patient-form';
import { PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import type { PatientDetail } from '@/lib/types/patients';

export default function AdmitPatientPage() {
  const { request } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Admit patient" subtitle="The patient starts as active; the admission date defaults to today." />
      <PatientForm
        submitLabel="Admit patient"
        onSubmit={async (body) => {
          const { data } = await request<PatientDetail>('/patients', { method: 'POST', body });
          await queryClient.invalidateQueries({ queryKey: ['patients'] });
          router.push(`/patients/${data.id}`);
        }}
      />
    </div>
  );
}
