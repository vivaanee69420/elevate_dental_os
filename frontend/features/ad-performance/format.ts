// Load-bearing null guards for this feature. A null money or rate means "not
// known", never zero — zero would read as a real measurement (free leads, or a
// channel converting nothing) when the truth is that no spend feed maps to it.
// formatPence() coerces null to £0.00 on its own, so every nullable pence value
// on this page MUST go through money() rather than formatPence directly.
import { formatPence } from '@/lib/format';

export const money = (p: number | null) => (p === null ? 'Not reporting' : formatPence(p));

export const pct = (r: number | null) => (r === null ? 'Not reporting' : `${(r * 100).toFixed(1)}%`);

export const count = (n: number) => n.toLocaleString('en-GB');
