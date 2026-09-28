/** Scheduling shapes as returned by the API (apps/api/src/modules/scheduling). Synced by hand (D-035). */

export interface VisitView {
  id: string;
  patient: { id: string; firstName: string; lastName: string };
  staff: { id: string; firstName: string; lastName: string; discipline: string } | null;
  visitType: string;
  serviceCode: string | null;
  status: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  priority: string;
  notes: string | null;
  cancelReason: string | null;
  isRecurring: boolean;
  createdAt: string;
}

export interface ScheduleConflict {
  code: string;
  severity: 'blocking' | 'warning';
  message: string;
  visitIds?: string[];
}

export interface VisitWithWarnings extends VisitView {
  warnings: ScheduleConflict[];
}

export interface CalendarDay {
  date: string;
  visits: VisitView[];
}

export interface GenerationResult {
  created: { id: string; scheduledDate: string }[];
  skipped: { date: string; conflicts: ScheduleConflict[] }[];
  warnings: { date: string; conflicts: ScheduleConflict[] }[];
}
