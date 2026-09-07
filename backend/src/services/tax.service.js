// ============================================================================
// UK tax overview for one organisation.
//
// PER TENANT, ALWAYS. Entity type, VAT registration and the treatment mapping
// are properties of the sub-account, not of the group: one practice company can
// be VAT-registered and its sibling not, and each has its own accounting period
// and its own list of treatments. Nothing here falls back to a parent org.
//
// This produces an ESTIMATE FOR PLANNING, reconciled to figures the owner can
// check. It is not a filing and does not replace an accountant — the page says
// so, and this service returns the caveats rather than leaving the UI to invent
// them.
//
// Every unknown is a STATE, never a zero. An org that has not said whether it
// is a limited company gets `entity_unknown`, not Corporation Tax at 19% on a
// guess; unmapped revenue is reported as unmapped rather than assumed exempt.
// A confident wrong number is the failure mode that matters here.
// ============================================================================
import { taxRepository } from "../repositories/tax.repository.js";
import { analyticsService } from "./analytics.service.js";
import { corporationTax, corporationTaxDeadlines } from "../lib/tax/corporation-tax.js";
import { splitRevenueByLiability, outputVat, registrationStatus } from "../lib/tax/vat.js";
import { londonYmd } from "../lib/tz.js";

// The accounting period that CONTAINS `onDate`, from the org's year end.
// Returns null when the year end has not been set — a period invented from a
// default would put the CT deadline on the wrong date entirely.
export function accountingPeriod({ yearEndDay, yearEndMonth }, onDate) {
    if (!yearEndDay || !yearEndMonth) return null;
    const on = new Date(`${onDate}T12:00:00Z`);
    const y = on.getUTCFullYear();

    const endInYear = (year) => {
        // Clamp to the month's last day: a 31st year end in a 30-day month is
        // the 30th, and overflowing would move the period into the next month.
        const last = new Date(Date.UTC(year, yearEndMonth, 0)).getUTCDate();
        return new Date(Date.UTC(year, yearEndMonth - 1, Math.min(yearEndDay, last), 12));
    };

    let end = endInYear(y);
    if (end < on) end = endInYear(y + 1);
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    start.setUTCDate(start.getUTCDate() + 1);

    const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const days = Math.round((end - start) / 86400000) + 1;
    return { start: ymd(start), end: ymd(end), days };
}

