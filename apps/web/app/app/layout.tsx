import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { AuthGate } from '@/components/shell/AuthGate';

export default function AuthedLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
