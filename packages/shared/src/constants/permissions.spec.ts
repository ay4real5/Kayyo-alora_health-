import { PERMISSIONS, isPermission } from './permissions.js';

describe('permissions', () => {
  it('uses resource:action format with no duplicates', () => {
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z_]+:[a-z]+$/);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('recognises valid and invalid permission strings', () => {
    expect(isPermission('patients:read')).toBe(true);
    expect(isPermission('read:patients')).toBe(false);
  });
});
