// Chip — shared status/label pill used across every screen for pipeline
// stages, statuses, and tags. Palette mirrors the preview prototype
// (.chip-* in globals.css). Frozen Phase-0 primitive: section agents
// consume this, they do not restyle it.

export type ChipColour =
  | 'brand'
  | 'amber'
  | 'blue'
  | 'purple'
  | 'indigo'
  | 'cyan'
  | 'emerald'
  | 'rose'
  | 'slate';

interface ChipProps {
  /** Visible text inside the pill. */
  children: React.ReactNode;
  /** Colour variant; maps to a .chip-<colour> class. Defaults to slate. */
  colour?: ChipColour;
  /** Optional extra classes for spacing in a parent layout. */
  className?: string;
}

/**
 * Render a single colour-coded pill.
 * Pure presentational component — no state, no side effects.
 */
export function Chip({ children, colour = 'slate', className = '' }: ChipProps) {
  return (
    <span className={`chip chip-${colour} ${className}`.trim()}>{children}</span>
  );
}

/**
 * Canonical pipeline-stage -> chip colour map.
 * Mirrors STAGE_CHIPS in the preview prototype so every screen that shows a
 * lead/patient stage uses identical colours. Lives with the primitive so
 * agents import one source of truth.
 */
export const STAGE_CHIP_COLOUR: Record<string, ChipColour> = {
  new: 'blue',
  contact_attempted: 'amber',
  contact_made: 'purple',
  consultation_booked: 'indigo',
  consultation_attended: 'cyan',
  treatment_started: 'emerald',
  treatment_completed: 'emerald',
  not_proceeding: 'rose',
  failed_to_attend: 'rose',
  paused: 'slate',
};
