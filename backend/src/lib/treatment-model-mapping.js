// ============================================================================
// treatment_models rows <-> the workbench model shape.
//
// ONE PAIR, DEFINED TOGETHER, because they are inverses. A column added to one
// and forgotten in the other silently drops the owner's figure on the next
// save, and nobody finds out until a number is wrong — and these figures are
// the ONLY copy in the system. Dentally sends what the patient paid and never
// what the work cost; QuickBooks has costs but only at company level. There is
// no feed to re-derive a lab bill or a component price from.
//
// The compute (computeServiceEconomics) works in camelCase integer pence; the
// table is snake_case. Nothing else in the codebase needs this translation, so
// it lives here rather than in the service, where it would sit in the middle of
// unrelated analytics.
// ============================================================================

/** Number or fallback. Guards a null column and a garbled request body alike. */
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/** A stored row -> the shape the workbench and the compute expect. */
export function modelFromRow(r) {
    return {
        key: r.key,
        label: r.label,
        unit: r.unit === 'implant' ? 'implant' : 'case',
        pricePence: num(r.price_pence),
        cbctPence: num(r.cbct_pence),
        utilitiesPence: num(r.utilities_pence),
        surgeryRunCostPence: num(r.surgery_run_cost_pence),
        labBillPence: num(r.lab_bill_pence),
        marketingPct: num(r.marketing_pct),
        labMarginPct: num(r.lab_margin_pct),
        dentistPct: num(r.dentist_pct),
        targetMarginPct: num(r.target_margin_pct),
        surgeries: num(r.surgeries, 1),
        casesPerSurgery: num(r.cases_per_surgery, 1),
        implantsPerPatient: num(r.implants_per_patient, 1),
        // A non-list would be iterated by the compute as though it were rows.
        // The CHECK constraint refuses one at the boundary; this covers a row
        // written before that constraint existed.
        components: Array.isArray(r.components) ? r.components : [],
        isCustom: !!r.is_custom,
    };
}

/**
 * A model from a request body -> a row.
 *
 * Deliberately does NOT carry organisation_id, key or is_custom: the first two
 * are applied by the repository from the caller's own identity, and the third
 * is derived from whether a built-in default exists. A record that can name its
 * own tenant is a cross-org write waiting to happen, and a body that could
 * claim is_custom would make an invented treatment un-deletable.
 */
export function rowFromModel(m) {
    return {
        label: String(m.label ?? '').trim(),
        unit: m.unit === 'implant' ? 'implant' : 'case',
        price_pence: Math.round(num(m.pricePence)),
        cbct_pence: Math.round(num(m.cbctPence)),
        utilities_pence: Math.round(num(m.utilitiesPence)),
        surgery_run_cost_pence: Math.round(num(m.surgeryRunCostPence)),
        lab_bill_pence: Math.round(num(m.labBillPence)),
        marketing_pct: num(m.marketingPct),
        lab_margin_pct: num(m.labMarginPct),
        dentist_pct: num(m.dentistPct),
        target_margin_pct: num(m.targetMarginPct),
        surgeries: Math.round(num(m.surgeries, 1)),
        cases_per_surgery: Math.round(num(m.casesPerSurgery, 1)),
        implants_per_patient: Math.round(num(m.implantsPerPatient, 1)),
        components: (Array.isArray(m.components) ? m.components : []).map((c) => ({
            name: String(c?.name ?? '').slice(0, 80),
            qty: Math.round(num(c?.qty, 1)),
            retailPence: Math.round(num(c?.retailPence)),
            costPence: Math.round(num(c?.costPence)),
        })),
    };
}
