import { DecisionDetailScreen } from '@/components/activity/DecisionDetail';

export const metadata = { title: 'Event & proof - Thesauros' };

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DecisionDetailScreen id={id} />;
}