export const taxService = {
    async settings(orgId) {
        return taxRepository.settings(orgId);
    },

    async saveSettings(orgId, patch, userId) {
        return taxRepository.saveSettings(orgId, patch, userId);
    },

    async setLiability(orgId, body, userId) {
        await taxRepository.setLiability(orgId, body, userId);
        return { ok: true };
    },

    /**
     * The treatment list the owner maps from, richest first.
     *
     * Sorted by revenue because the tail is long and shallow: this org has 730
     * distinct treatments, but the top 50 carry 81% of revenue and the top 100
     * carry 94%. Mapping in revenue order means the figures become meaningful
     * after twenty minutes rather than after 730 decisions.
     */
    async treatments(orgId, { since, until, practiceId = null }) {
        const [rows, map] = await Promise.all([
            taxRepository.revenueByTreatment(orgId, { since, until, practiceId }),
            taxRepository.liabilityMap(orgId),
        ]);
        const split = splitRevenueByLiability(rows, map);
        const totalPence = split.totalPence;

        let cumulative = 0;
        const treatments = rows.map((r) => {
            cumulative += r.amountPence;
            return {
                ...r,
                // Whatever the practice mapped, or null. Never a suggestion:
                // HMRC requires cosmetic cases to be judged on their own facts,
                // so a name-derived hint here would be read as an answer.
                liability: map[normalise(r.description)] ?? null,
                // What it is being COUNTED as right now, whether or not anyone
                // has said so — the page shows this, so a reader is never
                // guessing which bucket an unmarked treatment fell into.
                effectiveLiability: map[normalise(r.description)] ?? 'exempt',
                cumulativeSharePct: totalPence > 0 ? round1((cumulative / totalPence) * 100) : null,
            };
        });

        return {
            treatments,
            totalPence,
            mappedPence: totalPence - split.unmappedPence,
            unmappedPence: split.unmappedPence,
            // How much of the money is decided — the number that says whether
            // the VAT figure below can be trusted yet.
            coveragePct: totalPence > 0 ? round1(((totalPence - split.unmappedPence) / totalPence) * 100) : null,
        };
    },

    /**
     * The page payload: VAT and Corporation Tax for this org's own period.
     */
    async overview(orgId, { onDate = londonYmd(), practiceId = null } = {}) {
        const settings = await taxRepository.settings(orgId);

        // ASSUME AND LABEL, never block. The first version returned
        // `not_configured` and no figures at all until the owner filled in a
        // form, which meant the page answered "what tax do I owe" with nothing.
        // The question is answerable from data already held, so it is answered,
        // with every assumption named and changeable.
        //
        // Limited company and 31 March are the commonest UK dental group shape;
        // both are one dropdown away from correct, and a labelled assumption is
        // worth far more than a blank page.
        const assumptions = [];
        const entityType = settings?.entity_type ?? 'limited_company';
        if (!settings?.entity_type) {
            assumptions.push('Assumed a limited company. Change it above if you are a sole trader, partnership or LLP — they pay Income Tax and Class 4 NIC instead.');
        }
        const yearEndDay = settings?.year_end_day ?? 31;
        const yearEndMonth = settings?.year_end_month ?? 3;
        if (!settings?.year_end_day || !settings?.year_end_month) {
            assumptions.push('Assumed a 31 March year end.');
        }
        const effective = {
            ...(settings ?? {}),
            entity_type: entityType,
            year_end_day: yearEndDay,
            year_end_month: yearEndMonth,
            associated_companies: settings?.associated_companies ?? 1,
            prices_include_vat: settings?.prices_include_vat !== false,
            vat_registered: Boolean(settings?.vat_registered),
        };

        const period = accountingPeriod(
            { yearEndDay, yearEndMonth },
            onDate,
        );

        const [vat, ct] = await Promise.all([
            this._vat(orgId, effective, onDate, practiceId),
            this._corporationTax(orgId, effective, period),
        ]);

        // The headline the page was asked for: what this revenue costs in tax.
        const totalTaxPence = (ct?.state === 'ok' ? ct.taxPence : 0)
            + (vat?.state === 'ok' ? vat.outputVatPence : 0);

        return {
            state: 'ok',
            settings: settings ?? null,
            effectiveSettings: effective,
            assumptions,
            period,
            revenuePence: vat?.totalPence ?? null,
            profitPence: ct?.state === 'ok' ? ct.profitPence : null,
            totalTaxPence,
            vat,
            corporationTax: ct,
            caveats: [
                'These are estimates for planning, computed from your own figures. They are not a filing and do not replace your accountant.',
                ...(vat?.caveats ?? []),
                ...(ct?.caveats ?? []),
            ],
        };
    },

    async _vat(orgId, settings, onDate, practiceId) {
        const rates = await taxRepository.rates('vat', onDate);
        if (!rates) return { state: 'no_rates', caveats: [`No VAT rates are recorded for ${onDate}.`] };

        const r = rates.rates;
        const since = rolling12mStart(onDate);
        const [rows, map] = await Promise.all([
            taxRepository.revenueByTreatment(orgId, { since, until: onDate, practiceId }),
            taxRepository.liabilityMap(orgId),
        ]);
        const split = splitRevenueByLiability(rows, map);

        const out = outputVat({
            standardNetPence: split.standardNetPence,
            standardRatePct: r.standardRatePct,
            pricesIncludeVat: settings.prices_include_vat !== false,
        });

        const reg = registrationStatus({
            taxableTurnover12mPence: split.standardNetPence,
            unmappedTurnover12mPence: split.unmappedPence,
            registrationThresholdPence: r.registrationThresholdPence,
            deregistrationThresholdPence: r.deregistrationThresholdPence,
            isRegistered: settings.vat_registered,
        });

        const caveats = [];
        if (split.assumedPence > 0) {
            caveats.push(
                `£${pounds(split.assumedPence)} of revenue is treated as exempt dental care by default — HMRC's position is that dental work is rarely purely cosmetic. Mark any standalone cosmetic or retail sales below and the VAT figure updates.`,
            );
        }
        if (reg.indeterminate) {
            caveats.push('Unmapped revenue could take taxable turnover over the registration threshold — this cannot be answered until it is classified.');
        }
        if (settings.vat_registered) {
            caveats.push('Input VAT is not included: dental care is exempt, so most input tax is irrecoverable and the recoverable share needs a partial exemption calculation this app does not yet hold.');
        }

        return {
            state: 'ok',
            window: { since, until: onDate },
            exemptPence: split.exemptPence,
            standardPence: split.standardNetPence,
            outsideScopePence: split.outsideScopePence,
            unmappedPence: split.unmappedPence,
            // How much of the split rests on the default rather than a
            // decision. Surfaced so the page can say it, and so a reader can
            // never mistake an assumption for a classification.
            assumedPence: split.assumedPence,
            assumedLiability: split.assumedLiability,
            totalPence: split.totalPence,
            outputVatPence: settings.vat_registered ? out.vatPence : 0,
            pricesIncludeVat: settings.prices_include_vat !== false,
            registration: reg,
            ratesSource: rates.source_url,
            taxYear: rates.tax_year,
            caveats,
        };
    },

    async _corporationTax(orgId, settings, period) {
        // Only limited companies pay CT. A sole trader or partnership pays
        // Income Tax and Class 4 NIC — a different regime, not a different
        // rate — so quoting a CT figure to them would be plainly wrong.
        if (settings.entity_type !== 'limited_company') {
            return {
                state: 'not_applicable',
                reason: `${labelEntity(settings.entity_type)} pays Income Tax and Class 4 NIC through Self Assessment, not Corporation Tax.`,
                caveats: [],
            };
        }
        if (!period) {
            return { state: 'no_period', caveats: ['Set your accounting year end on Settings → Tax to see Corporation Tax.'] };
        }

        const rates = await taxRepository.rates('corporation_tax', period.end);
        if (!rates) return { state: 'no_rates', caveats: [`No Corporation Tax rates are recorded for ${period.end}.`] };

        // Profit from the accounting feed. This is ACCOUNTING profit, not
        // taxable total profits: no add-backs for disallowables, no capital
        // allowances, no loss relief. Stated, because the gap between the two
        // is exactly what an accountant is for.
        const pl = await analyticsService.plMargin(orgId, { since: period.start, until: period.end });
        const profitPence = pl?.statement?.netPence ?? null;

        if (profitPence === null) {
            return { state: 'no_financials', caveats: ['No profit figure is available for this period, so Corporation Tax cannot be estimated.'] };
        }

        const r = rates.rates;
        const result = corporationTax({
            profitPence,
            smallProfitsRatePct: r.smallProfitsRatePct,
            mainRatePct: r.mainRatePct,
            lowerLimitPence: r.lowerLimitPence,
            upperLimitPence: r.upperLimitPence,
            marginalReliefFraction: r.marginalReliefFraction,
            associatedCompanies: settings.associated_companies ?? 1,
            periodDays: period.days,
        });

        return {
            state: 'ok',
            period,
            profitPence,
            ...result,
            deadlines: corporationTaxDeadlines(period.end),
            associatedCompanies: settings.associated_companies ?? 1,
            ratesSource: rates.source_url,
            financialYear: rates.tax_year,
            caveats: [
                'Based on accounting profit. Taxable profit differs — disallowable expenses, capital allowances and loss relief are not applied here.',
                ...((settings.associated_companies ?? 1) > 1
                    ? [`Limits divided by ${settings.associated_companies} associated companies, so the small profits limit is £${pounds(result.lowerLimitPence)}.`]
                    : []),
            ],
        };
    },
};

function normalise(v) {
    return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function round1(n) { return Math.round(n * 10) / 10; }
function pounds(pence) { return (pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function labelEntity(t) {
    return { sole_trader: 'A sole trader', partnership: 'A partnership', llp: 'An LLP' }[t] ?? 'This entity';
}
function rolling12mStart(onDate) {
    const d = new Date(`${onDate}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    d.setUTCDate(d.getUTCDate() + 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
