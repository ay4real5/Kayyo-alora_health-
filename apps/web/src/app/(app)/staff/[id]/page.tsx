'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { AvailabilityEditor, CredentialsPanel, TimeOffPanel } from '@/components/staff/staff-panels';
import { Button, ButtonLink } from '@/components/ui/button';
import { CareScoreCard } from '@/components/workforce/care-score';
import { Card } from '@/components/ui/card';
import { DetailList, ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import type { StaffDetail } from '@/lib/types/people';

export default function StaffMemberPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can, user } = useAuth();
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: ['staff', id], queryFn: async () => (await request<StaffDetail>(`/staff/${id}`)).data });
  const terminate = useMutation({
    mutationFn: () => request(`/staff/${id}`, { method: 'DELETE', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });

  if (staff.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!staff.data) return <ErrorAlert error={staff.error} />;
  const s = staff.data;
  const isSelf = user?.id === s.userId;
  const canEdit = can('staff:update');

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {s.firstName} {s.lastName} <StatusBadge status={s.isActive ? 'active' : 'inactive'} />
          </span>
        }
        subtitle={`${s.discipline} · ${humanize(s.employmentType)}${s.employeeId ? ` · ${s.employeeId}` : ''}`}
        actions={
          <>
            {canEdit && (
              <ButtonLink href={`/staff/${id}/edit`} variant="secondary">
                Edit
              </ButtonLink>
            )}
            {can('staff:delete') && s.isActive && !isSelf && (
              <Button
                variant="danger"
                disabled={terminate.isPending}
                onClick={() => window.confirm(`End ${s.firstName}'s employment today? Their login is managed separately in Users.`) && terminate.mutate()}
              >
                End employment
              </Button>
            )}
          </>
        }
      />
      <ErrorAlert error={terminate.error} />

      <Card className="p-5">
        <DetailList
          items={[
            ['Email', s.email],
            ['Phone', s.phone],
            ['Hired', formatDate(s.hireDate)],
            ['Employment ended', formatDate(s.terminationDate)],
            ['Serves ZIPs', s.serviceAreaZipCodes.join(', ')],
            ['Max patients', s.maxPatients],
            ['Skills', s.skills.join(', ')],
            ['Languages', s.languages.join(', ')],
            ['Home', [s.addressLine1, s.city, s.state, s.zip].filter(Boolean).join(', ')],
          ]}
        />
      </Card>

      <CareScoreCard staffId={s.id} />

      {s.pay && (
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Pay</h2>
          <DetailList
            items={[
              ['Hourly', s.pay.hourlyRate && `$${s.pay.hourlyRate}`],
              ['Per visit', s.pay.perVisitRate && `$${s.pay.perVisitRate}`],
              ['Overtime', s.pay.overtimeRate && `$${s.pay.overtimeRate}`],
              ['Mileage', s.pay.mileageRate && `$${s.pay.mileageRate}/mile`],
              ['Tax filing status', s.pay.taxFilingStatus && humanize(s.pay.taxFilingStatus)],
              ['SSN', s.pay.ssnLast4 && `•••-••-${s.pay.ssnLast4}`],
            ]}
          />
        </Card>
      )}

      <CredentialsPanel staffId={id} canEdit={canEdit} />
      <div className="grid gap-6 lg:grid-cols-2">
        <AvailabilityEditor staffId={id} canEdit={isSelf || canEdit} />
        <TimeOffPanel staffId={id} canRequest={isSelf || canEdit} canApprove={can('time_off:approve')} isSelf={isSelf} />
      </div>
    </div>
  );
}
