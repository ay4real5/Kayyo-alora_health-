'use client';

import { useMutation } from '@tanstack/react-query';
import { usePortalData } from '@/components/portal/portal-data';
import { usePortal } from '@/components/portal/portal-shell';
import { Card } from '@/components/ui/card';
import { ErrorAlert, formatDate } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';

interface SharedDocument {
  id: string;
  documentType: string;
  title: string;
  fileName: string;
  fileSize: number | null;
  isSigned: boolean;
  createdAt: string;
}

/** Documents the agency chose to share with the patient/family. */
export default function PortalDocuments() {
  const { request } = useAuth();
  const { base } = usePortal();
  const docs = usePortalData<SharedDocument[]>('/documents');
  const download = useMutation({
    mutationFn: async (d: SharedDocument) => {
      const file = (await request<Blob>(`${base}/documents/${d.id}/download`, { responseType: 'blob' })).data;
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: d.fileName });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Documents</h1>
      <ErrorAlert error={docs.error ?? download.error} />
      <Card className="p-5">
        {docs.data?.length === 0 && (
          <p className="text-sm text-slate-600">No documents have been shared yet. Ask the office if you need a copy of something.</p>
        )}
        <ul aria-label="Documents" className="flex flex-col divide-y divide-slate-100">
          {docs.data?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium text-slate-900">{d.title}</span>
                <span className="block text-xs text-slate-600">
                  {humanize(d.documentType)} · {formatDate(d.createdAt)}
                  {d.isSigned && ' · signed'}
                </span>
              </span>
              <button type="button" className="text-sm text-violet-800 underline" onClick={() => download.mutate(d)}>
                Download
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
