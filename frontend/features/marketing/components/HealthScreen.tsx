'use client';
// What this section can and cannot measure.
//
// Every blank and every "—" on the other four screens has a reason, and until
// now that reason lived only in someone's head. This page states each one, with
// the number attached, so a figure that looks wrong can be checked rather than
// argued about — and so a mapping gap gets fixed instead of being read as a
// bad month.
import Link from 'next/link';
import { PageHeader, EmptyState, SkeletonKpiRow } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { usePractices } from '@/features/practices/hooks';
import { useMarketingPerformance } from '../hooks';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type Channel } from '../api';

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

function Check({
  ok, title, detail, action,
}: {
  ok: boolean; title: string; detail: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-panel border border-border bg-surface p-4">
      {/* The dot is a summary, never the message: the title states the finding
          in words, so nothing here depends on colour alone. */}
      <span
        className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-brand' : 'bg-warning'}`}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{detail}</p>
        {action ? <div className="mt-2 text-[13px]">{action}</div> : null}
      </div>
    </div>
  );
}

function Bar({ rows, total }: { rows: Array<[Channel, number]>; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[4px]">
      {rows.map(([c, v]) => (v > 0 ? (
        <span
          key={c}
          className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
          style={{ width: `${(v / total) * 100}%`, background: CHANNEL_COLOUR[c] }}
          title={`${CHANNEL_LABEL[c]}: ${v.toLocaleString('en-GB')}`}
        />
      ) : null))}
    </div>
  );
}

export default function HealthScreen() {
  const { data, isLoading, isError, error } = useMarketingPerformance();
  const { data: practiceData } = usePractices();

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Attribution health" />
        <EmptyState message={`Couldn't load: ${(error as Error)?.message ?? 'unknown error'}`} />
      </div>
    );
  }

  const t = data?.totals;
  const cov = data?.coverage;
  const practices = practiceData?.practices ?? [];
  const mappedPractices = new Set(
    (data?.byPractice ?? []).filter((p) => p.spendPence > 0).map((p) => p.practiceId),
  );
  const practicesWithoutSpend = practices.filter((p) => !mappedPractices.has(p.id));
  const channelRows = (data?.byChannel ?? []).map((c) => [c.channel, c.leads] as [Channel, number]);
  const noPracticeLeads = (data?.byPractice ?? []).find((p) => p.practiceId === null)?.leads ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Attribution health"
        subtitle="What this section can measure, what it cannot, and why — every blank on the other pages explained."
      />
      <ScopePeriodBar />

      {isLoading || !t || !cov ? (
        <SkeletonKpiRow count={4} />
      ) : (
        <>
          <div className="rounded-panel border border-border bg-surface p-4">
            <div className="mb-1 text-[14px] font-medium text-ink">Where this period&apos;s leads came from</div>
            <p className="mb-3 text-[13px] text-ink-muted">
              {t.attributedLeads.toLocaleString('en-GB')}
              {' of '}
              {t.leads.toLocaleString('en-GB')}
              {' leads ('}
              {pct(t.attributedLeads, t.leads)}
              %) are matched to a campaign we hold spend for. Those are the only ones a
              cost can be measured against.
            </p>
            <Bar rows={channelRows} total={channelRows.reduce((n, [, v]) => n + v, 0)} />
            <div className="mt-2 flex flex-wrap gap-4 text-[12.5px] text-ink-muted">
              {channelRows.map(([c, v]) => (
                <span key={c} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CHANNEL_COLOUR[c] }} />
                  {CHANNEL_LABEL[c]}
                  {': '}
                  {v.toLocaleString('en-GB')}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Check
              ok={cov.unmappedAccounts === 0}
              title={cov.unmappedAccounts === 0
                ? 'Every advertising account is mapped to a practice'
                : `${cov.unmappedAccounts} advertising ${cov.unmappedAccounts === 1 ? 'account is' : 'accounts are'} not mapped to a practice`}
              detail={cov.unmappedAccounts === 0
                ? `All ${cov.totalAccounts} connected accounts belong to a practice, so every pound of spend can be attributed to one.`
                : (
                  <>
                    {cov.unmappedSpendPence > 0
                      ? `${formatPence(cov.unmappedSpendPence)} of this period's spend sits on them. `
                      : 'They had no spend in this period. '}
                    Their spend counts in the group total but appears under no practice, so the
                    practices cannot sum to the group.
                    {cov.unmappedAccountNames.length > 0 ? ` (${cov.unmappedAccountNames.slice(0, 4).join(', ')}${cov.unmappedAccountNames.length > 4 ? ', …' : ''})` : ''}
                  </>
                )}
              action={cov.unmappedAccounts > 0 ? (
                <Link href="/integrations" className="font-medium text-brand hover:underline">
                  Map them in Integrations
                </Link>
              ) : null}
            />

            <Check
              ok={practicesWithoutSpend.length === 0}
              title={practicesWithoutSpend.length === 0
                ? 'Every practice has advertising spend'
                : `${practicesWithoutSpend.length} ${practicesWithoutSpend.length === 1 ? 'practice has' : 'practices have'} no spend this period`}
              detail={practicesWithoutSpend.length === 0
                ? 'Each practice has an account spending against it, so its cost per lead is real.'
                : (
                  <>
                    {practicesWithoutSpend.map((p) => p.name).join(', ')}
                    {' — either no advertising account is mapped to them, or their account spent '}
                    nothing in this window. Their cost figures are blank rather than £0.00,
                    because we cannot tell you what a lead cost there.
                  </>
                )}
            />

            <Check
              ok={t.unattributedLeads === 0}
              title={`${t.unattributedLeads.toLocaleString('en-GB')} leads carry no ad tracking`}
              detail={(
                <>
                  These are organic social, referrals, direct enquiries and people whose
                  GoHighLevel record has no attribution. They are real enquiries and are
                  counted in the lead total, but no advertising can claim them — so they
                  are excluded from cost per lead rather than making it look cheaper.
                </>
              )}
            />

            <Check
              ok={noPracticeLeads === 0}
              title={noPracticeLeads === 0
                ? 'Every lead is assigned to a practice'
                : `${noPracticeLeads.toLocaleString('en-GB')} leads are not assigned to a practice`}
              detail={noPracticeLeads === 0
                ? 'Every enquiry carries the practice it came to, so the per-practice figures account for all of them.'
                : (
                  <>
                    They come from a GoHighLevel subaccount with no practice mapping. They
                    appear in the group total but in no practice, which is why the practice
                    rows sum to less than the group.
                  </>
                )}
              action={noPracticeLeads > 0 ? (
                <Link href="/integrations" className="font-medium text-brand hover:underline">
                  Map the subaccount in Integrations
                </Link>
              ) : null}
            />
          </div>

          <div className="rounded-panel border border-border bg-surface p-4">
            <div className="mb-1 text-[14px] font-medium text-ink">How a patient is counted</div>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              A lead becomes a patient when their email or phone matches a Dentally record.
              Of this period&apos;s
              {' '}
              {t.patients.toLocaleString('en-GB')}
              {' matches, '}
              <span className="font-medium text-ink">{t.newPatients.toLocaleString('en-GB')}</span>
              {' had no appointment before this period began — those are the new patients. '}
              The other
              {' '}
              {(t.patients - t.newPatients).toLocaleString('en-GB')}
              {' '}
              were already patients enquiring again. Cost per new patient uses the first
              group only; counting all of them as acquisition would overstate what the
              advertising bought.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
