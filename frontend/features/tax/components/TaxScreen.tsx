'use client';
// ============================================================================
// Tax — VAT and Corporation Tax from this organisation's own figures.
//
// Replaces a page that was entirely static: every £0 was a literal and the
// self-assessment estimate was `const SA_ESTIMATE = 35000`.
//
// PER SUB-ACCOUNT. Entity type, VAT registration and the treatment mapping all
// belong to the organisation you are signed into, so switching sub-account
// changes every figure here. Nothing falls back to a parent.
//
// AN UNKNOWN IS A STATE, NEVER A ZERO. If the entity type is unset the page
// says so instead of quoting Corporation Tax at 19% on a guess; a sole trader
// is told plainly that it pays Income Tax and Class 4 NIC instead; unmapped
// revenue is shown as its own figure and never folded into exempt.
// ============================================================================
import { useMemo, useState } from 'react';
import { PageHeader, Card } from '@/components/ui';
import { useTaxOverview, useTaxTreatments, useSaveTaxSettings, useSetTreatmentLiability } from '../hooks';
import type { EntityType, Liability, TreatmentRow } from '../api';

const gbp = (pence?: number | null) =>
  pence === null || pence === undefined
    ? '—'
    : `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const gbp2 = (pence?: number | null) =>
  pence === null || pence === undefined
    ? '—'
    : `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (ymd?: string | null) =>
  ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const ENTITY_LABEL: Record<EntityType, string> = {
  limited_company: 'Limited company',
  sole_trader: 'Sole trader',
  partnership: 'Partnership',
  llp: 'LLP',
};

const BAND_LABEL: Record<string, string> = {
  none: 'No taxable profit',
  small: 'Small profits rate',
  marginal: 'Marginal relief',
  main: 'Main rate',
};

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  return (
    <Card>
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">{label}</p>
      <p className={`display mt-1 text-[26px] font-bold leading-none ${tone === 'warn' ? 'text-danger' : tone === 'good' ? 'text-brand' : ''}`}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[12px] text-ink-muted">{sub}</p>}
    </Card>
  );
}

