'use client';
// Pipeline — wired to GET /api/leads + GET /api/leads/pipelines.
//
// When GoHighLevel pipelines are synced, this renders the SELECTED pipeline's
// real GHL stages as the kanban columns (dynamic), grouping leads by their raw
// ghl_pipeline_stage_id — a pipeline selector switches between them and only
// that pipeline's leads show. With no GHL pipelines (manual-only org) it falls
// back to the fixed Elevate-status columns.

import { useEffect, useState } from 'react';
import { useLeads, usePipelines, usePipelineSummary } from '@/features/leads/hooks';
import { leadsExportUrl, type Lead, type LeadStatus } from '@/features/leads/api';
// money() renders null as an em dash; lib/format's formatPence renders it as
// "£0.00" and its signature accepts null, so TypeScript never warns. A lead
// with no estimated value must not be shown as being worth nothing.
import { money, DASH } from '@/features/marketing/_shared/format';
import { CRM_TEAL, agoLabel } from '../data';
import { LeadDetailModal } from '../_shared/LeadDetailModal';
import { useGhlAccounts } from '@/features/integrations/hooks';
import { SubaccountFilterBar } from '@/features/ghl/components/SubaccountFilterBar';

// Fallback columns (no GHL pipeline) — verbatim from the prototype.
const FALLBACK_STAGES: { key: string; label: string; colour: string; byStatus: LeadStatus }[] = [
  { key: 'new', label: 'New', colour: '#3B82F6', byStatus: 'new' },
  { key: 'contact_attempted', label: 'Contact attempt', colour: 'var(--warning)', byStatus: 'contact_attempted' },
  { key: 'contact_made', label: 'Contact made', colour: '#8B5CF6', byStatus: 'contact_made' },
  { key: 'consultation_booked', label: 'Consult booked', colour: '#06B6D4', byStatus: 'consultation_booked' },
  { key: 'consultation_attended', label: 'Consult attended', colour: '#0891B2', byStatus: 'consultation_attended' },
  { key: 'treatment_started', label: 'In treatment', colour: 'var(--success)', byStatus: 'treatment_started' },
];

// Board viewport height.
//
// Viewport-relative, not a fixed 620px. A fixed height left the PAGE
// scrollable too: scrolling down slid the stage headers off the top while
// leaving dead space below the board, so you lost track of which column you
// were reading. Sized to the space actually left under the page header, the
// board is the only thing that scrolls and its headers stay put.
// clamp() keeps it usable on a short laptop screen and stops it stretching
// absurdly on a tall monitor.
const BOARD_HEIGHT = 'clamp(380px, calc(100vh - 290px), 900px)';

const STAGE_COLOURS = ['#3B82F6', 'var(--warning)', '#8B5CF6', '#06B6D4', '#0891B2', 'var(--success)', 'var(--ink-muted)', '#DC2626', '#7C3AED', '#EA580C'];

// Created-at windows for the board. `all` is the default: a pipeline is a
// standing view of work in progress, and defaulting to a window would hide
// older open leads without saying so.
type RangeKey = 'all' | '7d' | '30d' | '90d' | '12m' | 'custom';
const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: 'all', label: 'All time', days: null },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '12m', label: 'Last 12 months', days: 365 },
  { key: 'custom', label: 'Custom…', days: null },
];

