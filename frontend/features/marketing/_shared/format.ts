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
