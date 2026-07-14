// PipelineTag — coloured channel tag for cockpit lead rows. Colour is
// decorative only: the visible text always carries the meaning (channel
// label), and the raw GHL pipeline name is available via `title` on hover.
// Built on the shared Chip primitive (frozen palette) so it matches every
// other tag in the app.
import { Chip, type ChipColour } from '@/components/ui/Chip';
import type { LeadChannel } from '../api';

const CHANNEL_LABEL: Record<LeadChannel, string> = {
  google: 'Google',
  facebook: 'Facebook',
  website: 'Website',
  instagram: 'Instagram',
  other: 'Other',
};

// Validated palette (channel -> Chip colour, matching the brief's hex intent):
// facebook #2563eb (blue), google #f59e0b (amber), website #10b981 (emerald),
// instagram #8b5cf6 (purple), other #94a3b8 (slate).
const CHANNEL_COLOUR: Record<LeadChannel, ChipColour> = {
  facebook: 'blue',
  google: 'amber',
  website: 'emerald',
  instagram: 'purple',
  other: 'slate',
};

export function PipelineTag({ channel, pipelineName }: { channel: LeadChannel; pipelineName?: string | null }) {
  return (
    <span title={pipelineName ?? undefined}>
      <Chip colour={CHANNEL_COLOUR[channel] ?? 'slate'} className="whitespace-nowrap">
        {CHANNEL_LABEL[channel] ?? 'Other'}
      </Chip>
    </span>
  );
}
