/** Human-readable labels for codes the API returns. */

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  agency_admin: 'Agency admin',
  supervisor: 'Clinical supervisor',
  registered_nurse: 'Registered nurse (RN)',
  licensed_nurse: 'Licensed nurse (LPN/LVN)',
  therapist: 'Therapist (PT/OT/ST)',
  home_health_aide: 'Home health aide',
  billing_staff: 'Billing staff',
  office_staff: 'Office staff',
  medical_social_worker: 'Medical social worker',
  portal_user: 'Patient portal user',
};

export function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? String(dayOfWeek);
}

/** 'shift_assigned' → 'Shift assigned'. */
export function humanize(code: string): string {
  const text = code.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
