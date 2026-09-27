'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { PatientForm } from '@/components/patients/patient-form';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import type { PatientDetail } from '@/lib/types/patients';

export default function EditPatientPage() {
  const { id } = useParams<{ id: string }>();
  const { request } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const patient = useQuery({
    queryKey: ['patients', id],
    queryFn: async () => (await request<PatientDetail>(`/patients/${id}`)).data,
  });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={patient.data ? `Edit ${patient.data.firstName} ${patient.data.lastName}` : 'Edit patient'} />
      <ErrorAlert error={patient.error} />
      {patient.data && (
        <PatientForm
          patient={patient.data}
          submitLabel="Save changes"
          onSubmit={async (body) => {
            await request<PatientDetail>(`/patients/${id}`, { method: 'PATCH', body });
            await queryClient.invalidateQueries({ queryKey: ['patients'] });
            router.push(`/patients/${id}`);
          }}
        />
      )}
    </div>
  );
}
