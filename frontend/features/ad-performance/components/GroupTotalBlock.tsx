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
import { EmptyState, Skeleton } from '@/components/ui';
import { SectionLabel } from '@/features/overview/components/HeadlineCard';
import { HeadlineCard, type HeadlineKpi } from '@/features/overview/components/HeadlineCard';
import { previousPeriod, type Polarity } from '@/features/marketing/_shared/compare';
import { londonDateOf, lastInclusiveLondonDay } from '@/features/marketing/_shared/window';
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

  const fetchWindow = (since: string, until: string) => {
    const sp = new URLSearchParams({ since, until });
    if (practiceId) sp.set('practice_id', practiceId);
    return api<GroupTotal>(`/api/ad-attribution/group-total?${sp.toString()}`);
  };

  const { data, isPending, error } = useQuery<GroupTotal>({
    queryKey: ['ad-performance', 'group-total', win.since, win.until, practiceId],
    queryFn: () => fetchWindow(win.since, win.until),
    staleTime: 30_000,
  });

  // The SAME window one period earlier. Converted through the London helpers
  // rather than slicing the ISO string: these are London calendar days, and a
  // slice of a London instant lands on the wrong date around midnight and
  // through the BST boundary.
  const prevWin = previousPeriod(londonDateOf(win.since), lastInclusiveLondonDay(win.until));
  const previous = useQuery<GroupTotal>({
    queryKey: ['ad-performance', 'group-total', prevWin.since, prevWin.until, practiceId],
    queryFn: () => fetchWindow(prevWin.since, prevWin.until),
    staleTime: 30_000,
  });
  const prev = previous.data?.state === 'ok' ? previous.data : null;
  const previousLabel = `${prevWin.since} to ${prevWin.until}`;

  const cmp = (
    current: number | null, previous_: number | null, polarity: Polarity,
  ): HeadlineKpi['compare'] => (prev ? {
    current, previous: previous_, polarity,
    format: (n) => nf.format(n),
  } : undefined);

  const ok = data?.state === 'ok' ? data : null;
  const groupCards: HeadlineKpi[] = ok ? [
    {
      label: 'People', value: nf.format(ok.people), sub: 'Counted once',
      chip: { text: `${nf.format(ok.booked)} booked`, tone: 'emerald' },
      compare: cmp(ok.people, prev?.people ?? null, 'higher-better'),
    },
    {
      label: 'In both channels',
      value: ok.overlapIsLowerBound ? `${nf.format(ok.overlap)}+` : nf.format(ok.overlap),
      sub: ok.overlapIsLowerBound ? 'At least this many' : 'Exact',
      chip: null,
      compare: cmp(ok.overlap, prev?.overlap ?? null, 'neutral'),
    },
    {
      label: 'Facebook', value: nf.format(ok.metaPeople), sub: 'Before deduping',
      chip: null,
      compare: cmp(ok.metaPeople, prev?.metaPeople ?? null, 'higher-better'),
    },
    {
      label: 'Google', value: nf.format(ok.googlePeople), sub: 'Before deduping',
      chip: null,
      compare: cmp(ok.googlePeople, prev?.googlePeople ?? null, 'higher-better'),
    },
    {
      label: 'Acquired', value: nf.format(ok.accepted), sub: 'Paid over the floor',
      chip: ok.people > 0
        ? { text: `${((ok.accepted / ok.people) * 100).toFixed(1)}% of people`, tone: 'emerald' }
        : null,
      compare: cmp(ok.accepted, prev?.accepted ?? null, 'higher-better'),
    },
  ] : [];

  return (
    // No card wrapper and no numbered section head: both added padding and
    // vertical rhythm around four figures that read perfectly well as a row.
    <div className="flex flex-col gap-2">
      <div>
        {/* The same titled divider the Business Hub uses above each source's
            row of cards, so a section reads as a section here too. */}
        <SectionLabel>Both channels · people counted once</SectionLabel>
        <p className="-mt-1 mb-1 text-[12px] text-ink-muted">
          Someone in both channels counts once, so this is smaller than the two added together.
        </p>
      </div>

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

          {/* The same card as everywhere else on this page, and as the
              Business Hub. The flat rail this replaces could carry no
              comparison at all, so these five numbers were the only ones on
              the page with no direction — the figures that matter most, and
              the only ones you could not tell were rising or falling. */}
          {prev && (
            <p className="-mb-1 text-[11.5px] text-ink-muted">Compared with {previousLabel}</p>
          )}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            {groupCards.map((c) => <HeadlineCard key={c.label} c={c} />)}
          </div>

          {/* The caveat, measured. Vague hedging ("this may be an
              undercount") tells the reader nothing they can act on; a count
              tells them exactly how much of the data is blind. */}
          {data.overlapIsLowerBound && (
            <p className="text-[12px] text-ink-muted">
              {/* The caveat has to survive, because the overlap is genuinely a
                  lower bound — but it can be one sentence rather than four. */}
              {nf.format(data.unmatchable)} lead{data.unmatchable === 1 ? '' : 's'} carry no email,
              the only detail both channels record, so they cannot be matched — the real
              overlap is at least {nf.format(data.overlap)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
