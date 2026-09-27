import { PERMISSIONS } from './permissions.js';
import { ROLE_DEFAULT_PERMISSIONS } from './role-permissions.js';
import { ROLES } from './roles.js';

describe('ROLE_DEFAULT_PERMISSIONS', () => {
  it('covers every role and only uses real permissions, without duplicates', () => {
    expect(Object.keys(ROLE_DEFAULT_PERMISSIONS).sort()).toEqual([...ROLES].sort());
    for (const [role, permissions] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const p of permissions) expect(PERMISSIONS, `${role} → ${p}`).toContain(p);
      expect(new Set(permissions).size, role).toBe(permissions.length);
    }
  });

  it('keeps the separations the design asks for', () => {
    const can = (role: keyof typeof ROLE_DEFAULT_PERMISSIONS, p: string) =>
      (ROLE_DEFAULT_PERMISSIONS[role] as readonly string[]).includes(p);

    expect(can('billing_staff', 'visit_notes:create')).toBe(false); // no clinical notes for billing
    expect(can('office_staff', 'billing:read')).toBe(false); // no billing for office staff
    expect(can('licensed_nurse', 'care_plans:update')).toBe(false); // LPNs can't write care plans
    expect(can('registered_nurse', 'care_plans:update')).toBe(true);
    expect(can('home_health_aide', 'visit_notes:sign')).toBe(false);
    expect(can('supervisor', 'billing:read')).toBe(false);
    expect(can('registered_nurse', 'patients:read_all')).toBe(false); // field staff: assigned patients only
    expect(can('office_staff', 'patients:read_all')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.portal_user).toEqual([]);
    expect(ROLE_DEFAULT_PERMISSIONS.agency_admin).toEqual(PERMISSIONS);
  });
});
