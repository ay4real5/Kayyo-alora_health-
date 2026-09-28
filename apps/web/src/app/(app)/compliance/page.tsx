'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import { useAgencyToday } from '@/lib/use-agency-today';

const TYPES = ['fall', 'injury', 'medication_error', 'abuse_neglect', 'complaint', 'property_damage', 'infection', 'privacy_breach', 'other'];
const SEVERITIES = ['low', 'moderate', 'high', 'critical'];
const STATUSES = ['open', 'investigating', 'resolved', 'closed'];

type Person = { id: string; firstName: string; lastName: string };
interface Incident {
  id: string;
  incidentType: string;
  severity: string;
  status: string;
  incidentDate: string;
  incidentTime: string | null;
  description: string;
  actionsTaken: string | null;
  followUpRequired: boolean;
  followUpNotes: string | null;
  patient: Person | null;
  staff: Person | null;
  reportedBy: Person;
  resolvedBy: Person | null;
  resolvedAt: string | null;
}
interface Dashboard {
  credentials: { expired: number; expiringWithin30Days: number };
  incidents: { open: number; openHighOrCritical: number; last30Days: number };
  visits: { missedLast30Days: number; evvToReview: number };
  clinical: { ordersUnsignedOver30Days: number; carePlansEndingWithin14Days: number; assessmentsAwaitingApproval: number };
  security: { adminsWithout2fa: number };
}

const SEVERITY_BADGE: Record<string, string> = { low: 'inactive', moderate: 'pending', high: 'denied', critical: 'denied' };
const STATUS_BADGE: Record<string, string> = { open: 'open', investigating: 'pending', resolved: 'approved', closed: 'discharged' };

/** Compliance (D-062): anyone can report an incident; compliance staff see the dashboard and work the incidents. */
export default function CompliancePage() {
  const { can } = useAuth();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Compliance" subtitle="Incidents, expiring credentials and what needs attention." />
      {can('compliance:read') && <DashboardCards />}
      {can('compliance:create') && <ReportIncident />}
      {can('compliance:read') && <IncidentList />}
    </div>
  );
}

function DashboardCards() {
  const { request } = useAuth();
  const d = useQuery({ queryKey: ['compliance', 'dashboard'], queryFn: async () => (await request<Dashboard>('/compliance/dashboard')).data });
  if (!d.data) return <ErrorAlert error={d.error} />;
  const x = d.data;
  const tiles: [string, number, string][] = [
    ['Credentials expired', x.credentials.expired, 'Staff → Credentials'],
    ['Credentials expiring (30 days)', x.credentials.expiringWithin30Days, 'Staff → Credentials'],
    ['Open incidents', x.incidents.open, `${x.incidents.openHighOrCritical} high or critical`],
    ['EVV to review', x.visits.evvToReview, 'EVV review'],
    ['Missed visits (30 days)', x.visits.missedLast30Days, 'Schedule'],
    ['Orders unsigned > 30 days', x.clinical.ordersUnsignedOver30Days, 'Patients → Physician orders'],
    ['Plans of care ending (14 days)', x.clinical.carePlansEndingWithin14Days, 'Recertify'],
    ['Assessments awaiting approval', x.clinical.assessmentsAwaitingApproval, 'Patients → Assessments'],
    ['Admins without 2FA', x.security.adminsWithout2fa, 'Users'],
  ];
  return (
    <section aria-label="Compliance summary" className="grid gap-3 sm:grid-cols-3">
      {tiles.map(([label, value, hint]) => (
        <Card key={label} className={`p-4 ${value > 0 ? 'border-amber-300' : ''}`}>
          <p className="text-xs text-slate-600">{label}</p>
          <p className={`text-2xl font-semibold ${value > 0 ? 'text-amber-800' : 'text-slate-900'}`}>{value}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </Card>
      ))}
    </section>
  );
}

