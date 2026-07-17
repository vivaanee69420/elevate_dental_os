'use client';
// LeadComparison — Google vs Facebook leads/conversions, matched to
// Emergent-accepted treatments by phone/email/name.
//
// Two rules this section exists to keep honest, both learned the hard way:
//
//  1. Scope coherence. The headline cards follow the selected practice; the
//     group figure is shown BESIDE it as context, never in place of it.
//  2. Leads are PEOPLE. One contact sitting in two pipelines of the same
//     channel is one lead, not two — `entries` carries the raw pipeline-row
//     count when the two differ.
//
// Ad spend / CPL / ROI stay group-level: ad_metrics carries no practice, so a
// per-practice spend figure would be a guess (that's Phase C — the per-practice
// spend columns the mockup shows are not built yet).
import { Fragment, useState } from 'react';
import { formatPence, formatNumber } from '@/lib/format';
import { useCockpitLeads } from '../hooks';
import { PipelineTag } from './PipelineTag';
import { LeadsTable, dedupeByPerson, CHANNEL_ORDER, type LeadRow } from './LeadsTable';
import { SectionCard, SecHead, cx, cockpitStyles as s } from './cockpit-ui';
import type { LeadRoi, LeadChannel, LeadRoiGroupStats } from '../api';

function rate(n: number, d: number): string {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(1)}%`;
}

const CHANNELS: Array<{ key: 'google' | 'facebook'; label: string }> = [
  { key: 'google', label: 'Google' },
  { key: 'facebook', label: 'Facebook' },
];

// The leads list — fetched only once "View leads" is opened. Fetched WITHOUT a
// channel param (up to 500 rows) and grouped/filtered by channel CLIENT-SIDE:
// the backend's channel filter runs after classification, so it can short a page.
function LeadsList({ practiceId, win }: { practiceId?: string; win: { since: string; until: string } }) {
  const { data, isLoading, isError } = useCockpitLeads(true, {
    since: win.since,
    until: win.until,
    practiceId,
    limit: 500,
  });

  if (isLoading) return <p className={s.subtle} style={{ fontSize: 13 }}>Loading leads…</p>;
  if (isError) return <p className={s.danger} style={{ fontSize: 13 }}>Couldn&rsquo;t load leads.</p>;
  const lines = data?.lines ?? [];
  if (lines.length === 0) return <p className={s.subtle} style={{ fontSize: 13 }}>No leads in this window.</p>;

  const byChannel = new Map<LeadChannel, LeadRow[]>();
  for (const l of dedupeByPerson(lines)) {
    if (!byChannel.has(l.channel)) byChannel.set(l.channel, []);
    byChannel.get(l.channel)!.push(l);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {CHANNEL_ORDER.filter((ch) => byChannel.has(ch)).map((ch) => {
        const rows = byChannel.get(ch)!;
        const converted = rows.filter((r) => r.converted).length;
        return (
          <div key={ch}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <PipelineTag channel={ch} />
              <span className={s.subtle} style={{ fontSize: 12 }}>
                {formatNumber(rows.length)} lead{rows.length === 1 ? '' : 's'} · {formatNumber(converted)} accepted a treatment
              </span>
            </div>
            <LeadsTable rows={rows} />
          </div>
        );
      })}
      {lines.length === (data?.limit ?? 0) && (
        <p className={s.footNote}>Showing the first {data?.limit} leads — narrow the period or practice to see fewer at once.</p>
      )}
    </div>
  );
}

// One channel's headline block, rendered as a mint tile.
function ChannelCard({
  label,
  stats,
  groupStats,
  spendPence,
  cplPence,
  roi,
  scopedName,
}: {
  label: string;
  stats: LeadRoiGroupStats;
  groupStats: LeadRoiGroupStats;
  spendPence: number;
  cplPence: number | null;
  roi: number | null;
  scopedName: string | null;
}) {
  const cpl = cplPence == null || spendPence === 0 ? '—' : formatPence(cplPence);
  const roiText = roi == null ? '—' : `${roi.toFixed(1)}×`;

  return (
    <div className={s.kpi}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <div className={s.lbl}>
          {label} — {scopedName ?? 'all practices'}
        </div>
        <PipelineTag channel={label.toLowerCase() as LeadChannel} />
      </div>

      <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className={s.val}>{formatNumber(stats.leads)}</span>
        <span className={s.subtle} style={{ fontSize: 13 }}>leads</span>
      </div>
      {stats.entries > stats.leads ? (
        <div className={s.subtle} style={{ fontSize: 11 }}>
          {formatNumber(stats.entries)} pipeline entries — {formatNumber(stats.entries - stats.leads)} are the same person in more than one pipeline
        </div>
      ) : null}

      <dl style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', fontSize: 13 }}>
        <dt className={s.subtle}>Accepted a treatment</dt>
        <dd className={cx(s.r, s.money)}>
          {formatNumber(stats.conversions)} <span className={s.subtle}>({rate(stats.conversions, stats.leads)})</span>
        </dd>
        <dt className={s.subtle}>Value accepted</dt>
        <dd className={cx(s.r, s.money)}>{formatPence(stats.matchedValuePence)}</dd>
      </dl>

      {scopedName ? (
        <p className={s.subtle} style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8, fontSize: 12 }}>
          Group (all practices): {formatNumber(groupStats.leads)} leads · {formatNumber(groupStats.conversions)} accepted
        </p>
      ) : null}

      <dl style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', borderTop: '1px solid var(--line)', paddingTop: 8, fontSize: 13 }}>
        <dt className={s.subtle}>Ad spend (group)</dt>
        <dd className={cx(s.r, s.money)}>{spendPence === 0 ? '—' : formatPence(spendPence)}</dd>
        <dt className={s.subtle}>Cost per lead (group)</dt>
        <dd className={cx(s.r, s.money)}>{cpl}</dd>
        <dt className={s.subtle}>Return on ad spend (group)</dt>
        <dd className={cx(s.r, s.money)}>{roiText}</dd>
      </dl>
    </div>
  );
}

export function LeadComparison({
  data,
  practiceId,
  practiceName,
  win,
}: {
  data: LeadRoi;
  practiceId?: string;
  practiceName?: string | null;
  win: { since: string; until: string };
}) {
  const [showLeads, setShowLeads] = useState(false);

  const scopedName = practiceId ? practiceName ?? 'selected practice' : null;
  const stats = data.scoped ?? data.group;

  const rowsByPractice = new Map<
    string,
    { practiceId: string | null; practiceName: string | null; byChannel: Map<string, LeadRoi['channels'][number]> }
  >();
  for (const c of data.channels) {
    if (c.channel !== 'google' && c.channel !== 'facebook') continue;
    const key = c.practiceId ?? '__unmapped__';
    if (!rowsByPractice.has(key)) {
      rowsByPractice.set(key, { practiceId: c.practiceId, practiceName: c.practiceName, byChannel: new Map() });
    }
    rowsByPractice.get(key)!.byChannel.set(c.channel, c);
  }
  const practiceRows = Array.from(rowsByPractice.values()).sort((a, b) =>
    (a.practiceName ?? '').localeCompare(b.practiceName ?? ''),
  );

  return (
    <SectionCard>
      <SecHead
        n={3}
        title="Leads — Google vs Facebook, by practice"
        desc="Every person who came in through a Google or Facebook ad pipeline in GoHighLevel, and whether they went on to accept a treatment in Emergent. A lead is a person — someone in two pipelines is counted once. Leads usually accept weeks after they arrive, so a recent window shows few conversions even when the ads are working."
        src={{ label: 'GHL + ad-account mapping' }}
      />

      {data.unmapped.leads > 0 && (
        <div
          style={{
            marginBottom: 12,
            border: '1px solid #e8dca8',
            background: 'var(--amberbg)',
            color: 'var(--amber)',
            borderRadius: 8,
            padding: 12,
            fontSize: 13,
          }}
        >
          <strong>{formatNumber(data.unmapped.leads)} leads are not counted</strong> — they belong to GoHighLevel
          subaccounts that aren&rsquo;t linked to a practice ({data.unmapped.accounts.map((a) => a.label).join(', ')}).
          If any of those is a practice, link it under System &gt; Integrations and its leads will start counting here.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" style={{ marginBottom: 16 }}>
        {CHANNELS.map((ch) => (
          <ChannelCard
            key={ch.key}
            label={ch.label}
            stats={stats[ch.key]}
            groupStats={data.group[ch.key]}
            spendPence={data.groupChannels[ch.key].spendPence}
            cplPence={data.groupChannels[ch.key].cplPence}
            roi={data.groupChannels[ch.key].roi}
            scopedName={scopedName}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <span className={s.subtle} style={{ fontSize: 13 }}>
          See every individual lead — name, pipeline it came in on, and whether it converted.
        </span>
        <button type="button" className={s.btn} onClick={() => setShowLeads((o) => !o)} style={{ whiteSpace: 'nowrap' }}>
          {showLeads ? 'Hide leads' : 'View leads →'}
        </button>
      </div>
      {showLeads && (
        <div style={{ marginBottom: 16, border: '1px solid var(--line)', background: 'var(--tint2)', borderRadius: 8, padding: 12 }}>
          <LeadsList practiceId={practiceId} win={win} />
        </div>
      )}

      <div className={s.scrollX}>
        <table className={s.table} style={{ minWidth: 640 }}>
          <caption style={{ paddingBottom: 8, textAlign: 'left', fontSize: 12, color: 'var(--muted)' }}>
            {practiceId ? 'The selected practice.' : 'Every practice with a linked GoHighLevel subaccount.'}
          </caption>
          <thead>
            <tr>
              <th>Practice</th>
              <th>Channel</th>
              <th className={s.r}>Leads</th>
              <th className={s.r}>Accepted</th>
              <th className={s.r}>Conv %</th>
              <th className={s.r}>Value accepted</th>
            </tr>
          </thead>
          <tbody>
            {practiceRows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--muted)' }}>
                  No Google or Facebook pipeline leads in this window.
                </td>
              </tr>
            ) : (
              practiceRows.map((p) => (
                <Fragment key={p.practiceId ?? 'unmapped'}>
                  {CHANNELS.map((ch, i) => {
                    const c = p.byChannel.get(ch.key);
                    return (
                      <tr key={`${p.practiceId ?? 'unmapped'}-${ch.key}`}>
                        {i === 0 ? (
                          <td style={{ fontWeight: 600 }} rowSpan={CHANNELS.length}>
                            {p.practiceName ?? 'Unmapped practice'}
                          </td>
                        ) : null}
                        <td className={s.subtle}>{ch.label}</td>
                        <td className={cx(s.r, s.money)}>{formatNumber(c?.leads ?? 0)}</td>
                        <td className={cx(s.r, s.money)}>{formatNumber(c?.conversions ?? 0)}</td>
                        <td className={cx(s.r, s.money)}>{rate(c?.conversions ?? 0, c?.leads ?? 0)}</td>
                        <td className={cx(s.r, s.money)}>{formatPence(c?.matchedValuePence ?? 0)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))
            )}
          </tbody>
          <tfoot>
            {CHANNELS.map((ch) => {
              const g = data.group[ch.key];
              return (
                <tr key={`total-${ch.key}`} className={s.totalRow}>
                  <td>Group total</td>
                  <td>{ch.label}</td>
                  <td className={cx(s.r, s.money)}>{formatNumber(g.leads)}</td>
                  <td className={cx(s.r, s.money)}>{formatNumber(g.conversions)}</td>
                  <td className={cx(s.r, s.money)}>{rate(g.conversions, g.leads)}</td>
                  <td className={cx(s.r, s.money)}>{formatPence(g.matchedValuePence)}</td>
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>

      <p className={s.footNote}>
        Ad spend, cost per lead and return on ad spend are group-level only — the ad platforms don&rsquo;t tell us which
        practice a pound of spend went to (one ad account can serve several practices), so a per-practice figure would be
        a guess. Facebook spend shows as &mdash; when the Meta account needs reconnecting under System &gt; Integrations.
      </p>
    </SectionCard>
  );
}
