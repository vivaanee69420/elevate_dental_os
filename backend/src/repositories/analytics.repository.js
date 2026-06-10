// ============================================================================
// Analytics repository — Supabase reads for the analytics domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// Max rows we read for an in-Node aggregate. Realistic per-org practice +
// settled-payment counts sit far below this; if it ever trips, the service
// surfaces truncated:true rather than computing a silently-wrong total.
export const LIMIT_GUARD = 5000;

export const analyticsRepository = {
    async baselineMaybe(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline, targets')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async baselineSingle(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline')
            .eq('organisation_id', orgId)
            .single();
        return data;
    },
    // ------------------------------------------------------------------------
    // Per-practice scorecard sources. serviceClient bypasses RLS, so the
    // explicit .eq('organisation_id', orgId) IS the only tenant guard here
    // (see CLAUDE.md). LIMIT_GUARD: the Supabase client silently caps a
    // select; if we ever hit the cap the aggregate would be quietly wrong,
    // so we fetch up to the cap and let the service flag truncation.
    async practicesList(orgId) {
        // kind='practice' (T2): exclude academy/lab from clinical rollups.
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId)
            .eq('kind', 'practice')
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // Entities of a given kind ('practice'|'academy'|'lab') for scope resolution.
    async entitiesByKind(orgId, kind) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name, kind')
            .eq('organisation_id', orgId)
            .eq('kind', kind)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // Clinicians view (Intelligence OS): associate roster with pay/lab splits +
    // home practice. pay_pct/lab_split_pct are stored as basis points (4500=45%).
    async cliniciansRoster(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('associates')
            .select('id, full_name, pay_pct, lab_split_pct, active, primary_practice_id, specialty, practice:practices!associates_primary_practice_id_fkey(name)')
            .eq('organisation_id', orgId)
            .order('full_name', { ascending: true })
            .limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return data || [];
    },
    // Real NHS/UDA obligation per practice (owner-entered, not from Dentally).
    async practicesNhs(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name, nhs_contract_uda, nhs_uda_rate_pence')
            .eq('organisation_id', orgId)
            .eq('kind', 'practice')
            .limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return data || [];
    },
    // All entities (practice + academy + lab) with kind, for scope naming on the
    // P&L / per-entity views. One query; the service filters by scope.
    async allEntities(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name, kind')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    async settledPayments(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('payments')
            .select('practice_id, amount_pence')
            .eq('organisation_id', orgId)
            .eq('status', 'settled')
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // ------------------------------------------------------------------------
    // AI-Insights rolling-window sources. Same service-client tenant rule:
    // the explicit .eq('organisation_id', orgId) IS the only isolation.
    async leadsInWindow(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select('status, practice_id, source, estimated_value_pence')
            .eq('organisation_id', orgId)
            .gte('created_at', sinceISO)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // Marketing & ROI sources (Intelligence OS). Real ad spend per provider +
    // CRM leads for channel attribution within [since, until). practiceIds (array
    // | null) scopes to specific entities; null = whole org. ad_metrics.practice_id
    // is frequently NULL (one ad account per group) — an entity scope then sees no
    // paid spend, which is honest (spend isn't tagged to that practice).
    // accountIds (array | null): when non-null, restrict to those ad-account
    // customer_ids (the dynamic, org-isolated account filter). null = no account
    // filter (all of the org's accounts).
    async adMetricsInWindow(orgId, fromDate, toDate, practiceIds = null, accountIds = null) {
        let q = supabase_1.serviceClient
            .from('ad_metrics')
            .select('provider, customer_id, spend_pence, impressions, clicks, reach, conversions, practice_id')
            .eq('organisation_id', orgId)
            .gte('metric_date', fromDate)
            .lte('metric_date', toDate)
            .limit(LIMIT_GUARD);
        if (practiceIds) q = q.in('practice_id', practiceIds);
        if (accountIds !== null) q = q.in('customer_id', accountIds);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
    },
    async leadsForMarketing(orgId, sinceISO, untilISO, practiceIds = null) {
        // Embed the linked contact's practice so leads with no own practice_id
        // (GHL enquiries) can still be attributed to a site via their contact.
        let q = supabase_1.serviceClient
            .from('leads')
            .select('source, utm_source, utm_medium, status, practice_id, estimated_value_pence, created_at, contact:contacts(practice_id)')
            .eq('organisation_id', orgId)
            .gte('created_at', sinceISO)
            .lt('created_at', untilISO)
            .limit(LIMIT_GUARD);
        if (practiceIds) q = q.in('practice_id', practiceIds);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
    },
    async settledPaymentsInWindow(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient
            .from('payments')
            .select('practice_id, amount_pence')
            .eq('organisation_id', orgId)
            .eq('status', 'settled')
            .gte('processed_at', sinceISO)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // Cashflow sources. bankSummary: total balance + freshest sync (staleness
    // surfaced — a 6-month-old balance must not read as "current").
    async bankSummary(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('bank_accounts')
            .select('balance_pence, last_synced_at')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        const rows = data || [];
        const totalPence = rows.reduce((s, a) => s + (a.balance_pence || 0), 0);
        const lastSyncedAt = rows
            .map((a) => a.last_synced_at)
            .filter(Boolean)
            .sort()
            .pop() || null;
        return { totalPence, lastSyncedAt, count: rows.length };
    },
    // EXACT settled-payment revenue, summed in Postgres (RPC) so it is never
    // truncated by the 1000-row read cap. Returns [{ day:'YYYY-MM-DD', pence }]
    // for the window (<=366 rows); callers bucket days into months/weeks/TTM.
    // practiceId scopes to one practice. Real revenue source — no projection.
    async settledReceiptsByDay(orgId, sinceISO, practiceId = null, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('settled_receipts_by_day', {
            p_org: orgId,
            p_since: sinceISO,
            p_practice: practiceId ?? null,
            p_until: untilISO ?? null,
        });
        if (error)
            throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    // Exact per-practice rollups (Postgres GROUP BY via RPC — no 1000-row cap).
    // Manual chair-utilisation grid rows (the intentional, owner-maintained
    // occupancy source). Small table; aggregated per practice in the service.
    async chairUtilisationRows(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('chair_utilisation')
            .select('practice_id, booked_minutes, available_minutes')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return data || [];
    },
    async settledRevenueByPractice(orgId, sinceISO, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('settled_revenue_by_practice', {
            p_org: orgId, p_since: sinceISO, p_until: untilISO ?? null,
        });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    async appointmentsRollupByPractice(orgId, sinceISO, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('appointments_rollup_by_practice', {
            p_org: orgId, p_since: sinceISO, p_until: untilISO ?? null,
        });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    // True if this org has ANY appointment marked as a no-show. Dentally orgs
    // that never sync a did_not_attend/DNA state have zero no_show rows, which is
    // indistinguishable from a genuine "no missed appointments" at the rollup. We
    // use this to show "—" (not tracked) instead of a misleading 0% no-show rate.
    async hasNoShowData(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('appointments')
            .select('id')
            .eq('organisation_id', orgId)
            .eq('status', 'no_show')
            .limit(1);
        if (error) throw new Error(error.message);
        return (data || []).length > 0;
    },
    async leadsRollupByPractice(orgId, sinceISO = null, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('leads_rollup_by_practice', {
            p_org: orgId, p_since: sinceISO ?? null, p_until: untilISO ?? null,
        });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    // Org-wide treatment rollup (treatment_plans are not practice-attributed).
    async treatmentsRollupByOrg(orgId, sinceISO, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('treatments_rollup_by_org', {
            p_org: orgId, p_since: sinceISO, p_until: untilISO ?? null,
        });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return row || { started: 0, completed: 0, closed_value_pence: 0 };
    },
    // Treatment-plan private production split by status, in the window — feeds
    // the Revenue Leakage "lost plans" pool. Presented = all plans started in
    // the window; accepted = the completed subset. Paginated, org-filtered on
    // the serviceClient path (no automatic RLS here — rule 3). `treatments_
    // rollup_by_org` only returns the accepted (closed) side, so this fills in
    // the presented total it omits.
    async treatmentPlanValueByStatus(orgId, sinceISO, untilISO = null) {
        const sinceDate = sinceISO ? new Date(sinceISO).toISOString().slice(0, 10) : null;
        const untilDate = untilISO ? new Date(untilISO).toISOString().slice(0, 10) : null;
        const PAGE = 1000;
        let presentedPence = 0, acceptedPence = 0;
        for (let from = 0; ; from += PAGE) {
            let q = supabase_1.serviceClient
                .from('treatment_plans')
                .select('private_value_pence, completed, start_date')
                .eq('organisation_id', orgId)
                .gt('private_value_pence', 0)
                .range(from, from + PAGE - 1);
            if (sinceDate) q = q.gte('start_date', sinceDate);
            if (untilDate) q = q.lte('start_date', untilDate);
            const { data, error } = await q;
            if (error) throw new Error(error.message);
            const rows = data || [];
            for (const r of rows) {
                const v = Number(r.private_value_pence) || 0;
                presentedPence += v;
                if (r.completed) acceptedPence += v;
            }
            if (rows.length < PAGE) break;
        }
        return { presentedPence, acceptedPence };
    },
    // ------------------------------------------------------------------------
    // Business Hub sources — per-practice rollup across finance + ops + growth.
    async practicesFull(orgId) {
        // kind='practice' (T2): exclude academy/lab (no chairs) from chair/util rollups.
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name, chairs, assumed_util_pct')
            .eq('organisation_id', orgId)
            .eq('kind', 'practice')
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // Treatment Mix heat matrix (GM Intelligence OS): appointment VOLUME by
    // practice_id x appointment_type within [since, until). Prefers the
    // treatment_mix_matrix RPC; falls back to a paginated JS-side grouping when
    // the RPC is absent (mirrors treatment.repository.mixByType). VOLUME only —
    // Dentally appointments carry no price (data wall). Rows: { practice_id,
    // appointment_type, volume }. NULL types collapse to 'Unspecified'.
    async treatmentMixMatrix(orgId, sinceISO, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('treatment_mix_matrix', {
            p_org: orgId, p_since: sinceISO, p_until: untilISO ?? null,
        });
        if (!error && Array.isArray(data)) {
            return data.map((r) => ({
                practice_id: r.practice_id,
                appointment_type: r.appointment_type ?? 'Unspecified',
                volume: Number(r.volume) || 0,
            }));
        }
        return this._matrixFallback(orgId, sinceISO, untilISO);
    },
    async _matrixFallback(orgId, sinceISO, untilISO = null) {
        const counts = new Map(); // `${practice_id}|${type}` -> volume
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            let query = supabase_1.serviceClient
                .from('appointments')
                .select('practice_id, appointment_type')
                .eq('organisation_id', orgId)
                .gte('starts_at', sinceISO);
            if (untilISO) query = query.lt('starts_at', untilISO);
            // Stable order required across .range() windows (PostgREST gives no
            // row-order guarantee otherwise -> rows skipped/double-counted).
            // .range() is terminal, so it comes last.
            const { data, error } = await query
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            const rows = data ?? [];
            for (const r of rows) {
                const type = r.appointment_type ?? 'Unspecified';
                const key = `${r.practice_id}|${type}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            if (rows.length < PAGE) break;
        }
        return [...counts.entries()].map(([key, volume]) => {
            const sep = key.indexOf('|');
            return { practice_id: key.slice(0, sep), appointment_type: key.slice(sep + 1), volume };
        });
    },
    // Treatment REVENUE matrix (GM Intelligence OS): real invoiced fee by
    // practice_id x treatment_name within [since, until), from invoice_items.
    // Prefers the treatment_revenue_matrix RPC; falls back to a paginated scan.
    // Rows: { practice_id, treatment_name, fee_pence, item_count }.
    async treatmentRevenueMatrix(orgId, sinceISO, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('treatment_revenue_matrix', {
            p_org: orgId, p_since: sinceISO, p_until: untilISO ?? null,
        });
        if (!error && Array.isArray(data)) {
            return data.map((r) => ({
                practice_id: r.practice_id,
                treatment_name: r.treatment_name || 'Unspecified',
                fee_pence: Number(r.fee_pence) || 0,
                item_count: Number(r.item_count) || 0,
            }));
        }
        return this._revenueMatrixFallback(orgId, sinceISO, untilISO);
    },
    async _revenueMatrixFallback(orgId, sinceISO, untilISO = null) {
        // invoiced_on is a DATE; compare against the date portion of the window.
        const sinceDate = String(sinceISO).slice(0, 10);
        const untilDate = untilISO ? String(untilISO).slice(0, 10) : null;
        const agg = new Map(); // `${practice_id}|${name}` -> { fee, count }
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            let query = supabase_1.serviceClient
                .from('invoice_items')
                .select('practice_id, treatment_name, fee_pence')
                .eq('organisation_id', orgId)
                .gte('invoiced_on', sinceDate);
            if (untilDate) query = query.lt('invoiced_on', untilDate);
            const { data, error } = await query
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            const rows = data ?? [];
            for (const r of rows) {
                const name = r.treatment_name || 'Unspecified';
                const key = `${r.practice_id}|${name}`;
                const a = agg.get(key) || { fee: 0, count: 0 };
                a.fee += Number(r.fee_pence) || 0;
                a.count += 1;
                agg.set(key, a);
            }
            if (rows.length < PAGE) break;
        }
        return [...agg.entries()].map(([key, v]) => {
            const sep = key.indexOf('|');
            return { practice_id: key.slice(0, sep), treatment_name: key.slice(sep + 1), fee_pence: v.fee, item_count: v.count };
        });
    },
    // Flat "by treatment" breakdown — real invoiced fee + distinct patient count
    // grouped by treatment_name alone (no practice split), from invoice_items.
    // Prefers the treatment_breakdown RPC; falls back to a paginated scan.
    // Rows: { treatment_name, fee_pence, item_count, patient_count }.
    async treatmentBreakdown(orgId, sinceISO = null, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('treatment_breakdown', {
            p_org: orgId, p_since: sinceISO ?? null, p_until: untilISO ?? null,
        });
        if (!error && Array.isArray(data)) {
            return data.map((r) => ({
                treatment_name: r.treatment_name || 'Unspecified',
                fee_pence: Number(r.fee_pence) || 0,
                item_count: Number(r.item_count) || 0,
                patient_count: Number(r.patient_count) || 0,
            }));
        }
        return this._treatmentBreakdownFallback(orgId, sinceISO, untilISO);
    },
    async _treatmentBreakdownFallback(orgId, sinceISO = null, untilISO = null) {
        const sinceDate = sinceISO ? String(sinceISO).slice(0, 10) : null;
        const untilDate = untilISO ? String(untilISO).slice(0, 10) : null;
        // name -> { fee, count, patients:Set }
        const agg = new Map();
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            let query = supabase_1.serviceClient
                .from('invoice_items')
                .select('treatment_name, fee_pence, contact_id')
                .eq('organisation_id', orgId);
            if (sinceDate) query = query.gte('invoiced_on', sinceDate);
            if (untilDate) query = query.lt('invoiced_on', untilDate);
            const { data, error } = await query
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            const rows = data ?? [];
            for (const r of rows) {
                const name = r.treatment_name || 'Unspecified';
                const a = agg.get(name) || { fee: 0, count: 0, patients: new Set() };
                a.fee += Number(r.fee_pence) || 0;
                a.count += 1;
                if (r.contact_id) a.patients.add(r.contact_id);
                agg.set(name, a);
            }
            if (rows.length < PAGE) break;
        }
        return [...agg.entries()].map(([treatment_name, v]) => ({
            treatment_name, fee_pence: v.fee, item_count: v.count, patient_count: v.patients.size,
        }));
    },
    // Per-invoice rollup (names[] + total fee) for the workbench real-fee seed.
    // RPC only (no fallback): a JS array_agg-equivalent scan would be heavy and
    // this is a non-critical enhancement — returns [] if the RPC is absent.
    async invoiceCaseRollup(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient.rpc('invoice_case_rollup', {
            p_org: orgId, p_since: sinceISO,
        });
        if (error || !Array.isArray(data)) return [];
        return data.map((r) => ({ names: r.names ?? [], total_pence: Number(r.total_pence) || 0 }));
    },
    // Appointments in a rolling window for utilisation / DNA per practice.
    async appointmentsForHub(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient
            .from('appointments')
            .select('practice_id, status, starts_at')
            .eq('organisation_id', orgId)
            .gte('starts_at', sinceISO)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // All leads (any age) for conversion per practice.
    async leadsForHub(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select('practice_id, status')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // ------------------------------------------------------------------------
    // Data Quality Engine (Phase 5) — per-practice defect counts in ONE query
    // via the data_quality_by_practice RPC (appointments is large; no JS scan).
    async dataQualityByPractice(orgId) {
        const { data, error } = await supabase_1.serviceClient.rpc('data_quality_by_practice', {
            p_org: orgId,
        });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    // Connector sync state for connector-health (Data Quality panel). Reads the
    // integrations table directly — provider/status/last_synced_at/last_error.
    async connectorStates(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('integrations')
            .select('provider, status, last_synced_at, last_error')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return data || [];
    },
    // Attrition & Retention (Phase 6) — per-practice patient cohorts by last-visit
    // recency in ONE query via the patient_retention_by_practice RPC (appointments
    // is large; the per-patient max() can't be done JS-side). p_now is passed for
    // deterministic windows. Rows: { practice_id, active_patients, lapsed_patients,
    // dormant_patients, total_patients, unlinked_appts }.
    async patientRetentionByPractice(orgId, nowISO) {
        const { data, error } = await supabase_1.serviceClient.rpc('patient_retention_by_practice', {
            p_org: orgId, p_now: nowISO,
        });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
};
