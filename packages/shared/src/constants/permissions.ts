/**
 * Permission catalogue, written `resource:action` (DECISIONS D-004).
 * Derived from the Auth column of the API tables in DESIGN.md §6.
 */
export const PERMISSION_CATALOGUE = {
  users: ['create', 'read', 'update', 'delete'],
  settings: ['read', 'update'],
  patients: ['create', 'read', 'update'],
  care_plans: ['create', 'update'],
  assessments: ['create', 'update', 'approve'],
  orders: ['create', 'update'],
  staff: ['create', 'read', 'update', 'delete'],
  time_off: ['approve'],
  visits: ['create', 'read', 'update', 'assign', 'approve'],
  visit_notes: ['create', 'update', 'sign'],
  vitals: ['create'],
  evv: ['read', 'update', 'approve', 'export'],
  billing: ['create', 'read', 'update', 'submit', 'void', 'send'],
  payroll: ['create', 'read', 'update', 'approve', 'export'],
  documents: ['create', 'read', 'delete', 'sign', 'send'],
  notifications: ['create'],
  reports: ['read'],
  compliance: ['create', 'read', 'update'],
  audit_logs: ['read'],
} as const;

type Catalogue = typeof PERMISSION_CATALOGUE;
export type PermissionResource = keyof Catalogue;
export type Permission = {
  [R in PermissionResource]: `${R}:${Catalogue[R][number]}`;
}[PermissionResource];

/** Every permission string, e.g. `patients:read`. */
export const PERMISSIONS: readonly Permission[] = (
  Object.entries(PERMISSION_CATALOGUE) as [PermissionResource, readonly string[]][]
).flatMap(([resource, actions]) => actions.map((action) => `${resource}:${action}` as Permission));

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
