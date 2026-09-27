/** Sidebar entries; each shows only if the user holds its permission (the API enforces it regardless). */
export const NAVIGATION = [
  { href: '/', label: 'Dashboard', permission: null },
  { href: '/schedule', label: 'Schedule', permission: 'visits:read' },
  { href: '/patients', label: 'Patients', permission: 'patients:read' },
  { href: '/staff', label: 'Staff', permission: 'staff:read' },
  { href: '/physicians', label: 'Physicians', permission: 'physicians:read' },
  { href: '/users', label: 'Users', permission: 'users:read' },
] as const;
