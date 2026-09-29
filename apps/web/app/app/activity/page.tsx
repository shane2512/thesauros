import { Suspense } from 'react';
import { ActivityScreen } from '@/components/activity/ActivityScreen';

export const metadata = { title: 'Activity - Thesauros' };

export default function ActivityPage() {
  return (
    <Suspense>
      <ActivityScreen />
    </Suspense>
  );
}
