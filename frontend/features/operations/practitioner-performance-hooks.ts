import { useQuery } from '@tanstack/react-query';
import { getPractitionerPerformance } from './practitioner-performance-api';
import type { UtilBasis } from './practitioner-utilisation-api';

/**
 * The comparison window is a SECOND CALL TO THE SAME ENDPOINT, never a
 * `compare_*` parameter. It therefore cannot drift from the primary figure,
 * because it IS the primary figure asked for a different period — the same
 * reasoning the Facebook report uses.
 *
 * `enabled` is kept for a caller that needs to hold the request back; the
 * performance page no longer uses it, because comparison there is always on.
 */
export function usePractitionerPerformance(opts: {
  since: string;
  until: string;
  practiceId?: string | null;
  basis?: UtilBasis;
  enabled?: boolean;
}) {
  return useQuery({
    // Every input that changes the numbers is in the key. A basis or a practice
    // missing from it would serve one window's figures under another's label.
    queryKey: ['practitioner-performance', opts.since, opts.until, opts.practiceId ?? null, opts.basis ?? 'rota'],
    queryFn: () => getPractitionerPerformance(opts),
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  });
}
