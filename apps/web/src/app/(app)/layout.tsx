import { AppShell } from '@/components/layout/app-shell';

/** Every page in this group requires a signed-in user. */
export default function SignedInLayout({ children }: LayoutProps<'/'>) {
  return <AppShell>{children}</AppShell>;
}
