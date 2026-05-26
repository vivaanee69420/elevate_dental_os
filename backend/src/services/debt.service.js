// ============================================================================
// Debt service — aggregates unpaid Dentally invoices into aged bands + KPIs for
// the Debt Recovery page. Money is integer pence throughout.
// ============================================================================
import * as debt_repository_1 from "../repositories/debt.repository.js";

const BANDS = ['0-30', '31-60', '61-90', '91-120', '120+'];
const DAY_MS = 86400000;

// Days overdue from due_on (true overdue semantics), falling back to dated_on.
// Not-yet-due / undated invoices clamp to 0 (count as current).
export function ageDays(inv, now = Date.now()) {
    const ref = inv.due_on ?? inv.dated_on;
    if (!ref) return 0;
    const ms = now - new Date(ref).getTime();
    return Math.max(0, Math.floor(ms / DAY_MS));
}

export function bandKey(age) {
    if (age <= 30) return '0-30';
    if (age <= 60) return '31-60';
    if (age <= 90) return '61-90';
    if (age <= 120) return '91-120';
    return '120+';
}

// Pure transform: raw unpaid-invoice rows -> the Debt Recovery view model.
export function buildDebtView(rows, now = Date.now()) {
    const bands = new Map(BANDS.map((k) => [k, { key: k, label: `${k} days`, count: 0, total_pence: 0 }]));
    let outstanding_pence = 0;
    let overdue90_pence = 0;
    const debtors = (rows ?? []).map((r) => {
        const amount_pence = r.amount_outstanding_pence ?? 0;
        const age_days = ageDays(r, now);
        const b = bands.get(bandKey(age_days));
        b.count++;
        b.total_pence += amount_pence;
        outstanding_pence += amount_pence;
        if (age_days >= 91) overdue90_pence += amount_pence;
        const name = [r.contact?.first_name, r.contact?.last_name].filter(Boolean).join(' ').trim()
            || r.patient_name || 'Unknown patient';
        return { name, practice: r.practice?.name ?? null, treatment: r.treatment ?? null, amount_pence, age_days };
    }).sort((a, b) => b.age_days - a.age_days);
    return { outstanding_pence, overdue90_pence, bands: [...bands.values()], debtors };
}

export const debtService = {
    async list(orgId, { practiceId = null } = {}) {
        const rows = await debt_repository_1.debtRepository.listUnpaid(orgId, { practiceId });
        return buildDebtView(rows);
    },
};
