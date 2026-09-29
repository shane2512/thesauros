import { Suspense } from 'react';
import { ApprovalsScreen } from '@/components/approvals/ApprovalsScreen';

export const metadata = { title: 'Approvals - Thesauros' };

export default function ApprovalsPage() {
  return (
    <Suspense>
      <ApprovalsScreen />
    </Suspense>
  );
}
