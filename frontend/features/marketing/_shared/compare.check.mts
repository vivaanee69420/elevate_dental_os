// Verification for ./compare.ts. Run it:
//
//     node --experimental-strip-types frontend/features/marketing/_shared/compare.check.mts
//
// Not a vitest suite, because the frontend has no test framework and adding
// one is a separate decision (see CLAUDE.md). Node 22 strips the types on its
// own, so this needs no dependency, no config and no CI change — and the
// logic it covers is pure, so a plain script tests it just as well as a
// runner would.
//
// It exists because every case below is one where the obvious implementation
// returns a confident, wrong, well-formatted answer: Infinity rendered as a
// percentage, a cost rise coloured green, an attribution gap read as a 95%
// improvement. None of those fail a typecheck and none of them look wrong on
// screen. Two of the assertions here were themselves wrong when first written
// — the arithmetic in compare.ts was right and the expectation was not —
// which is the other reason to keep it: the next person changing
// previousPeriod() gets to argue with something.

import { computeDelta, previousPeriod, inclusiveDays, sourcesComparable, missingSources } from './compare.ts';

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); fails++; }
  else console.log(`pass ${name}`);
};

// --- previousPeriod: equal length, ending the day before ---
eq('92-day window', previousPeriod('2026-06-01','2026-08-31'), { since:'2026-03-01', until:'2026-05-31' });
eq('single day',    previousPeriod('2026-08-31','2026-08-31'), { since:'2026-08-30', until:'2026-08-30' });
eq('across new year', previousPeriod('2026-01-01','2026-01-31'), { since:'2025-12-01', until:'2025-12-31' });
// BST boundary: 29 Mar 2026 is spring-forward. Calendar arithmetic must not slip.
eq('spans spring-forward', previousPeriod('2026-03-29','2026-03-29'), { since:'2026-03-28', until:'2026-03-28' });
eq('inclusiveDays same day', inclusiveDays('2026-08-31','2026-08-31'), 1);
eq('inclusiveDays Jun-Aug',  inclusiveDays('2026-06-01','2026-08-31'), 92);
eq('prev period has equal length', inclusiveDays(...Object.values(previousPeriod('2026-06-01','2026-08-31')) as [string,string]), 92);
eq('prev period equal length, odd window', inclusiveDays(...Object.values(previousPeriod('2026-01-01','2026-01-31')) as [string,string]), 31);
eq('leap day window', previousPeriod('2028-03-01','2028-03-01'), { since:'2028-02-29', until:'2028-02-29' });

// --- computeDelta: the cases that must NOT invent a number ---
eq('null current',  computeDelta(null, 100, 'lower-better'), null);
eq('null previous', computeDelta(100, null, 'lower-better'), null);
eq('undefined',     computeDelta(undefined, 100, 'neutral'), null);
eq('negative base', computeDelta(100, -50, 'lower-better'), null);
eq('zero to zero',  computeDelta(0, 0, 'lower-better'), { direction:'flat', pct:0, tone:'neutral' });
eq('zero to some',  computeDelta(500, 0, 'higher-better'), { direction:'up', pct:null, tone:'good' });
eq('some to zero',  computeDelta(0, 500, 'higher-better'), { direction:'down', pct:-100, tone:'bad' });

// --- polarity: the whole point ---
eq('CPA rose = BAD',   computeDelta(51652, 43710, 'lower-better')?.tone, 'bad');
eq('CPA rose = up',    computeDelta(51652, 43710, 'lower-better')?.direction, 'up');
eq('CPA fell = GOOD',  computeDelta(43710, 51652, 'lower-better')?.tone, 'good');
eq('CPA fell = down',  computeDelta(43710, 51652, 'lower-better')?.direction, 'down');
eq('leads rose = GOOD',computeDelta(60, 50, 'higher-better')?.tone, 'good');
eq('spend rose = NEUTRAL', computeDelta(60, 50, 'neutral')?.tone, 'neutral');
eq('unchanged is flat',computeDelta(50, 50, 'lower-better'), { direction:'flat', pct:0, tone:'neutral' });

// --- the percentage itself ---
eq('+18.2%', Number(computeDelta(51652, 43710, 'lower-better')!.pct!.toFixed(1)), 18.2);
eq('-50%',   computeDelta(50, 100, 'neutral')!.pct, -50);


// --- like-for-like guard: the live case that forced it ---
const junAug = { ghl: 218, callrail: 310 };
const marMay = { ghl: 0,   callrail: 77  };
eq('coverage cliff is NOT comparable', sourcesComparable(junAug, marMay), false);
eq('names the missing source', missingSources(junAug, marMay), ['GoHighLevel']);
eq('nothing missing the other way', missingSources(marMay, junAug), []);
eq('both sources present = comparable', sourcesComparable({ghl:218,callrail:310},{ghl:12,callrail:40}), true);
eq('a big drop is still comparable', sourcesComparable({ghl:218,callrail:310},{ghl:1,callrail:1}), true);
eq('both empty = comparable', sourcesComparable({ghl:0,callrail:0},{ghl:0,callrail:0}), true);
eq('callrail cliff detected', sourcesComparable({ghl:10,callrail:0},{ghl:10,callrail:50}), false);
eq('names both missing', missingSources({ghl:5,callrail:5},{ghl:0,callrail:0}), ['GoHighLevel','CallRail']);
// The guard must strip the verdict, not the fact: neutral polarity keeps
// direction and percentage, drops good/bad.
const stripped = computeDelta(110483, 2301789, 'neutral');
eq('stripped keeps direction', stripped?.direction, 'down');
eq('stripped drops the verdict', stripped?.tone, 'neutral');
eq('unstripped would have said good', computeDelta(110483, 2301789, 'lower-better')?.tone, 'good');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
