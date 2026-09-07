'use client';
// People across both channels, counted once.
//
// The one figure neither per-channel report can produce: each knows only its
// own channel, so neither can tell that a person who appears in Google and in
// Facebook is one person. Everything else on this page is delegated to the
// service that owns it; this is computed, and it is computed on the SAME two
// ledgers the blocks below are built from.
//
// The overlap is a LOWER BOUND and says so. The ledgers identify a person
// differently — Meta by contact id, Google by phone, because a large share of
// Google's leads arrive through CallRail which carries no email — so email is
// the only key both sides share. A lead with no email cannot be shown to be the
// same person as one in the other channel, however likely it is, and the panel
// reports how many such rows there are rather than printing a confident number
// over an unmeasured blind spot.

import { useQuery } from '@tanstack/react-query';
import { SectionCard, SecHead, EmptyState, Skeleton } from '@/components/ui';
import { StatRail } from '@/features/marketing/_shared/StatRail';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { api } from '@/lib/api';

interface GroupTotal {
  state: 'ok' | 'unavailable';
  reason?: string;
  metaAvailable: boolean;
  googleAvailable: boolean;
  people: number;
  metaPeople: number;
  googlePeople: number;
  overlap: number;
  overlapIsLowerBound: boolean;
  unmatchable: number;
  anonymous: number;
  booked: number;
  accepted: number;
}

const nf = new Intl.NumberFormat('en-GB');

export function GroupTotalBlock() {
  const { win, scope } = useScopePeriod();
  const practiceId = scope !== 'all' ? scope : '';

  const { data, isPending, error } = useQuery<GroupTotal>({
    queryKey: ['ad-performance', 'group-total', win.since, win.until, practiceId],
    queryFn: () => {
      const sp = new URLSearchParams({ since: win.since, until: win.until });
      if (practiceId) sp.set('practice_id', practiceId);
      return api<GroupTotal>(`/api/ad-attribution/group-total?${sp.toString()}`);
    },
    staleTime: 30_000,
  });

  return (
    <SectionCard>
      <SecHead
        n={1}
        title="Both channels, people counted once"
        desc="Someone who appears in Google and in Facebook counts once here, which is why this is smaller than the two blocks added together."
      />

      {isPending && <Skeleton className="h-24 w-full" />}

      {error && (
        <EmptyState message={`Could not load the cross-channel total: ${(error as Error).message}`} />
      )}

      {data?.state === 'unavailable' && (
        <EmptyState message={data.reason ?? 'Cross-channel total unavailable.'} />
      )}

      {data?.state === 'ok' && (
        <>
          {/* A channel that could not be read is named, because the total below
              is then a total of what could be read — not of what exists. */}
          {(!data.metaAvailable || !data.googleAvailable) && (
            <p className="text-[12.5px] text-amber-800">
              {!data.metaAvailable && !data.googleAvailable
                ? 'Neither channel could be read.'
                : `Only ${data.metaAvailable ? 'Facebook' : 'Google'} could be read — the figures below cover that channel alone.`}
            </p>
          )}

          {/* The same rail the Facebook and Google reports open with, so this
              page reads as one family rather than a third design. */}
          <StatRail
            stats={[
              { label: 'People', value: nf.format(data.people), sub: `${nf.format(data.booked)} booked`, accent: true },
              {
                label: 'In both channels',
                value: data.overlapIsLowerBound ? `${nf.format(data.overlap)}+` : nf.format(data.overlap),
                sub: data.overlapIsLowerBound ? 'At least — see below' : 'Exact',
              },
              { label: 'Facebook', value: nf.format(data.metaPeople), sub: 'Before deduping' },
              { label: 'Google', value: nf.format(data.googlePeople), sub: 'Before deduping' },
              { label: 'Acquired', value: nf.format(data.accepted), sub: 'Paid over the acceptance floor' },
            ]}
          />

          {/* The caveat, measured. Vague hedging ("this may be an
              undercount") tells the reader nothing they can act on; a count
              tells them exactly how much of the data is blind. */}
          {data.overlapIsLowerBound && (
            <p className="mt-3 text-[12.5px] text-ink-muted">
              {nf.format(data.unmatchable)} lead{data.unmatchable === 1 ? '' : 's'} carry no email
              address, and email is the only detail both channels record — most often a
              Google lead that arrived as a phone call. Those cannot be matched to the other
              channel, so the real overlap is at least {nf.format(data.overlap)} and may be higher.
              {data.anonymous > 0 && ` ${nf.format(data.anonymous)} have no identifying detail at all: counted as people, never matched.`}
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}
