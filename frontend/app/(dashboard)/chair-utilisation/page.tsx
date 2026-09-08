import { ChairEntryScreen } from '@/features/operations/components/ChairEntryScreen';

// Data entry for chair utilisation, gated on operations.view. Chair Efficiency
// (/chair) reads finance.view, so the two live on separate pages: stacked on
// one, a practice manager without finance access saw half a broken screen.
export default function ChairUtilisationPage() {
  return <ChairEntryScreen />;
}
