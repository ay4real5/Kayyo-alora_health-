'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Claim } from '@/lib/types/billing';

interface EdiFile {
  id: string;
  fileType: string;
  direction: 'inbound' | 'outbound';
  fileName: string | null;
  controlNumber: string | null;
  recordCount: number | null;
  status: string;
  payer: { id: string; name: string } | null;
  claims: { id: string; claimNumber: string; status: string }[];
  errorDetails: { rejected?: { claimNumber: string; reason: string }[]; unmatched?: string[]; reason?: string } | null;
  createdAt: string;
}

interface AckResult {
  kind: '999' | '277CA';
  accepted: string[];
  rejected: { claimNumber: string; reason: string }[];
  unmatched: string[];
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const FILE_STATUS: Record<string, string> = {
  generated: 'pending',
  submitted: 'in_progress',
  accepted: 'approved',
  rejected: 'rejected',
  parsed: 'completed',
};
const STATUS_LABEL: Record<string, string> = {
  generated: 'Not sent yet',
  submitted: 'Sent',
  accepted: 'Accepted (999)',
  rejected: 'Rejected (999)',
  parsed: 'Loaded',
};

/** Saves text as a file in the browser. */
function saveText(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Claim files (D-076): ready claims → one 837 file per payer → download → upload it to the clearinghouse portal →
 * mark it sent. Then load the 999 / 277CA the clearinghouse returns; rejected claims show why.
 */
export default function ClaimFilesPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [test, setTest] = useState(false);
  const [ack, setAck] = useState<AckResult | null>(null);

  const files = useQuery({
    queryKey: ['billing', 'edi-files', page],
    enabled: can('billing:read'),
    placeholderData: keepPreviousData,
    queryFn: () => request<EdiFile[]>(`/billing/edi-files?page=${page}&limit=20`),
  });
  const ready = useQuery({
    queryKey: ['billing', 'claims', 'ready-for-files'],
    enabled: can('billing:read'),
    queryFn: async () => (await request<Claim[]>('/billing/claims?status=ready&limit=100')).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing'] });

  const create = useMutation({
    mutationFn: async (claimIds: string[]) =>
      (await request<EdiFile>('/billing/edi-files/837', { method: 'POST', body: { claimIds, test } })).data,
    onSuccess: refresh,
  });
  const sent = useMutation({
    mutationFn: (id: string) => request(`/billing/edi-files/${id}/sent`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const download = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await request<{ fileName: string; content: string }>(`/billing/edi-files/${id}/download`);
      saveText(data.fileName, data.content);
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 5 * 1024 * 1024) throw new Error('The file is larger than 5 MB');
      return (await request<AckResult>('/billing/edi-files/upload-ack', { method: 'POST', body: { fileName: file.name, content: await file.text() } })).data;
    },
    onSuccess: async (result) => {
      setAck(result);
      await refresh();
    },
  });

  if (!can('billing:read')) return <PageHeader title="Claim files" subtitle="You don't have access to billing." />;

  // Ready claims not already in an unsent file, grouped by payer and claim form (one file each).
  const pendingFileIds = new Set(files.data?.data.filter((f) => f.status === 'generated').map((f) => f.id));
  const groups = new Map<string, { payer: string; form: string; claims: Claim[] }>();
  for (const c of ready.data ?? []) {
    if (c.ediFileId && pendingFileIds.has(c.ediFileId)) continue;
    const key = `${c.payer.id}|${c.claimType}`;
    const g = groups.get(key) ?? { payer: c.payer.name, form: c.claimType, claims: [] };
    g.claims.push(c);
    groups.set(key, g);
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  };
  const toggle = (id: string) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Claim files"
        subtitle="Make an 837 file for each payer, upload it to your clearinghouse, then load the acknowledgments it sends back."
        actions={
          can('billing:create') && (
            <label className="inline-flex cursor-pointer items-center rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800">
              Load 999 / 277CA
              <input type="file" accept=".999,.277,.edi,.txt,.x12" className="sr-only" onChange={onFile} aria-label="Acknowledgment file" />
            </label>
          )
        }
      />
      <ErrorAlert error={upload.error ?? sent.error ?? download.error} />
      {ack && (
        <Card className="p-4 text-sm" role="status" aria-label="Acknowledgment result">
          <h2 className="mb-1 font-semibold text-slate-900">{ack.kind} loaded</h2>
          <p>
            {ack.accepted.length} accepted · {ack.rejected.length} rejected
            {ack.unmatched.length > 0 && ` · not ours: ${ack.unmatched.join(', ')}`}
          </p>
          {ack.rejected.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-800">
              {ack.rejected.map((r) => (
                <li key={r.claimNumber}>
                  <span className="font-mono">{r.claimNumber}</span>: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {can('billing:create') && (
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">New files from ready claims</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> Test file (for the clearinghouse’s
              test channel)
            </label>
          </div>
          <ErrorAlert error={ready.error ?? create.error} />
          {ready.data && groups.size === 0 && <p className="text-sm text-slate-500">No ready claims waiting for a file.</p>}
          {[...groups.entries()].map(([key, g]) => {
            const chosen = g.claims.filter((c) => !unchecked.has(c.id));
            return (
              <section key={key} aria-label={`${g.payer} ${g.form}`} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {g.payer} · {g.form} · {chosen.length} of {g.claims.length} claims ·{' '}
                    {money(chosen.reduce((sum, c) => sum + c.totalCharges, 0))}
                  </h3>
                  <Button disabled={!chosen.length || create.isPending} onClick={() => create.mutate(chosen.map((c) => c.id))}>
                    Create file
                  </Button>
                </div>
                <ul className="grid gap-1 text-sm sm:grid-cols-2">
                  {g.claims.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!unchecked.has(c.id)} onChange={() => toggle(c.id)} />
                        <span className="font-mono">{c.claimNumber}</span> · {c.patient.lastName}, {c.patient.firstName} ·{' '}
                        {money(c.totalCharges)}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-base font-semibold text-slate-900">Files</h2>
        <ErrorAlert error={files.error} />
        {files.data?.data.length === 0 && <p className="text-sm text-slate-500">No files yet.</p>}
        {files.data && files.data.data.length > 0 && (
          <table className="w-full text-left text-sm" aria-label="Claim files">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="py-2 pr-4 font-medium">File</th>
                <th className="py-2 pr-4 font-medium">Payer</th>
                <th className="py-2 pr-4 font-medium">Claims</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {files.data.data.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className="py-2 pr-4">
                    <span className="font-mono">{f.fileName ?? f.fileType}</span>
                    <span className="block text-xs text-slate-500">
                      {f.direction === 'outbound' ? `${f.fileType} to the clearinghouse` : `${f.fileType === '277' ? '277CA' : f.fileType} from the clearinghouse`}
                    </span>
                    {f.errorDetails?.reason && <span className="block text-xs text-red-800">{f.errorDetails.reason}</span>}
                  </td>
                  <td className="py-2 pr-4">{f.payer?.name ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {f.direction === 'outbound'
                      ? f.claims.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 && ', '}
                            <Link href={`/billing/claims/${c.id}`} className="font-mono text-violet-800 hover:underline">
                              {c.claimNumber}
                            </Link>
                          </span>
                        ))
                      : `${f.recordCount ?? 0} answered${f.errorDetails?.rejected?.length ? `, ${f.errorDetails.rejected.length} rejected` : ''}`}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={FILE_STATUS[f.status] ?? f.status} />
                    <span className="sr-only">{STATUS_LABEL[f.status] ?? f.status}</span>
                    <span className="block text-xs text-slate-500" aria-hidden>
                      {STATUS_LABEL[f.status] ?? f.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{formatDate(f.createdAt.slice(0, 10))}</td>
                  <td className="flex flex-wrap gap-2 py-2">
                    <Button variant="secondary" disabled={download.isPending} onClick={() => download.mutate(f.id)}>
                      Download
                    </Button>
                    {f.direction === 'outbound' && f.status === 'generated' && can('billing:submit') && (
                      <Button
                        variant="secondary"
                        disabled={sent.isPending}
                        onClick={() => window.confirm('Mark this file as uploaded to the clearinghouse? Its claims become “submitted”.') && sent.mutate(f.id)}
                      >
                        Mark as sent
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {files.data?.meta && <Pager page={page} limit={files.data.meta.limit} total={files.data.meta.total} onPage={setPage} />}
      </Card>
      {test && <Alert tone="info">Test files carry the test indicator; payers won’t process them.</Alert>}
    </div>
  );
}
