/** Notification types (DESIGN.md §13.2). Titles and bodies must never contain PHI (§13.3). */
export const NOTIFICATION_TYPES = [
  'shift_reminder',
  'shift_assigned',
  'shift_unassigned',
  'shift_cancelled',
  'shift_updated',
  'open_shift',
  'missed_visit',
  'late_arrival',
  'credential_expiry',
  'auth_limit',
  'claim_status',
  'message_received',
  'document_signature',
  'payroll_ready',
  'time_off_decided',
  'evv_correction_decided',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
