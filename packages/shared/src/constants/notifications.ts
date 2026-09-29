/** Notification types (DESIGN.md §13.2). Titles and bodies must never contain PHI (§13.3). */
export const NOTIFICATION_TYPES = [
  'shift_reminder',
  'shift_assigned',
  'shift_unassigned',
  'shift_cancelled',
  'shift_updated',
  'open_shift',
  'swap_requested',
  'swap_decided',
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

/** Alerts nobody can switch off (security and serious-incident alerts, D-066). */
export const MANDATORY_NOTIFICATION_TYPES: readonly NotificationType[] = ['system'];

/** Delivery channels. In-app always; push, SMS and email once the agency's accounts are connected (D-071). */
export const NOTIFICATION_CHANNELS = ['inApp', 'push', 'sms', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Channels outside the app, sent through the delivery outbox (D-071). */
export type DeliveryChannel = 'push' | 'sms' | 'email';

/**
 * Which outside channels a type uses when the person hasn't chosen (DESIGN.md §13.2; types added since follow the
 * closest listed one). Texts are kept for what can't wait: a new shift and a missed visit.
 */
export const DEFAULT_DELIVERY_CHANNELS: Record<NotificationType, readonly DeliveryChannel[]> = {
  shift_reminder: ['push'],
  shift_assigned: ['push', 'sms'],
  shift_unassigned: ['push'],
  shift_cancelled: ['push'],
  shift_updated: ['push'],
  open_shift: ['push'],
  swap_requested: ['push'],
  swap_decided: ['push'],
  missed_visit: ['push', 'sms'],
  late_arrival: [],
  credential_expiry: ['email'],
  auth_limit: ['email'],
  claim_status: [],
  message_received: ['push'],
  document_signature: ['push', 'email'],
  payroll_ready: ['email'],
  time_off_decided: ['push'],
  evv_correction_decided: ['push'],
  system: ['email'],
};
