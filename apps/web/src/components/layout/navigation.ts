/** Sidebar entries; each shows only if the user holds its permission (the API enforces it regardless). */
export const NAVIGATION = [
  { href: '/', label: 'Dashboard', permission: null },
  { href: '/messages', label: 'Messages', permission: 'messages:use' },
  { href: '/schedule', label: 'Schedule', permission: 'visits:read' },
  { href: '/monitor', label: 'Live monitor', permission: 'evv:read' },
  { href: '/evv', label: 'EVV review', permission: 'evv:read' },
  { href: '/patients', label: 'Patients', permission: 'patients:read' },
  { href: '/staff', label: 'Staff', permission: 'staff:read' },
  { href: '/physicians', label: 'Physicians', permission: 'physicians:read' },
  { href: '/billing/ready', label: 'Ready to bill', permission: 'billing:read' },
  { href: '/billing/claims', label: 'Claims', permission: 'billing:read' },
  { href: '/billing/payments', label: 'Payments', permission: 'billing:read' },
  { href: '/billing/setup', label: 'Billing setup', permission: 'billing:read' },
  { href: '/users', label: 'Users', permission: 'users:read' },
  { href: '/settings/agency', label: 'Agency settings', permission: 'settings:read' },
] as const;
