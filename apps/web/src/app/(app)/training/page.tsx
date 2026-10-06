'use client';

import { DISCIPLINES } from '@alora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { TextAreaField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';

interface CourseRow {
  id: string;
  title: string;
  summary: string | null;
  disciplines: string[];
  passPercent: number;
  credentialType: string | null;
  validityMonths: number | null;
  isActive: boolean;
  questions: number;
  passedBy: number;
}

interface Question {
  prompt: string;
  options: string[];
  correctIndex: number;
}

interface Course extends Omit<CourseRow, 'questions' | 'passedBy'> {
  content: string;
  questions: Question[];
}

interface Result {
  id: string;
  name: string;
  discipline: string;
  scorePercent: number;
  passed: boolean;
  completedAt: string;
}

const blankQuestion = (): Question => ({ prompt: '', options: ['', ''], correctIndex: 0 });

function QuestionsEditor({ value, onChange }: { value: Question[]; onChange: (q: Question[]) => void }) {
  const set = (i: number, q: Question) => onChange(value.map((x, j) => (j === i ? q : x)));
  return (
    <div className="flex flex-col gap-3">
      {value.map((q, i) => (
        <fieldset key={i} className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-800">Question {i + 1}</legend>
          <div className="flex flex-col gap-2">
            <Field label="Question" value={q.prompt} required maxLength={1000} onChange={(e) => set(i, { ...q, prompt: e.target.value })} />
            {q.options.map((o, k) => (
              <div key={k} className="flex items-end gap-2">
                <label className="mb-3 flex items-center gap-1 text-xs text-slate-700" title="The right answer">
                  <input type="radio" name={`correct-${i}`} checked={q.correctIndex === k} onChange={() => set(i, { ...q, correctIndex: k })} /> Right
                </label>
                <Field
                  label={`Option ${k + 1}`}
                  value={o}
                  required
                  maxLength={300}
                  className="flex-1"
                  onChange={(e) => set(i, { ...q, options: q.options.map((x, m) => (m === k ? e.target.value : x)) })}
                />
                {q.options.length > 2 && (
                  <button
                    type="button"
                    aria-label={`Remove option ${k + 1}`}
                    className="mb-2 text-slate-500 hover:text-red-700"
                    onClick={() => set(i, { ...q, options: q.options.filter((_, m) => m !== k), correctIndex: q.correctIndex === k ? 0 : q.correctIndex > k ? q.correctIndex - 1 : q.correctIndex })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-3 text-sm">
              {q.options.length < 6 && (
                <button type="button" className="text-violet-800 hover:underline" onClick={() => set(i, { ...q, options: [...q.options, ''] })}>
                  Add option
                </button>
              )}
              {value.length > 1 && (
                <button type="button" className="text-red-700 hover:underline" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  Remove question
                </button>
              )}
            </div>
          </div>
        </fieldset>
      ))}
      {value.length < 50 && (
        <div>
          <Button type="button" variant="secondary" onClick={() => onChange([...value, blankQuestion()])}>
            <Plus aria-hidden className="h-4 w-4" /> Add question
          </Button>
        </div>
      )}
    </div>
  );
}

function CourseEditor({ course, onDone }: { course?: Course; onDone: () => void }) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const [questions, setQuestions] = useState<Question[]>(course?.questions ?? [blankQuestion()]);
  const [disciplines, setDisciplines] = useState<string[]>(course?.disciplines ?? []);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      course ? request(`/training/courses/${course.id}`, { method: 'PATCH', body }) : request('/training/courses', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['training'] });
      onDone();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (k: string) => String(form.get(k) ?? '').trim();
    const num = (k: string) => (text(k) ? Number(text(k)) : undefined);
    save.mutate({
      title: text('title'),
      ...(text('summary') ? { summary: text('summary') } : {}),
      content: text('content'),
      disciplines,
      passPercent: num('passPercent') ?? 80,
      ...(text('credentialType') ? { credentialType: text('credentialType') } : {}),
      ...(num('validityMonths') ? { validityMonths: num('validityMonths') } : {}),
      questions,
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" name="title" required maxLength={200} defaultValue={course?.title} />
        <Field label="Summary" name="summary" maxLength={500} defaultValue={course?.summary ?? ''} />
      </div>
      <TextAreaField label="Lesson" name="content" required rows={10} maxLength={50_000} defaultValue={course?.content} placeholder="Plain text. Leave a blank line between paragraphs." />
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-sm font-medium text-slate-700">For (none ticked = everyone)</legend>
        {DISCIPLINES.map((d) => (
          <label key={d} className="flex items-center gap-1 text-sm text-slate-800">
            <input type="checkbox" checked={disciplines.includes(d)} onChange={(e) => setDisciplines(e.target.checked ? [...disciplines, d] : disciplines.filter((x) => x !== d))} /> {d}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Pass mark (%)" name="passPercent" type="number" min={1} max={100} defaultValue={course?.passPercent ?? 80} />
        <Field label="Credential on passing" name="credentialType" maxLength={100} defaultValue={course?.credentialType ?? ''} hint="e.g. infection_control — leave empty for none" />
        <Field label="Credential lasts (months)" name="validityMonths" type="number" min={1} max={120} defaultValue={course?.validityMonths ?? ''} hint="Empty = no expiry" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">Quiz</h3>
      <QuestionsEditor value={questions} onChange={setQuestions} />
      <ErrorAlert error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {course ? 'Save course' : 'Create course'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CourseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const course = useQuery({ queryKey: ['training', 'course', id], queryFn: async () => (await request<Course>(`/training/courses/${id}`)).data });
  const results = useQuery({ queryKey: ['training', 'results', id], queryFn: async () => (await request<Result[]>(`/training/courses/${id}/results`)).data });
  const toggle = useMutation({
    mutationFn: (isActive: boolean) => request(`/training/courses/${id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['training'] }),
  });
  const c = course.data;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <ErrorAlert error={course.error ?? results.error ?? toggle.error} />
      {c && editing ? (
        <CourseEditor course={c} onDone={() => setEditing(false)} />
      ) : (
        c && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-base font-semibold text-slate-900">{c.title}</h2>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="secondary" onClick={() => toggle.mutate(!c.isActive)} disabled={toggle.isPending}>
                {c.isActive ? 'Archive' : 'Restore'}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
            <p className="whitespace-pre-line text-sm text-slate-700">{c.content}</p>
            <h3 className="text-sm font-semibold text-slate-900">Results</h3>
            {results.data?.length === 0 && <p className="text-sm text-slate-600">Nobody has taken it yet.</p>}
            <ul className="divide-y divide-slate-100 text-sm">
              {results.data?.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-1.5">
                  <span className="w-48 font-medium text-slate-900">
                    {r.name} <span className="font-normal text-slate-500">({r.discipline})</span>
                  </span>
                  <span>{r.scorePercent}%</span>
                  <StatusBadge status={r.passed ? 'approved' : 'denied'} />
                  <span className="text-slate-500">{formatDate(r.completedAt.slice(0, 10))}</span>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </Card>
  );
}

/** Primordial Academy (D-102): short courses with a quiz; passing can record a credential. */
export default function TrainingPage() {
  const { request, can } = useAuth();
  const [mode, setMode] = useState<'list' | 'new' | string>('list');
  const courses = useQuery({
    queryKey: ['training', 'courses'],
    enabled: can('training:manage'),
    queryFn: async () => (await request<CourseRow[]>('/training/courses')).data,
  });
  if (!can('training:manage')) return <PageHeader title="Academy" subtitle="You don't have access to manage training." />;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Primordial Academy"
        subtitle="Short training courses with a quiz. Caregivers take them in the app; passing can record a credential that counts towards onboarding."
        actions={mode === 'list' ? <Button onClick={() => setMode('new')}>New course</Button> : null}
      />
      {mode === 'new' && (
        <Card className="p-5">
          <CourseEditor onDone={() => setMode('list')} />
        </Card>
      )}
      {mode !== 'list' && mode !== 'new' && <CourseDetail id={mode} onClose={() => setMode('list')} />}
      <Card className="p-4">
        <ErrorAlert error={courses.error} />
        {courses.data?.length === 0 && <p className="text-sm text-slate-600">No courses yet — add your first one.</p>}
        <ul className="divide-y divide-slate-100">
          {courses.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <button type="button" className={`mr-auto text-left font-medium hover:underline ${c.isActive ? 'text-violet-800' : 'text-slate-500 line-through'}`} onClick={() => setMode(c.id)}>
                {c.title}
              </button>
              <span className="text-slate-600">{c.disciplines.length ? c.disciplines.join(', ') : 'Everyone'}</span>
              <span className="text-slate-600">{c.questions} questions</span>
              <span className="text-slate-600">{c.credentialType ? `Grants ${c.credentialType}` : 'No credential'}</span>
              <span className="text-slate-600">{c.passedBy} passed</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
