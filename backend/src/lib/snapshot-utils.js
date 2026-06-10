// Helpers for the business-health snapshot worker.
import { londonParts, londonWeekday, londonYmd } from "./tz.js";

export function getISOWeek(d) {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

export function countBySource(...arrays) {
    const counts = {};
    for (const arr of arrays) {
        for (const row of arr ?? []) {
            const src = row.source ?? row.source_provider ?? 'manual';
            counts[src] = (counts[src] ?? 0) + 1;
        }
    }
    return counts;
}

export function isDueForSnapshot(frequency, today, lastSnapshotAt) {
    // Cadence is on the London calendar (client timezone): weekly = London
    // Monday, monthly = London 1st. The cron fires in UTC but the day/month it
    // counts as is London's.
    const isMonday = londonWeekday(today) === 1;
    const isFirstOfMonth = londonParts(today).day === 1;
    const due = (frequency === 'weekly' && isMonday) ||
                (frequency === 'monthly' && isFirstOfMonth);
    if (!due) return false;
    // Idempotency guard: don't re-snapshot if we already did one today (London).
    if (lastSnapshotAt) {
        if (londonYmd(new Date(lastSnapshotAt)) === londonYmd(today)) return false;
    }
    return true;
}

export function windowStart(frequency, today) {
    if (frequency === 'weekly') {
        return new Date(today.getTime() - 7 * 86400000);
    }
    return new Date(today.getUTCFullYear(), today.getUTCMonth() - 1, today.getUTCDate());
}

export function snapshotLabel(frequency, today) {
    if (frequency === 'weekly') {
        return `Week ${getISOWeek(today)}-${today.getUTCFullYear()}`;
    }
    return today.toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}
