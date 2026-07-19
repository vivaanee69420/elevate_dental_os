'use client';
// Same metrics as the scorecard, per practice. A practice with no mapped ad
// account shows spend and cost per lead as "Not reporting" rather than £0 —
// the same rule the rest of the product follows for a practice with no feed.
//
// Each practice's deduped `total` row is rendered alongside its three channel
// rows so nobody is tempted to sum the channel columns — a person who
// enquired through both a Google-tagged and a Facebook-tagged pipeline counts
// once under EACH channel (correct for comparison), so summing inflates leads
// and revenue. `total` is the true, non-additive figure.
import { formatPence } from '@/lib/format';
import { SectionCard, SecHead, cx, cockpitStyles as s } from '@/components/ui';
import { money } from '../format';
import { PracticeSparkline } from './PracticeSparkline';
import type { PracticeChannels, PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google',
  meta_ads: 'Facebook',
  unassigned: 'Unassigned',
};

export function ByPracticeTable({ rows }: { rows: PracticeChannels[] }) {
  return (
    <SectionCard>
      <SecHead
        n={4}
        title="By practice"
        desc="The same metrics split by practice, with each practice's deduped total on its own row. The trend column is lead volume month by month."
      />
      <div className={s.scrollX}>
        <table className={s.table} style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>Practice</th>
              <th>Channel</th>
              <th className={s.r}>Leads</th>
              <th className={s.r}>Spend</th>
              <th className={s.r}>Cost per lead</th>
              <th className={s.r}>Conversions</th>
              <th className={s.r}>Accepted value</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((p) => [
              ...p.channels.map((c, i) => (
                <tr key={`${p.practiceId}|${c.channel}`}>
                  <td>{i === 0 ? (p.practiceName ?? '—') : ''}</td>
                  <td>{LABEL[c.channel]}</td>
                  <td className={cx(s.r, s.money)}>{c.leads.toLocaleString('en-GB')}</td>
                  <td className={cx(s.r, s.money)}>{money(c.spendPence)}</td>
                  <td className={cx(s.r, s.money)}>{money(c.costPerLeadPence)}</td>
                  <td className={cx(s.r, s.money)}>{c.conversions.toLocaleString('en-GB')}</td>
                  <td className={cx(s.r, s.money)}>{formatPence(c.acceptedValuePence)}</td>
                  <td></td>
                </tr>
              )),
              <tr key={`${p.practiceId}|total`} className={s.totalRow}>
                <td></td>
                <td>Total (deduped)</td>
                <td className={cx(s.r, s.money)}>{p.total.leads.toLocaleString('en-GB')}</td>
                <td className={cx(s.r, s.money)}>{money(p.total.spendPence)}</td>
                <td className={cx(s.r, s.money)}>{money(p.total.costPerLeadPence)}</td>
                <td className={cx(s.r, s.money)}>{p.total.conversions.toLocaleString('en-GB')}</td>
                <td className={cx(s.r, s.money)}>{formatPence(p.total.acceptedValuePence)}</td>
                <td><PracticeSparkline trend={p.trend} /></td>
              </tr>,
            ])}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className={s.subtle} style={{ fontSize: 13 }}>No practice data in this period.</p>
      ) : null}
      {rows.length > 0 ? (
        <p className={s.footNote}>
          The three channel rows are not additive — a person who enquired through more than one
          channel counts once under each. Use the &quot;Total (deduped)&quot; row for the practice&apos;s
          true lead count.
        </p>
      ) : null}
    </SectionCard>
  );
}