/** Local midnight N days back, as an instant. */
function startOfDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
/** A yyyy-mm-dd from a date input, as the FIRST instant of that local day. */
function dayStart(ymd: string): string | null {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** …and the LAST instant of it, so the end date is included rather than
 *  silently excluding everything logged on the day the user picked. */
function dayEnd(ymd: string): string | null {
  if (!ymd) return null;
  const d = new Date(`${ymd}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

function displayName(l: Lead): string {
  const joined = `${l.contact?.first_name ?? ''} ${l.contact?.last_name ?? ''}`.trim();
  return joined || `Lead ${l.id.slice(0, 8)}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?';
}

/** Pipeline kanban screen. */
export default function PipelineScreen() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: ghlData } = useGhlAccounts();

  // Pipelines are scoped to the selected subaccount — each GHL Location has its
  // own disjoint set of pipeline ids, and a lead only ever carries its own
  // Location's. A pipeline picked under one subaccount is meaningless under
  // another, so fall back to the first of the current set when it isn't offered.
  const { data: pData } = usePipelines(accountId);
  const pipelines = pData?.pipelines ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  // Stages the user has folded away. Keyed by stage id, so collapsing survives
  // a refetch but resets when a different pipeline is chosen — a stage id from
  // one pipeline means nothing in another.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Created-at window. ONE pair of instants, handed to the card list, the
  // stage aggregate AND the CSV export, so all three describe the same leads.
  const [range, setRange] = useState<RangeKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const { since, until } = (() => {
    if (range === 'custom') {
      return { since: dayStart(customFrom), until: dayEnd(customTo) };
    }
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    return { since: days === null ? null : startOfDaysAgo(days), until: null };
  })();
  const toggleCollapsed = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const selectedId = (picked && pipelines.some((p) => p.id === picked) ? picked : pipelines[0]?.id) ?? null;

  // THE CARDS are a page; THE FIGURES are not.
  //
  // This fetch is deliberately bounded — a board cannot render 2,092 cards and
  // nobody would read them. What changed is that the counts and totals no
  // longer come from it. They come from an SQL aggregate over every lead in
  // the pipeline (usePipelineSummary below), because summing this page is what
  // made a pipeline holding 2,092 leads worth £1,421,317 render as
  // "500 leads · £0.00" — every valued lead in it was older than the page.
  const CARD_PAGE = 500;
  const { data, isLoading, error } = useLeads({
    ...(selectedId ? { ghl_pipeline_id: selectedId } : {}),
    ...(accountId ? { integration_account_id: accountId } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
    limit: CARD_PAGE,
  });
  const leads: Lead[] = data?.leads ?? [];

  // Folded stages belong to the pipeline they were folded in. GHL stage ids
  // are disjoint per pipeline, so carrying the set across a pipeline change
  // would collapse nothing and, worse, silently keep a stale id around.
  useEffect(() => { setCollapsed(new Set()); }, [selectedId]);

  const { data: summary, isLoading: summaryLoading, error: summaryError } =
    usePipelineSummary(selectedId, accountId, { since, until });
  const totals = summary?.totals ?? null;
  const byStage = new Map((summary?.stages ?? []).map((s) => [s.stage_id ?? '', s]));
  const selectedPipeline = pipelines.find((p) => p.id === selectedId) ?? null;
  const dynamic = !!selectedPipeline;

  // Columns: dynamic GHL stages, or the fixed fallback.
  const columns = dynamic
    ? selectedPipeline!.stages.map((s, i) => ({ key: s.id, label: s.name, colour: STAGE_COLOURS[i % STAGE_COLOURS.length] }))
    : FALLBACK_STAGES.map((s) => ({ key: s.key, label: s.label, colour: s.colour }));

  // Leads scoped to the selected pipeline (dynamic), else all.
  const scopedLeads = dynamic ? leads.filter((l) => l.ghl_pipeline_id === selectedId) : leads;

  function leadsInColumn(colKey: string): Lead[] {
    if (dynamic) return scopedLeads.filter((l) => l.ghl_pipeline_stage_id === colKey);
    const fb = FALLBACK_STAGES.find((s) => s.key === colKey);
    return leads.filter((l) => l.status === fb?.byStatus);
  }

  // The header reads from SQL, and reports the SAME population the columns do:
  // every lead in the pipeline, not just the open ones. The columns below are
  // the pipeline's own GHL stages — some of which ARE the closed ones — so a
  // header counting only open leads would never sum to the columns beneath it,
  // and a board whose parts do not add up to its total is the kind of panel
  // that quietly teaches people not to trust it.
  //
  // The open subset is shown beside it rather than instead of it, because
  // "what is still live" is the genuinely useful number and the old header
  // called the all-leads total "active pipeline", which it never was.
  //
  // `dynamic` is false only for a manual-only org with no GHL pipeline, where
  // there is nothing to aggregate and the fallback board is the whole set.
  const headerCount = dynamic ? totals?.lead_count ?? null : scopedLeads.length;
  const headerValue = dynamic ? totals?.value_pence ?? null : null;
  const headerValued = dynamic ? totals?.valued_count ?? 0 : 0;
  const openCount = dynamic ? totals?.open_count ?? null : null;
  const openValue = dynamic ? totals?.open_value_pence ?? null : null;

  return (
    <div className="mx-auto w-full" style={{ maxWidth: 1760 }}>
      {/* Title and the figures it summarises. Controls live in their own
          toolbar below, rather than floating between the title and the
          pipeline picker with nothing aligning them. */}
      <div className="mb-3">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>Pipeline</h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {isLoading || summaryLoading ? 'Loading pipeline…' : summaryError ? (
            // A failed summary used to render as "— leads · —", which reads as
            // "this pipeline is empty" rather than "this request failed". It
            // hid a real 500 on this very screen.
            <span className="text-danger">Could not load pipeline figures — {(summaryError as Error).message}</span>
          ) : (
            <>
              {headerCount === null ? DASH : headerCount.toLocaleString('en-GB')} leads
              {' · '}
              {money(headerValue)}
              {/* Say what the money covers. Most leads carry no estimated
                  value, so a total without this reads as the value of every
                  lead on the board rather than of the few that have one. */}
              {headerValue !== null && headerCount ? (
                <span> across {headerValued.toLocaleString('en-GB')} of {headerCount.toLocaleString('en-GB')}</span>
              ) : null}
              {openCount !== null ? (
                <span> · {openCount.toLocaleString('en-GB')} still open, {money(openValue)}</span>
              ) : null}
            </>
          )}
        </p>
      </div>

      {/* Toolbar: everything that changes what the board shows, on one line,
          in one bordered strip — pipeline and window on the left because they
          filter, export on the right because it acts. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-border bg-card px-3 py-2.5">
        {pipelines.length > 0 && (
          <div className="flex min-w-0 items-center gap-2">
            <label className="text-ink-muted shrink-0 text-xs font-semibold" htmlFor="pipeline-select">Pipeline</label>
            <select
              id="pipeline-select"
              value={selectedId ?? ''}
              onChange={(e) => setPicked(e.target.value)}
              className="min-w-0 max-w-[320px] truncate rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-brand-200"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {typeof p.lead_count === 'number' ? `${p.name} (${p.lead_count})` : p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Created-at window. The SAME pair of instants goes to the card list,
            the stage aggregate and the CSV export — filtering the cards alone
            would leave the column counts describing leads no longer on the
            board. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-ink-muted shrink-0 text-xs font-semibold" htmlFor="pipeline-range">Created</label>
          <select
            id="pipeline-range"
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-brand-200"
          >
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>

          {range === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From date"
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-[13px]"
              />
              <span className="text-ink-muted text-xs">to</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To date"
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-[13px]"
              />
              {/* A custom range with only one end filled is a half-set filter.
                  Say so, rather than quietly applying an open-ended window the
                  user did not intend. */}
              {(!customFrom || !customTo) && (
                <span className="text-ink-muted text-[11px]">
                  {!customFrom && !customTo ? 'Pick both dates' : 'Open-ended until both dates are set'}
                </span>
              )}
            </>
          )}

          {/* A window that is not "all time" is worth showing as a removable
              chip: a filtered board that looks unfiltered is how someone
              concludes a pipeline is empty. */}
          {range !== 'all' && (
            <button
              type="button"
              onClick={() => { setRange('all'); setCustomFrom(''); setCustomTo(''); }}
              className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand transition-colors hover:bg-brand-100"
              aria-label="Clear date filter"
            >
              Filtered · clear ×
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
            {/* Hidden (never disabled) with no pipeline selected — an export
                must carry the same filter as the board, never an ambiguous
                "everything". Server-side and unpaginated: it pages past
                PostgREST's 1000-row cap itself, so it can't silently
                truncate the way building a CSV from `leads` (capped at 500
                here) would. */}
            {selectedId && (
              <a
                href={leadsExportUrl({ ghl_pipeline_id: selectedId, integration_account_id: accountId, since, until })}
                download
                // Says what it will contain. The export carries the board's
                // pipeline AND its date window, so the file matches the screen
                // it was launched from rather than quietly returning more.
                title={range === 'all'
                  ? 'Every lead in this pipeline'
                  : 'Only the leads in the current date window'}
                className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-brand-600"
              >
                Export CSV{range !== 'all' ? ' (filtered)' : ''}
              </a>
            )}
        </div>
      </div>

      {ghlData && ghlData.accounts.length > 0 && (
        <div className="mb-4">
          <SubaccountFilterBar
            accounts={ghlData.accounts.map((a) => ({
              accountId: a.id,
              label: a.label || 'GoHighLevel',
              practiceId: a.practice_id ?? null,
            })) as any}
            selected={accountId}
            onSelect={setAccountId}
          />
        </div>
      )}

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12 }}>
          Failed to load leads: {(error as Error).message}
        </div>
      )}

      {/* THE BOARD SCROLLS, NOT THE PAGE.
          Columns used to grow to the height of their tallest one — 500 cards
          deep — so the horizontal scrollbar sat thousands of pixels below the
          fold and could not be reached without scrolling to the bottom of the
          longest column. The board is now a fixed-height region: it scrolls
          sideways at a reachable place, and each column scrolls vertically
          inside itself. `pb-2` leaves room for the scrollbar so it never
          overlaps the last row of cards.

          Columns are a fixed width rather than `1fr`: with 8 stages, equal
          fractions squeeze each to ~180px and the horizontal scrollbar never
          appears at all, which is the actual reason it was missing here. */}
      <div
        className="crm-board-scroll overflow-x-auto overflow-y-hidden pb-2"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div className="flex items-start" style={{ gap: 12 }}>
          {columns.map((stage) => {
            const stageLeads = leadsInColumn(stage.key);
            // Column figures come from SQL for a real GHL pipeline. Reducing
            // stageLeads gave every column header the same defect as the board
            // total, one stage at a time.
            const agg = dynamic ? byStage.get(stage.key) ?? null : null;
            const stageCount = agg ? agg.lead_count : stageLeads.length;
            const stageValue = agg
              ? agg.value_pence
              : (stageLeads.length ? stageLeads.reduce((s, l) => s + (l.estimated_value_pence ?? 0), 0) : null);
            // Cards are a bounded page of the column; the count above is not.
            const hidden = Math.max(0, stageCount - stageLeads.length);

            // A collapsed column keeps its name and count readable sideways, so
            // a board of 8+ stages can be narrowed to the ones being worked
            // without losing track of what was folded away.
            if (collapsed.has(stage.key)) {
              return (
                <button
                  key={stage.key}
                  type="button"
                  onClick={() => toggleCollapsed(stage.key)}
                  aria-label={`Expand ${stage.label}`}
                  aria-expanded={false}
                  className="flex shrink-0 flex-col items-center gap-3 rounded-panel border border-border bg-card py-3 transition-colors hover:border-brand-200"
                  style={{ width: 46, height: BOARD_HEIGHT }}
                >
                  <span aria-hidden className="text-ink-muted text-xs">›</span>
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: stage.colour }} />
                  <span
                    className="text-ink-muted whitespace-nowrap text-[11px] font-semibold tabular-nums"
                    style={{ writingMode: 'vertical-rl' }}
                  >
                    {stage.label} · {stageCount.toLocaleString('en-GB')}
                  </span>
                </button>
              );
            }

            return (
              <div key={stage.key} className="flex shrink-0 flex-col" style={{ width: 268, height: BOARD_HEIGHT }}>
                {/* The stage header is its own card above the column, and sits
                    OUTSIDE the scrolling body so it stays put while the column
                    scrolls. It used to be `position: sticky` against the page,
                    which does nothing once the column is the thing scrolling. */}
                <div className="mb-2 shrink-0 rounded-panel border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: stage.colour }} />
                      <strong className="truncate text-[13px]" title={stage.label}>{stage.label}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(stage.key)}
                      aria-label={`Collapse ${stage.label}`}
                      aria-expanded
                      className="text-ink-muted shrink-0 rounded px-1 text-xs transition-colors hover:bg-surface-muted hover:text-ink"
                    >
                      ‹
                    </button>
                  </div>
                  <div className="text-ink-muted mt-0.5 flex items-baseline gap-2 text-[11px] tabular-nums">
                    <span>{stageCount.toLocaleString('en-GB')} {stageCount === 1 ? 'lead' : 'leads'}</span>
                    <span>{money(stageValue)}</span>
                    {/* Say what the money covers, per column as well as
                        overall. A stage of 753 leads showing £78,487 with no
                        qualifier reads as the worth of all 753, when 684 carry
                        no value at all. */}
                    {agg && agg.valued_count > 0 && agg.valued_count < agg.lead_count && (
                      <span className="text-[10px]">on {agg.valued_count.toLocaleString('en-GB')}</span>
                    )}
                  </div>
                </div>

                <div className="crm-col-scroll flex-1 overflow-y-auto pr-0.5" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                  {isLoading ? (
                    <>
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-[104px] animate-pulse rounded-panel border border-border bg-card" />
                      ))}
                    </>
                  ) : stageLeads.length === 0 ? (
                    <div className="text-ink-muted rounded-panel border border-dashed border-border py-6 text-center text-[11px]">
                      No leads in this stage
                    </div>
                  ) : (
                    stageLeads.map((l) => (
                      // A card is a button: clicking it opens the lead. It used
                      // to look interactive and do nothing.
                      <div
                        key={l.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${displayName(l)}`}
                        onClick={() => setOpenLead(l)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenLead(l); }
                        }}
                        className="cursor-pointer rounded-panel border border-border bg-card px-3 py-2.5 transition-all duration-150 hover:border-brand-200 hover:shadow-panel-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          {/* THE NAME ONLY.
                              GoHighLevel's own board titles each card with the
                              opportunity name, which on this data reads
                              "Ganesh Bdr Girung || ganeshdil88@…" — a patient's
                              name and email address, on screen, in a column.
                              That string is `leads.treatment`, and 3,201 of
                              this group's leads carry contact details in it.
                              The card shows the contact's name: the same
                              person, without republishing their email. */}
                          <strong className="min-w-0 flex-1 truncate text-[13px]" title={displayName(l)}>
                            {displayName(l)}
                          </strong>
                          <span
                            aria-hidden
                            className="text-ink-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg text-[10px] font-bold"
                          >
                            {initialsOf(displayName(l))}
                          </span>
                        </div>

                        <dl className="mt-2 space-y-1 text-[11px]">
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-ink-muted">Source</dt>
                            <dd className="truncate font-medium">{l.source || DASH}</dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-ink-muted">Value</dt>
                            {/* money() renders null as an em dash. Most leads
                                carry no estimated value, and "£0.00" — which is
                                what GoHighLevel's own board shows on every card
                                in the screenshot — states a figure nobody
                                recorded. */}
                            <dd className="font-semibold tabular-nums" style={{ color: CRM_TEAL }}>
                              {money(l.estimated_value_pence || null)}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-1.5 text-[10px]">
                          <span className="text-ink-muted">{agoLabel(minutesSince(l.created_at))}</span>
                          {l.sync_status === 'synced' ? (
                            <span className="rounded px-1.5 py-px font-semibold" style={{ color: '#047857', background: '#ecfdf5' }}>GHL</span>
                          ) : (
                            <span className="text-ink-muted rounded bg-bg px-1.5 py-px font-semibold">Manual</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}

                  {/* The count in the header is the whole column; these cards
                      are a page of it. Saying so is the difference between a
                      bounded list and a wrong one. */}
                  {hidden > 0 && (
                    <div className="text-ink-muted border-t border-dashed border-border py-2 text-center text-[10px]">
                      {stageLeads.length.toLocaleString('en-GB')} of {stageCount.toLocaleString('en-GB')} shown
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {openLead && <LeadDetailModal lead={openLead} onClose={() => setOpenLead(null)} />}
    </div>
  );
}
