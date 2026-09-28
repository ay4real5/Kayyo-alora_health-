import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PortalShell } from '@/components/portal/portal-shell';

export const metadata: Metadata = { title: 'Patient portal' };

/** The patient & family portal (D-058): its own frame, portal users only. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
