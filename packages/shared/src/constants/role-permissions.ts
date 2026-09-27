import { PERMISSIONS, type Permission } from './permissions.js';
import type { Role } from './roles.js';

/**
 * What each built-in role may do (DESIGN.md §7.2). These roles are synced into the database on every API
 * start and cannot be edited there; agencies make custom roles for anything different (DECISIONS D-022).
 *
 * Permissions answer "may this role do X at all?". Narrower rules — e.g. a nurse only sees their assigned
 * patients, a caregiver only clocks in to their own visits — are enforced per record by each module.
 */

const CLINICAL_BASE: Permission[] = [
  'patients:read',
  'visits:read',
  'visit_notes:create',
  'visit_notes:update',
  'visit_notes:sign',
  'vitals:create',
  'documents:read',
  'documents:create',
];

export const ROLE_DEFAULT_PERMISSIONS: Record<Role, readonly Permission[]> = {
  /** Platform owner. Cross-agency powers come later; within an agency, everything. */
  super_admin: PERMISSIONS,

  agency_admin: PERMISSIONS,

  /** Clinical supervisor: all clinical and scheduling work, approvals, live monitoring. No billing/payroll. */
  supervisor: [
    'patients:create',
    'patients:read',
    'patients:update',
    'care_plans:create',
    'care_plans:update',
    'assessments:create',
    'assessments:update',
    'assessments:approve',
    'orders:create',
    'orders:update',
    'staff:read',
    'staff:update',
    'time_off:approve',
    'visits:create',
    'visits:read',
    'visits:update',
    'visits:assign',
    'visits:approve',
    'visit_notes:create',
    'visit_notes:update',
    'visit_notes:sign',
    'vitals:create',
    'evv:read',
    'evv:update',
    'evv:approve',
    'documents:create',
    'documents:read',
    'documents:sign',
    'documents:send',
    'notifications:create',
    'reports:read',
    'compliance:create',
    'compliance:read',
    'compliance:update',
  ],

  registered_nurse: [
    ...CLINICAL_BASE,
    'care_plans:create',
    'care_plans:update',
    'assessments:create',
    'assessments:update',
    'orders:create',
    'orders:update',
    'documents:sign',
  ],

  /** LPN/LVN: like an RN but cannot write care plans or physician orders. */
  licensed_nurse: [...CLINICAL_BASE, 'assessments:create', 'assessments:update', 'documents:sign'],

  therapist: [...CLINICAL_BASE, 'assessments:create', 'assessments:update', 'documents:sign'],

  /** HHA/CNA: visit documentation (activity notes, vitals, task checklists). No signing. */
  home_health_aide: ['patients:read', 'visits:read', 'visit_notes:create', 'visit_notes:update', 'vitals:create'],

  medical_social_worker: [...CLINICAL_BASE, 'assessments:create', 'assessments:update'],

  /** Billing: full billing and claims, patient demographics, no clinical notes. */
  billing_staff: [
    'patients:read',
    'visits:read',
    'evv:read',
    'billing:create',
    'billing:read',
    'billing:update',
    'billing:submit',
    'billing:void',
    'billing:send',
    'reports:read',
  ],

  /** Office coordinator: scheduling, basic patient info, staff management. No billing, no clinical notes. */
  office_staff: [
    'patients:create',
    'patients:read',
    'patients:update',
    'staff:create',
    'staff:read',
    'staff:update',
    'visits:create',
    'visits:read',
    'visits:update',
    'visits:assign',
    'evv:read',
    'documents:create',
    'documents:read',
    'notifications:create',
  ],

  /** Patients/family: only the /portal endpoints, which have their own own-data guard (P3-14). */
  portal_user: [],
};
