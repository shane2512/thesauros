import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { AuthGate } from '@/components/shell/AuthGate';

// Onboarding keeps the global header (and its Freeze button) but not the tab bar: there is nothing
// to navigate to until the policy is active.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell tabs={false}>{children}</AppShell>
    </AuthGate>
  );
}
