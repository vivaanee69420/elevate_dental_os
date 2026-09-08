import { useQuery } from '@tanstack/react-query';
import { getPractitionerUtilisation, type UtilBasis } from './practitioner-utilisation-api';

export function usePractitionerUtilisation(opts: {
  since: string;
  until: string;
  practiceId?: string | null;
  basis?: UtilBasis;
  /** False holds the request back entirely. Used by the chart's week-aligned
   *  second window, which must not fire when it would duplicate the first. */
  enabled?: boolean;
}) {
  return useQuery({
    // The basis is part of the key: it changes every number on the page, so a
    // cached result from another basis would be the wrong answer served fast.
    queryKey: ['practitioner-utilisation', opts.since, opts.until, opts.practiceId ?? null, opts.basis ?? 'clinical'],
    queryFn: () => getPractitionerUtilisation(opts),
    staleTime: 60_000,
    // Keep the current window on screen while the next loads, so changing the
    // dates does not blank the page and read as "no data".
    placeholderData: (prev) => prev,
    enabled: opts.enabled ?? true,
  });
}
