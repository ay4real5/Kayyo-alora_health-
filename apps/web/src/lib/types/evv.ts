/** EVV, live monitor, documentation and open-shift shapes as returned by the API. Synced by hand (D-035). */

type PersonRef = { id: string; firstName: string; lastName: string };
type Point = { latitude: number | null; longitude: number | null };

export interface LiveSnapshot {
  date: string;
  counts: {
    scheduled: number;
    inProgress: number;
    completed: number;
    missed: number;
    late: number;
    noShow: number;
    unassigned: number;
    needsReview: number;
  };
  active: {
    visitId: string;
    evvRecordId: string;
    clockInTime: string | null;
    scheduledEnd: string;
    flags: string[];
    withinGeofence: boolean | null;
    clockIn: Point;
    home: Point;
    staff: PersonRef & { discipline: string };
    patient: PersonRef;
  }[];
  late: {
    visitId: string;
    scheduledStart: string;
    minutesLate: number;
    noShow: boolean;
    staff: PersonRef;
    patient: PersonRef;
  }[];
  unassigned: { visitId: string; visitType: string; scheduledStart: string; patient: PersonRef }[];
}

/** A live-monitor socket event (visit:clock-in, visit:late, …). Fields vary by event. */
export interface MonitorEvent {
  visitId: string;
  at: string;
  staffName?: string | null;
  patientName?: string;
  minutesLate?: number;
  withinGeofence?: boolean | null;
  distanceMeters?: number | null;
  stage?: 'clock-in' | 'clock-out';
  durationMinutes?: number;
}

interface ClockView extends Point {
  time: string | null;
  method: string | null;
  accuracyMeters: number | null;
  withinGeofence: boolean | null;
  distanceMeters: number | null;
}

export interface EvvException {
  id: string;
  exceptionType: 'clock_in_time' | 'clock_out_time';
  originalValue: string | null;
  correctedValue: string | null;
  reason: string;
  requestedById: string;
  status: 'pending' | 'approved' | 'denied';
  decidedById: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface EvvRecord {
  id: string;
  visit: {
    id: string;
    visitType: string;
    scheduledDate: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
  patient: PersonRef;
  staff: PersonRef & { discipline: string };
  serviceDate: string;
  status: 'in_progress' | 'completed' | 'exception' | 'verified' | 'rejected';
  flags: string[];
  clockIn: ClockView;
  clockOut: ClockView | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  exceptions: EvvException[];
  createdAt: string;
}

export interface VisitNote {
  id: string;
  visitId: string;
  noteType: string;
  status: 'draft' | 'submitted' | 'signed';
  author: PersonRef;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  narrative: string | null;
  amendsNoteId: string | null;
  /** Possible incident found in the note (D-096). */
  incidentFlag: { type: string; label: string; reason: string | null; status: string } | null;
  submittedAt: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface Vital {
  id: string;
  recordedById: string;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  temperature: number | null;
  temperatureUnit: string;
  oxygenSaturation: number | null;
  weight: number | null;
  weightUnit: string;
  painLevel: number | null;
  bloodGlucose: number | null;
  notes: string | null;
  recordedAt: string;
  enteredInError: { at: string; byId: string | null; reason: string | null } | null;
}

export interface VisitTask {
  id: string;
  taskName: string;
  description: string | null;
  state: 'open' | 'done' | 'not_done';
  completedAt: string | null;
  notDoneReason: string | null;
  sortOrder: number;
}

export interface OpenShift {
  id: string;
  status: 'open' | 'filled' | 'cancelled';
  expired: boolean;
  notes: string | null;
  expiresAt: string | null;
  broadcastAt: string | null;
  visit: {
    id: string;
    visitType: string;
    scheduledDate: string;
    scheduledStart: string;
    scheduledEnd: string;
    priority: string;
    disciplines: string[];
  };
  area: { city: string | null; zip: string | null };
  patient: PersonRef | null;
  filledBy:
    (PersonRef & { staffId: string; discipline: string; how: 'claimed' | 'assigned' }) | null;
  createdAt: string;
}

export interface ShiftSwap {
  id: string;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  reason: string | null;
  decisionNote: string | null;
  visit: {
    id: string;
    visitType: string;
    scheduledDate: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
  requesting: PersonRef & { discipline: string };
  target: (PersonRef & { discipline: string }) | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}