/** One row of the VAT split, so the buckets read as a statement that adds up. */
function SplitRow({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0 ${strong ? 'font-semibold' : ''}`}>
      <span className="text-[13px]">
        {label}
        {hint && <span className="ml-2 text-[11.5px] text-ink-muted">{hint}</span>}
      </span>
      <span className="text-[13px] tabular-nums">{value}</span>
    </div>
  );
}

export default function TaxScreen() {
  const overview = useTaxOverview();
  const treatments = useTaxTreatments();
  const saveSettings = useSaveTaxSettings();
  const setLiability = useSetTreatmentLiability();
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = treatments.data?.treatments ?? [];
    const matched = q ? all.filter((t) => t.description.toLowerCase().includes(q)) : all;
    // Default to the top 50: they carry ~81% of revenue for the largest org
    // here, so the list is useful in twenty minutes rather than 730 decisions.
    return showAll || q ? matched : matched.slice(0, 50);
  }, [treatments.data, filter, showAll]);

  if (overview.isLoading) return <p className="p-6 text-ink-muted">Loading tax position…</p>;
  if (overview.isError) {
    return <p className="p-6 text-danger">Could not load the tax position: {(overview.error as Error)?.message}</p>;
  }

  const d = overview.data;
  const s = d?.settings ?? null;
  const vat = d?.vat ?? null;
  const ct = d?.corporationTax ?? null;

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Tax"
        subtitle="VAT and Corporation Tax estimated from your own figures. Not a filing — and not a substitute for your accountant."
      />

      {/* ── settings: the answers everything else depends on ─────────────── */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium">Entity type</span>
            <select
              className="rounded-lg border border-border px-2 py-1.5 text-[13px]"
              value={s?.entity_type ?? ''}
              onChange={(e) => saveSettings.mutate({ entity_type: (e.target.value || null) as EntityType | null })}
            >
              <option value="">Not set</option>
              {Object.entries(ENTITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium">Year end</span>
            <div className="flex gap-1">
              <input
                type="number" min={1} max={31} placeholder="DD"
                className="w-16 rounded-lg border border-border px-2 py-1.5 text-[13px]"
                defaultValue={s?.year_end_day ?? ''}
                onBlur={(e) => saveSettings.mutate({ year_end_day: e.target.value ? Number(e.target.value) : null })}
              />
              <input
                type="number" min={1} max={12} placeholder="MM"
                className="w-16 rounded-lg border border-border px-2 py-1.5 text-[13px]"
                defaultValue={s?.year_end_month ?? ''}
                onBlur={(e) => saveSettings.mutate({ year_end_month: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          </label>

          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={Boolean(s?.vat_registered)}
              onChange={(e) => saveSettings.mutate({ vat_registered: e.target.checked })}
            />
            VAT registered
          </label>

          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={s?.prices_include_vat !== false}
              onChange={(e) => saveSettings.mutate({ prices_include_vat: e.target.checked })}
            />
            Prices include VAT
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium" title="CT limits are divided by this">Associated companies</span>
            <input
              type="number" min={1}
              className="w-20 rounded-lg border border-border px-2 py-1.5 text-[13px]"
              defaultValue={s?.associated_companies ?? 1}
              onBlur={(e) => saveSettings.mutate({ associated_companies: Number(e.target.value) || 1 })}
            />
          </label>
        </div>
        {saveSettings.isError && (
          <p className="mt-2 text-[12px] text-danger">
            Could not save that — only an owner can change tax settings.
          </p>
        )}
      </Card>

      {d?.state === 'not_configured' && (
        <Card className="mb-4">
          <p className="text-[13px]">
            Set your entity type and year end above to see figures. Nothing is estimated until then —
            a limited company pays Corporation Tax and a sole trader pays Income Tax with Class 4 NIC,
            and guessing which would be quoting the wrong tax entirely.
          </p>
        </Card>
      )}

      {/* ── the headline figures ─────────────────────────────────────────── */}
      {d?.state === 'ok' && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat
            label="VAT on standard-rated"
            value={vat && s?.vat_registered ? gbp(vat.outputVatPence) : '—'}
            sub={
              !s?.vat_registered
                ? 'Not VAT registered'
                : `${vat?.pricesIncludeVat ? 'Extracted from' : 'Added to'} ${gbp(vat?.standardPence)} of supplies`
            }
          />
          <Stat
            label={ct?.state === 'ok' ? BAND_LABEL[ct.band ?? ''] ?? 'Corporation Tax' : 'Corporation Tax'}
            value={ct?.state === 'ok' ? gbp(ct.taxPence) : '—'}
            sub={
              ct?.state === 'ok'
                ? `on ${gbp(ct.profitPence)} profit · ${ct.effectiveRatePct ?? '—'}% effective`
                : ct?.reason ?? 'Not available yet'
            }
          />
          <Stat
            label="Corporation Tax due"
            value={ct?.state === 'ok' ? day(ct.deadlines?.payBy) : '—'}
            sub={ct?.state === 'ok' ? `Return by ${day(ct.deadlines?.fileBy)}` : undefined}
          />
        </div>
      )}

      {/* ── VAT split ────────────────────────────────────────────────────── */}
      {vat?.state === 'ok' && (
        <Card className="mb-4">
          <h3 className="display mb-1 text-[15px] font-bold">VAT split</h3>
          <p className="mb-3 text-[12px] text-ink-muted">
            Rolling 12 months to {day(vat.window?.until)}. Dental care by a registered professional is
            exempt (VATA 1994 Sch 9 Grp 7); cosmetic work is exempt too when it forms part of a course
            of treatment, and standard-rated only when done outside any healthcare.
          </p>
          <SplitRow label="Exempt — dental care" value={gbp2(vat.exemptPence)} />
          <SplitRow label="Standard-rated" value={gbp2(vat.standardPence)} />
          {vat.outsideScopePence > 0 && <SplitRow label="Outside the scope" value={gbp2(vat.outsideScopePence)} />}
          <SplitRow
            label="Not yet classified"
            value={gbp2(vat.unmappedPence)}
            hint={vat.unmappedPence > 0 ? 'excluded from both buckets' : undefined}
          />
          <SplitRow label="Total revenue" value={gbp2(vat.totalPence)} strong />
          <div className="mt-3 border-t border-border pt-3">
            <SplitRow
              label={`Taxable turnover vs £${(vat.registration.registrationThresholdPence / 100).toLocaleString('en-GB')} threshold`}
              value={gbp2(vat.registration.taxableTurnover12mPence)}
              hint={
                vat.registration.indeterminate ? 'cannot be answered until the rest is classified'
                  : vat.registration.overThreshold ? 'over the threshold'
                  : 'under the threshold'
              }
            />
          </div>
        </Card>
      )}

      {/* ── the mapping, richest first ───────────────────────────────────── */}
      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="display text-[15px] font-bold">VAT liability by treatment</h3>
            <p className="text-[12px] text-ink-muted">
              Nothing is guessed from the name — HMRC requires each case on its own facts. Richest
              first, so the figures become meaningful long before the list ends.
            </p>
          </div>
          {treatments.data && (
            <span className="text-[12px] text-ink-muted">
              {treatments.data.coveragePct ?? 0}% of revenue classified
            </span>
          )}
        </div>
        <input
          className="mb-2 w-full rounded-lg border border-border px-3 py-1.5 text-[13px]"
          placeholder="Search treatments"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-[26rem] overflow-y-auto">
          {rows.map((t: TreatmentRow) => (
            <div key={t.description} className="flex items-center gap-3 border-b border-border py-1.5 text-[13px] last:border-0">
              <span className="min-w-0 flex-1 truncate">{t.description || '(no name)'}</span>
              <span className="whitespace-nowrap tabular-nums text-ink-muted">{gbp(t.amountPence)}</span>
              <span className="inline-flex overflow-hidden rounded border border-slate-300">
                {([['exempt', 'Exempt'], ['standard', 'Standard'], [null, 'Unset']] as const).map(([v, l]) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLiability.mutate({ description: t.description, liability: v as Liability | null })}
                    className={`px-2 py-1 text-[12px] ${
                      (t.liability ?? null) === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </span>
            </div>
          ))}
          {rows.length === 0 && <p className="py-3 text-[13px] text-ink-muted">No treatments match that search.</p>}
        </div>
        {!showAll && !filter && (treatments.data?.treatments.length ?? 0) > 50 && (
          <button type="button" className="mt-2 text-[12.5px] text-brand underline" onClick={() => setShowAll(true)}>
            Show all {treatments.data?.treatments.length} treatments
          </button>
        )}
      </Card>

      {/* ── every caveat, stated rather than buried ──────────────────────── */}
      {(d?.caveats?.length ?? 0) > 0 && (
        <Card>
          <h3 className="display mb-2 text-[15px] font-bold">What these figures do and do not include</h3>
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-muted">
            {d!.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
          {(vat?.ratesSource || ct?.ratesSource) && (
            <p className="mt-3 text-[11.5px] text-ink-muted">
              Rates: {ct?.financialYear && `Corporation Tax ${ct.financialYear}`}
              {ct?.financialYear && vat?.taxYear && ' · '}
              {vat?.taxYear && `VAT ${vat.taxYear}`}. Sourced from HMRC.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
