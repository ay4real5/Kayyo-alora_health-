'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';

const DOCUMENT_TYPES = [
  'consent',
  'care_plan',
  'physician_order',
  'assessment',
  'insurance_card',
  'identification',
  'correspondence',
  'other',
];
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx';
const MAX_BYTES = 10 * 1024 * 1024;

interface DocumentItem {
  id: string;
  documentType: string;
  title: string;
  fileName: string;
  fileSize: number | null;
  version: number;
  superseded: boolean;
  isSigned: boolean;
  sharedWithPatient: boolean;
  signature: { name: string; signedAt: string } | null;
  uploadedBy: { firstName: string; lastName: string };
  deleted: boolean;
  createdAt: string;
}

const size = (n: number | null) =>
  n == null
    ? ''
    : n < 1024 * 1024
      ? `${Math.ceil(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Patient documents (D-056): upload, download, versions, e-signature, delete with a reason. */
export function DocumentsPanel({ patientId }: { patientId: string }) {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [showDeleted, setShowDeleted] = useState(false);
  const [tooBig, setTooBig] = useState(false);
  const docs = useQuery({
    queryKey: ['documents', patientId, showDeleted],
    queryFn: async () =>
      (
        await request<DocumentItem[]>(
          `/documents?patientId=${patientId}&limit=100${showDeleted ? '&includeDeleted=true' : ''}`,
        )
      ).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['documents', patientId] });
  const act = useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body,
    }: {
      path: string;
      method?: 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
    }) => request(path, { method, body }),
    onSuccess: refresh,
  });
  const upload = useMutation({
    mutationFn: (form: FormData) => request('/documents', { method: 'POST', body: form }),
    onSuccess: refresh,
  });
  const download = useMutation({
    mutationFn: async (d: DocumentItem) => {
      const file = (await request<Blob>(`/documents/${d.id}/download`, { responseType: 'blob' }))
        .data;
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: d.fileName });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (file instanceof File && file.size > MAX_BYTES) return setTooBig(true);
    setTooBig(false);
    data.set('patientId', patientId);
    upload.mutate(data, { onSuccess: () => form.reset() });
  };

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Documents</h2>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />{' '}
          Show deleted
        </label>
      </div>
      <ErrorAlert error={docs.error ?? act.error ?? upload.error ?? download.error} />
      {docs.data?.length === 0 && <p className="text-sm text-slate-500">No documents yet.</p>}
      <ul className="flex flex-col gap-2 text-sm" aria-label="Documents">
        {docs.data?.map((d) => (
          <DocumentRow
            key={d.id}
            doc={d}
            onDownload={() => download.mutate(d)}
            onAct={(path, method, body) => act.mutate({ path, method, body })}
            onNewVersion={(file) => {
              const form = new FormData();
              form.set('file', file);
              form.set('documentType', d.documentType);
              form.set('title', d.title);
              form.set('replacesDocumentId', d.id);
              upload.mutate(form);
            }}
          />
        ))}
      </ul>
      {can('documents:create') && (
        <form
          onSubmit={submit}
          className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2"
        >
          <SelectField label="Document type" name="documentType" required defaultValue="consent">
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </SelectField>
          <Field label="Document title" name="title" required maxLength={255} />
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
            File (PDF, image or Word, up to 10 MB)
            <input
              type="file"
              name="file"
              accept={ACCEPT}
              required
              className="text-sm font-normal"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" name="sharedWithPatient" value="true" /> Share with the patient/family in the
            portal
          </label>
          {tooBig && <p className="text-sm text-red-700 sm:col-span-2">That file is over 10 MB.</p>}
          <div>
            <Button type="submit" variant="secondary" disabled={upload.isPending}>
              {upload.isPending ? 'Uploading…' : 'Upload document'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function DocumentRow({
  doc: d,
  onDownload,
  onAct,
  onNewVersion,
}: {
  doc: DocumentItem;
  onDownload: () => void;
  onAct: (path: string, method?: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => void;
  onNewVersion: (file: File) => void;
}) {
  const { request, can } = useAuth();
  const [showHistory, setShowHistory] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const history = useQuery({
    queryKey: ['documents', 'versions', d.id],
    queryFn: async () => (await request<DocumentItem[]>(`/documents/${d.id}/versions`)).data,
    enabled: showHistory,
  });
  return (
    <li className={`rounded-md border border-slate-200 p-2 ${d.deleted ? 'text-slate-500' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`font-medium ${d.deleted ? 'line-through' : 'text-slate-900'}`}>
          {d.title}
        </span>
        <span className="flex items-center gap-2 text-xs">
          {d.isSigned && (
            <span className="rounded bg-green-50 px-1.5 py-0.5 font-medium text-green-800">
              Signed
            </span>
          )}
          {d.sharedWithPatient && !d.deleted && (
            <span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-800">In portal</span>
          )}
          {d.version > 1 && <span className="text-slate-500">v{d.version}</span>}
        </span>
      </div>
      <p className="text-xs text-slate-600">
        {humanize(d.documentType)} · {d.fileName} {size(d.fileSize)} · {d.uploadedBy.firstName}{' '}
        {d.uploadedBy.lastName}, {formatDate(d.createdAt)}
        {d.signature && (
          <>
            {' '}
            · signed by {d.signature.name}, {formatDate(d.signature.signedAt)}
          </>
        )}
      </p>
      {!d.deleted && (
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          <button type="button" className="underline" onClick={onDownload}>
            Download
          </button>
          {!d.isSigned && can('documents:sign') && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                const typedName = window.prompt(
                  `Sign "${d.title}" electronically.\nType your full name (and credentials) to sign:`,
                );
                if (typedName?.trim()) onAct(`/documents/${d.id}/sign`, 'POST', { typedName });
              }}
            >
              Sign
            </button>
          )}
          {can('documents:create') && (
            <>
              <button
                type="button"
                className="underline"
                onClick={() => fileInput.current?.click()}
              >
                Upload new version
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="hidden"
                aria-label={`New version of ${d.title}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onNewVersion(file);
                  e.target.value = '';
                }}
              />
            </>
          )}
          {can('documents:create') && (
            <button
              type="button"
              className="underline"
              onClick={() =>
                onAct(`/documents/${d.id}`, 'PATCH', { sharedWithPatient: !d.sharedWithPatient })
              }
            >
              {d.sharedWithPatient ? 'Stop sharing in portal' : 'Share in portal'}
            </button>
          )}
          {d.version > 1 && (
            <button type="button" className="underline" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? 'Hide history' : 'History'}
            </button>
          )}
          {can('documents:delete') && (
            <button
              type="button"
              className="text-slate-500 underline"
              onClick={() => {
                const reason = window.prompt(`Why is "${d.title}" being deleted?`);
                if (reason?.trim()) onAct(`/documents/${d.id}`, 'DELETE', { reason });
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
      {showHistory && (
        <ul
          className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2 text-xs text-slate-600"
          aria-label="Versions"
        >
          {history.data?.map((v) => (
            <li key={v.id}>
              v{v.version} · {v.fileName} · {v.uploadedBy.firstName} {v.uploadedBy.lastName},{' '}
              {formatDate(v.createdAt)}
              {v.isSigned && ' · signed'}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
