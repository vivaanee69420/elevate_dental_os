// Money is integer pence everywhere. Display as £ with en-GB grouping and a
// fixed 2 decimals — bare toLocaleString drops trailing zeros (15108630 ->
// "151,086.3", 4600 -> "46"), which reads as a broken/missing penny on money cards.
export function formatPence(pence: number | null | undefined): string {
  return `£${((pence || 0) / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(n: number | null | undefined): string {
  return (n || 0).toLocaleString('en-GB');
}

export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString('en-GB');
}

/** Format a 24h "HH:MM" string as 12-hour, e.g. "08:00" -> "8:00am". */
export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  let h = Number(hStr);
  const m = mStr ?? '00';
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

/**
 * "1 company", "3 companies" — a count with its noun agreeing with it.
 *
 * Written down once because "1 companies connected" appeared on a live
 * Integrations tile, and the same panel three lines away got it right with its
 * own inline ternary. Every place that counts things is a place to forget it,
 * and English plurals are irregular enough (company/companies, practice/
 * practices) that the -s default has to be overridable rather than assumed.
 */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/** The count and the noun together: countOf(1, 'company', 'companies'). */
export function countOf(n: number, singular: string, pluralForm?: string): string {
  return `${formatNumber(n)} ${plural(n, singular, pluralForm)}`;
}
