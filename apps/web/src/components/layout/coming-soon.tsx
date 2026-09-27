import { Card } from '@/components/ui/card';

/** Placeholder for sections whose screens are still being built (see docs/ROADMAP.md). */
export function ComingSoon({ title, task }: { title: string; task: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <Card className="p-6 text-sm text-slate-600">
        This screen is coming next ({task}). The API behind it is already available — see docs/api/openapi.json.
      </Card>
    </div>
  );
}