function ReportIncident() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const today = useAgencyToday();
  const [done, setDone] = useState(false);
  const report = useMutation({
    mutationFn: (body: Record<string, unknown>) => request('/compliance/incidents', { method: 'POST', body }),
    onSuccess: () => {
      setDone(true);
      return queryClient.invalidateQueries({ queryKey: ['compliance'] });
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    report.mutate(
      {
        incidentType: text('incidentType'),
        severity: text('severity'),
        incidentDate: text('incidentDate'),
        ...(text('incidentTime') ? { incidentTime: text('incidentTime') } : {}),
        description: text('description'),
        ...(text('actionsTaken') ? { actionsTaken: text('actionsTaken') } : {}),
        followUpRequired: f.get('followUpRequired') === 'on',
      },
      { onSuccess: () => form.reset() },
    );
  };
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-base font-semibold text-slate-900">Report an incident</h2>
      <p className="text-sm text-slate-600">Falls, injuries, medication errors, complaints, suspected abuse, privacy breaches. If someone is in danger, call 911 first.</p>
      <ErrorAlert error={report.error} />
      {done && !report.isPending && <Alert tone="info">Thank you — the incident was reported.</Alert>}
      <form onSubmit={submit} onChange={() => setDone(false)} className="grid gap-3 sm:grid-cols-4">
        <SelectField label="Type of incident" name="incidentType" defaultValue="fall">
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Severity" name="severity" defaultValue="moderate">
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </SelectField>
        <Field label="Date" name="incidentDate" type="date" defaultValue={today} max={today} required />
        <Field label="Time" name="incidentTime" type="time" />
        <TextAreaField label="Describe what happened" name="description" required rows={3} className="sm:col-span-4" />
        <TextAreaField label="What was done right away" name="actionsTaken" rows={2} className="sm:col-span-4" />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="followUpRequired" /> Needs follow-up
        </label>
        <div className="sm:col-span-2 sm:text-right">
          <Button type="submit" disabled={report.isPending}>
            Submit report
          </Button>
        </div>
      </form>
    </Card>
  );
}

function IncidentList() {
  const { request } = useAuth();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['compliance', 'incidents', { status, page }],
    placeholderData: keepPreviousData,
    queryFn: () => request<Incident[]>(`/compliance/incidents?${new URLSearchParams({ page: String(page), limit: '20', ...(status ? { status } : {}) })}`),
  });
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Incidents</h2>
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">Any</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </SelectField>
      </div>
      <ErrorAlert error={list.error} />
      {list.data?.data.length === 0 && <p className="text-sm text-slate-500">No incidents.</p>}
      <ul aria-label="Incidents" className="flex flex-col gap-2">
        {list.data?.data.map((i) => (
          <li key={i.id} className="rounded-md border border-slate-200 p-3 text-sm">
            <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpenId(openId === i.id ? null : i.id)}>
              <span>
                <span className="font-medium text-slate-900">{humanize(i.incidentType)}</span>{' '}
                <span className="text-slate-600">
                  · {formatDate(i.incidentDate)}
                  {i.incidentTime && ` ${i.incidentTime}`}
                  {i.patient && ` · ${i.patient.firstName} ${i.patient.lastName}`} · reported by {i.reportedBy.firstName} {i.reportedBy.lastName}
                </span>
              </span>
              <span className="flex gap-2">
                <StatusBadge status={SEVERITY_BADGE[i.severity] ?? i.severity} />
                <StatusBadge status={STATUS_BADGE[i.status] ?? i.status} />
              </span>
            </button>
            {openId === i.id && <IncidentDetail incident={i} />}
          </li>
        ))}
      </ul>
      {list.data?.meta && <Pager page={list.data.meta.page} limit={list.data.meta.limit} total={list.data.meta.total} onPage={setPage} />}
    </Card>
  );
}

function IncidentDetail({ incident: i }: { incident: Incident }) {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => request(`/compliance/incidents/${i.id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['compliance'] }),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      status: String(f.get('status')),
      actionsTaken: String(f.get('actionsTaken') ?? '').trim(),
      followUpNotes: String(f.get('followUpNotes') ?? '').trim(),
      followUpRequired: f.get('followUpRequired') === 'on',
    });
  };
  const editable = can('compliance:update') && i.status !== 'closed';
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3">
      <p className="whitespace-pre-wrap text-slate-800">{i.description}</p>
      {i.resolvedBy && (
        <p className="text-xs text-slate-500">
          Resolved by {i.resolvedBy.firstName} {i.resolvedBy.lastName}
          {i.resolvedAt && `, ${new Date(i.resolvedAt).toLocaleString()}`}
        </p>
      )}
      <ErrorAlert error={save.error} />
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Status" name="status" defaultValue={i.status} disabled={!editable}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </SelectField>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" name="followUpRequired" defaultChecked={i.followUpRequired} disabled={!editable} /> Needs follow-up
        </label>
        <TextAreaField label="Actions taken" name="actionsTaken" defaultValue={i.actionsTaken ?? ''} rows={2} disabled={!editable} />
        <TextAreaField label="Follow-up notes" name="followUpNotes" defaultValue={i.followUpNotes ?? ''} rows={2} disabled={!editable} />
        {editable && (
          <div>
            <Button type="submit" variant="secondary" disabled={save.isPending}>
              Save
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
