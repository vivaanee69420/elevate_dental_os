// Cell formatters shared by every ad-reporting table (Facebook: 3 tabs,
// Google: 4 — seven metric tables in total). Deliberately centralised: the
// surrounding marketing screens each declare their own unexported `money`/
// `ctrPct`/`num` consts (see e.g. FacebookCampaignsScreen.tsx) and that is
// the normal convention here — this file is a DELIBERATE deviation from it.
// Seven copies of the em-dash guard is seven chances to miss one, and a
// missed guard is not cosmetic: `formatPence` accepts `number | null |
// undefined` and does `(pence || 0)`, so it silently renders a genuinely
// unknown cost (e.g. cost-per-lead with zero leads) as a confident "£0.00"
// and TypeScript never warns, because the signature already allows null.
// A cost per nothing is unknowable, not free — that has to be enforced once,
// here, not re-declared per file.
import { formatPence } from '@/lib/format';

export const DASH = '—';

// Negatives are real here: a lead's Paid figure is net of refunds, so a
// refund of something paid before the lead can put it below zero. formatPence
// interpolates the sign after the symbol and renders "£-40.00", which reads
// as a typo rather than as money going the other way; British convention puts
// the sign first. Fixed here rather than in formatPence itself, which every
// screen in the app shares and almost none of which can produce a negative.
export const money = (pence: number | null | undefined): string => {
  if (pence === null || pence === undefined) return DASH;
  return pence < 0 ? `-${formatPence(-pence)}` : formatPence(pence);
};

// CTR arrives from the rollups as a raw 0-1 fraction. It is scaled to a
// percentage exactly once, here, so the Facebook and Google pages cannot
// disagree about whether 0.0312 means 3.12% or 0.03%.
export const ctr = (fraction: number | null | undefined): string =>
  (fraction === null || fraction === undefined ? DASH : `${(fraction * 100).toFixed(2)}%`);

export const num = (n: number | null | undefined): string =>
  (n === null || n === undefined ? DASH : n.toLocaleString('en-GB'));

// A 0-1 ratio as a whole-number percentage. Distinct from `ctr` above only in
// its precision: an impression share of 62% is acted on, a CTR of 3.12% is
// compared, so they round differently on purpose.
export const pct = (fraction: number | null | undefined, dp = 0): string =>
  (fraction === null || fraction === undefined ? DASH : `${(fraction * 100).toFixed(dp)}%`);

// A ratio shown as a multiple — return on spend, where "2.4x" reads instantly
// and "240%" invites the reader to wonder whether the original stake is
// included. One decimal place: the input is a cohort figure that moves as
// patients pay, and a second decimal would imply a precision it does not have.
export const multiple = (n: number | null | undefined): string =>
  (n === null || n === undefined ? DASH : `${n.toFixed(1)}x`);

// Money with the pence dropped — for figures big enough that the pence are
// noise and the column width is not. Never used for a cost-per-something,
// where £41 and £41.60 are a real difference to anyone setting a bid.
export const money0 = (pence: number | null | undefined): string => {
  if (pence === null || pence === undefined) return DASH;
  const neg = pence < 0;
  const whole = Math.round(Math.abs(pence) / 100);
  return `${neg ? '-' : ''}£${whole.toLocaleString('en-GB')}`;
};

// Google reports modelled conversions as decimals (3.5 is a real value in its
// own interface), so this must NOT round to an integer — but a trailing ".0"
// on a whole number is noise, so it is trimmed.
export const conversions = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return DASH;
  return Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toFixed(1);
};
