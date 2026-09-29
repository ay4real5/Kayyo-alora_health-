'use client';

import Link from 'next/link';
import { clock, longDate, usePortalData, type PortalVisit } from '@/components/portal/portal-data';
import { usePortal } from '@/components/portal/portal-shell';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { humanize } from '@/lib/labels';

/** Portal home: the next visit, unread messages, and who to call. */
export default function PortalHome() {
  const { me, patient } = usePortal();
  const visits = usePortalData<{ upcoming: PortalVisit[] }>('/visits');
  const messages = usePortalData<{ unread: number }>('/messages?limit=1');
  const next = visits.data?.upcoming[0];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">
        Hello, {me.firstName}
      </h1>
      <p className="text-sm text-slate-700">
        You are viewing care information for{' '}
        <strong>
          {patient.firstName} {patient.lastName}
        </strong>
        .
      </p>
      <ErrorAlert error={visits.error ?? messages.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-base font-semibold text-slate-900">Next visit</h2>
          {visits.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {visits.data && !next && <p className="text-sm text-slate-600">No visits scheduled in the next 30 days.</p>}
          {next && (
            <p className="text-sm text-slate-800">
              <span className="block text-lg font-medium">{longDate(next.date)}</span>
              {clock(next.start)} – {clock(next.end)} · {humanize(next.visitType)}
              {next.caregiver && <span className="block text-slate-600">with {next.caregiver}</span>}
            </p>
          )}
          <Link href="/portal/visits" className="text-sm text-violet-800 underline">
            All visits
          </Link>
        </Card>
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-base font-semibold text-slate-900">Messages</h2>
          <p className="text-sm text-slate-700">
            {messages.data?.unread
              ? `${messages.data.unread} new message${messages.data.unread === 1 ? '' : 's'} from the care team.`
              : 'Write to the care team about anything non-urgent.'}
          </p>
          <Link href="/portal/messages" className="text-sm text-violet-800 underline">
            Open messages
          </Link>
        </Card>
      </div>
      <Card className="p-5 text-sm text-slate-700">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Contact {me.agency.name}</h2>
        {me.agency.phone && <p>Phone: {me.agency.phone}</p>}
        {me.agency.email && <p>Email: {me.agency.email}</p>}
        <p className="mt-2 text-xs text-slate-500">
          Messages are read during office hours. For anything urgent, call the office; in an emergency call 911.
        </p>
      </Card>
    </div>
  );
}
