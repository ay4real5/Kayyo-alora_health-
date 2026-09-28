/** Built-in system roles (DESIGN.md §7.2). Agencies may add custom roles on top of these. */
export const ROLES = [
  'super_admin',
  'agency_admin',
  'supervisor',
  'registered_nurse',
  'licensed_nurse',
  'therapist',
  'home_health_aide',
  'billing_staff',
  'office_staff',
  'medical_social_worker',
  'portal_user',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that deliver care in the field and use the mobile app / EVV. */
export const FIELD_ROLES = [
  'registered_nurse',
  'licensed_nurse',
  'therapist',
  'home_health_aide',
  'medical_social_worker',
] as const satisfies readonly Role[];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Roles that must use two-factor authentication (owner's decision, DECISIONS D-044/D-045). */
export const MANDATORY_TWO_FACTOR_ROLES: readonly Role[] = ['super_admin', 'agency_admin'];
