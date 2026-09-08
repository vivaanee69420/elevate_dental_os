import { useQuery } from '@tanstack/react-query';
import { getPractitionerUtilisation } from './practitioner-utilisation-api';

export function usePractitionerUtilisation(opts: {
  since: string;
  until: string;
  practiceId?: string | null;
}) {
  return useQuery({
    queryKey: ['practitioner-utilisation', opts.since, opts.until, opts.practiceId ?? null],
    queryFn: () => getPractitionerUtilisation(opts),
    staleTime: 60_000,
    // Keep the current window on screen while the next loads, so changing the
    // dates does not blank the page and read as "no data".
    placeholderData: (prev) => prev,
  });
}
