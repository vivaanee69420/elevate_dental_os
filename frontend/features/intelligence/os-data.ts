// GM Group Intelligence OS — shared mock data + compute engine.
//
// FRONTEND-FIRST: this is a faithful TypeScript port of the data engine in
// GM-Group-Intelligence-OS_3.html (the prototype). It powers the new Intelligence
// OS screens (Marketing & ROI, P&L & Margin, Clinicians, AI Analyst, Day) so the
// UI is complete and demonstrable BEFORE any backend exists. Each screen reads
// from here today; the backend-wiring slice swaps these pure functions for the
// real /api/analytics/* endpoints (one screen at a time).
//
// NOTE on money: the prototype works in whole POUNDS, so this mock keeps pounds
// and formats with gbp(). The real backend is integer PENCE (CLAUDE.md rule 2) —
// the wiring slice converts at the api() boundary. Do not mix the two here.
//
// Scope/period are passed in as a Ctx (from the URL-synced ScopePeriod control)
// rather than read from a global, so every function is pure and testable.

export type Scope = string; // 'all' | 'practices' | 'academy' | 'lab' | practiceId
export type Period = 'month' | 'day';

export interface Ctx {
  scope: Scope;
  period: Period;
  /** 'YYYY-MM' for month, 'YYYY-MM-DD' for day. */
  periodKey: string;
}

/* ---- formatting helpers (pounds) ---- */
export const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
export const gbpK = (n: number) =>
  Math.abs(n) >= 1000 ? '£' + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : '£' + Math.round(n);
export const pct = (n: number, d = 1) => n.toFixed(d) + '%';
export const sum = <T>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

/* ============================================================
   STATIC DATA (mirrors the prototype)
============================================================ */
export const MONTHS = [
  { key: '2026-03', label: 'Mar 2026', mult: 0.93 },
  { key: '2026-04', label: 'Apr 2026', mult: 0.97 },
  { key: '2026-05', label: 'May 2026', mult: 1.0 },
  { key: '2026-06', label: 'Jun 2026 (proj)', mult: 1.06 },
];

export interface Treatment {
  label: string;
  short: string;
  fee: number;
  lab: number;
  consumable: number;
  clinPct: number;
  color: string;
}
export const TREATMENTS: Record<string, Treatment> = {
  fullarch: { label: 'Full Arch (Fixed Teeth)', short: 'Full Arch', fee: 10000, lab: 3500, consumable: 950, clinPct: 40, color: '#a8442f' },
  implant: { label: 'Single Implant', short: 'Implant', fee: 2050, lab: 350, consumable: 430, clinPct: 40, color: '#c2693f' },
  invisalign: { label: 'Invisalign / Ortho', short: 'Invisalign', fee: 3200, lab: 850, consumable: 120, clinPct: 45, color: '#b98a3c' },
  bonding: { label: 'Composite Bonding', short: 'Bonding', fee: 1400, lab: 0, consumable: 110, clinPct: 45, color: '#7a9e54' },
  crown: { label: 'Crown & Bridge', short: 'Crown/Bridge', fee: 850, lab: 180, consumable: 70, clinPct: 45, color: '#3f9d7c' },
  endo: { label: 'Endodontics', short: 'Endo', fee: 640, lab: 0, consumable: 95, clinPct: 45, color: '#4d8bb0' },
  whitening: { label: 'Teeth Whitening', short: 'Whitening', fee: 350, lab: 55, consumable: 40, clinPct: 30, color: '#7a5cc4' },
  general: { label: 'General / Restorative', short: 'General', fee: 185, lab: 10, consumable: 35, clinPct: 50, color: '#84958c' },
  hygiene: { label: 'Hygiene & Perio', short: 'Hygiene', fee: 92, lab: 0, consumable: 18, clinPct: 42, color: '#c0883a' },
};
export const TKEYS = Object.keys(TREATMENTS);

export const ATTRIBUTION = 0.4;
export interface Channel {
  label: string;
  color: string;
  revShare: number;
  spendShare: number;
  convRate: number;
  avgVal: number;
  paid: boolean;
  group: 'paid' | 'social' | 'organic';
}
export const CHANNELS: Record<string, Channel> = {
  gads: { label: 'Google Ads', color: '#2f6fb0', revShare: 0.3, spendShare: 0.4, convRate: 0.2, avgVal: 2900, paid: true, group: 'paid' },
  meta: { label: 'Facebook / Meta', color: '#3b5998', revShare: 0.22, spendShare: 0.34, convRate: 0.14, avgVal: 2400, paid: true, group: 'paid' },
  insta: { label: 'Instagram / Social', color: '#c13584', revShare: 0.08, spendShare: 0.12, convRate: 0.11, avgVal: 2000, paid: true, group: 'social' },
  seo: { label: 'SEO / Website', color: '#1d6e5f', revShare: 0.17, spendShare: 0.07, convRate: 0.24, avgVal: 2600, paid: false, group: 'organic' },
  ref: { label: 'Referrals', color: '#5aa674', revShare: 0.13, spendShare: 0.02, convRate: 0.4, avgVal: 3000, paid: false, group: 'organic' },
  recall: { label: 'Internal Recall', color: '#c6a253', revShare: 0.1, spendShare: 0.05, convRate: 0.45, avgVal: 650, paid: false, group: 'organic' },
};
export const CKEYS = Object.keys(CHANNELS);

export interface Practice {
  id: string;
  name: string;
  region: string;
  chairs: number;
  revenue: number;
  util: number;
  trend: string;
  convStrength: number;
  valueIndex: number;
  adSpend: number;
  wagePct: number;
  collectPct: number;
  acceptedValue: number;
  mix: Record<string, number>;
  note: string;
}
// FRONTEND-FIRST, NOT WIRED: money/util/collection figures are 0 until the
// Clinicians + AI Analyst screens are wired to real /api/analytics data. Names,
// regions, chairs and treatment mix are kept as structure; convStrength and
// valueIndex stay non-zero (valueIndex is a divisor in channelRows). 0 is shown
// rather than the prototype's synthesised practice figures.
export const PRACTICES: Practice[] = [
  { id: 'rochester', name: 'GM Rochester', region: 'Kent', chairs: 6, revenue: 0, util: 0, trend: 'flat', convStrength: 1.06, valueIndex: 1.08, adSpend: 0, wagePct: 0, collectPct: 0, acceptedValue: 0,
    mix: { fullarch: 0.18, implant: 0.2, invisalign: 0.14, bonding: 0.07, crown: 0.1, endo: 0.07, whitening: 0.03, general: 0.14, hygiene: 0.07 },
    note: 'Strongest implant + Invisalign engine. Hygiene reactivation is the open lever.' },
  { id: 'barnet', name: 'GM Barnet', region: 'North London', chairs: 5, revenue: 0, util: 0, trend: 'flat', convStrength: 1.04, valueIndex: 1.05, adSpend: 0, wagePct: 0, collectPct: 0, acceptedValue: 0,
    mix: { fullarch: 0.14, implant: 0.18, invisalign: 0.15, bonding: 0.08, crown: 0.1, endo: 0.05, whitening: 0.04, general: 0.16, hygiene: 0.1 },
    note: 'Best balance of cash collection, diary density and conversion speed.' },
  { id: 'warwick', name: 'Warwick Lodge', region: 'Herne Bay', chairs: 5, revenue: 0, util: 0, trend: 'flat', convStrength: 0.96, valueIndex: 0.98, adSpend: 0, wagePct: 0, collectPct: 0, acceptedValue: 0,
    mix: { fullarch: 0.1, implant: 0.15, invisalign: 0.12, bonding: 0.06, crown: 0.12, endo: 0.07, whitening: 0.04, general: 0.22, hygiene: 0.12 },
    note: 'Healthy volume but midweek diaries soften and DNA rate is creeping.' },
  { id: 'ashford', name: 'GM Ashford', region: 'Kent', chairs: 4, util: 0, revenue: 0, trend: 'flat', convStrength: 0.88, valueIndex: 0.92, adSpend: 0, wagePct: 0, collectPct: 0, acceptedValue: 0,
    mix: { fullarch: 0.07, implant: 0.12, invisalign: 0.1, bonding: 0.05, crown: 0.12, endo: 0.09, whitening: 0.04, general: 0.27, hygiene: 0.14 },
    note: 'General-heavy. Front-desk conversion discipline + recall recovery needed.' },
  { id: 'bexleyheath', name: 'Fixed Teeth Solutions · Bexleyheath', region: 'SE London', chairs: 3, util: 0, revenue: 0, trend: 'flat', convStrength: 0.8, valueIndex: 1.1, adSpend: 0, wagePct: 0, collectPct: 0, acceptedValue: 0,
    mix: { fullarch: 0.3, implant: 0.22, invisalign: 0.06, bonding: 0.04, crown: 0.08, endo: 0.04, whitening: 0.02, general: 0.16, hygiene: 0.08 },
    note: 'Full-arch ramp site. High ticket but utilisation + acceptance need weekly intervention.' },
];

export interface Entity {
  id: string;
  name: string;
  region?: string;
  revenue: number;
  marginPct: number;
  adSpend: number;
  trend: string;
  collectPct: number;
  acceptedValue: number;
  lines: { label: string; revenue: number; marginPct: number }[];
}
// Academy + Lab figures 0 until wired (structure/line labels kept).
export const ACADEMY: Entity = { id: 'academy', name: 'Plan4Growth Academy', revenue: 0, marginPct: 0, adSpend: 0, trend: 'flat', collectPct: 0, acceptedValue: 0,
  lines: [{ label: 'Implant Diploma (L7)', revenue: 0, marginPct: 0 }, { label: 'Premium Mastermind', revenue: 0, marginPct: 0 }, { label: 'Membership', revenue: 0, marginPct: 0 }, { label: 'CPD / Short courses', revenue: 0, marginPct: 0 }] };
export const LAB: Entity = { id: 'lab', name: 'GM Dental Lab', revenue: 0, marginPct: 0, adSpend: 0, trend: 'flat', collectPct: 0, acceptedValue: 0,
  lines: [{ label: 'Crowns & Bridges', revenue: 0, marginPct: 0 }, { label: 'Implant components', revenue: 0, marginPct: 0 }, { label: 'Dentures', revenue: 0, marginPct: 0 }, { label: 'Aligner / misc', revenue: 0, marginPct: 0 }] };

/* chair operating standards + UDA contracts */
export const CHAIR_CFG = { openHrs: 8, weeksYr: 46, daysWk: 5, benchOccPct: 88, benchRevHr: 300, targetProfitPct: 15, materialsPct: 5, labCostPct: 10 };
export const workDaysYr = () => CHAIR_CFG.weeksYr * CHAIR_CFG.daysWk; // 230
// NHS UDA contracts 0 until wired to a real contract feed.
export const NHS: Record<string, { contract: number; udaRate: number }> = {
  ashford: { contract: 0, udaRate: 0 },
  warwick: { contract: 0, udaRate: 0 },
};

const ASSOC_TEMPLATE = [
  { role: 'Principal / Implant Lead', split: 42, labSplit: 50, share: 0.34, daysMo: 16 },
  { role: 'Associate Dentist', split: 43, labSplit: 50, share: 0.3, daysMo: 18 },
  { role: 'Associate Dentist', split: 45, labSplit: 50, share: 0.22, daysMo: 18 },
  { role: 'Therapist / Hygienist', split: 48, labSplit: 0, share: 0.14, daysMo: 20 },
];

/* ============================================================
   PERIOD MATH
============================================================ */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_W: Record<number, number> = { 1: 1.05, 2: 1.1, 3: 1.05, 4: 1.0, 5: 0.85, 6: 0.45, 0: 0 };
const WORKING_DAYS = 21;

function monthMultFor(key: string): number {
  return MONTHS.find((m) => m.key === key)?.mult ?? 1;
}
/** Day weight for a 'YYYY-MM-DD' key (Sunday = 0, excluded). */
function dayWeight(dayKey: string): number {
  const [y, mo, d] = dayKey.split('-').map(Number);
  if (!y || !mo || !d) return DAY_W[1];
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return DAY_W[dow] ?? 1;
}
/** Period multiplier applied to monthly base figures. */
export function mult(ctx: Ctx): number {
  if (ctx.period === 'day') {
    const monthKey = ctx.periodKey.slice(0, 7);
    return monthMultFor(monthKey) * dayWeight(ctx.periodKey) / WORKING_DAYS;
  }
  return monthMultFor(ctx.periodKey);
}
export function periodLabel(ctx: Ctx): string {
  if (ctx.period === 'day') {
    const [y, mo, d] = ctx.periodKey.split('-').map(Number);
    if (!y) return ctx.periodKey;
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    return `${DOW[dow]} ${d} ${MON[mo - 1]} ${y}`;
  }
  return MONTHS.find((m) => m.key === ctx.periodKey)?.label || ctx.periodKey;
}

/** Working days (Mon–Sat) of the month containing periodKey, for the Day view. */
export function monthDays(periodKey: string): { key: string; label: string; w: number }[] {
  const monthKey = periodKey.slice(0, 7);
  const [y, mo] = monthKey.split('-').map(Number);
  if (!y || !mo) return [];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const out: { key: string; label: string; w: number }[] = [];
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    if (dow === 0) continue;
    out.push({ key: `${monthKey}-${String(d).padStart(2, '0')}`, label: `${DOW[dow]} ${d} ${MON[mo - 1]}`, w: DAY_W[dow] });
  }
  return out;
}

/* ============================================================
   COMPUTE
============================================================ */
const _ratioCache: Record<string, { labRatio: number; clinRatio: number }> = {};
function baseTreatRatios(p: Practice) {
  if (_ratioCache[p.id]) return _ratioCache[p.id];
  let rev = 0, direct = 0, clin = 0;
  TKEYS.forEach((k) => {
    const t = TREATMENTS[k];
    const value = p.revenue * (p.mix[k] || 0);
    const cases = Math.round(value / t.fee);
    const r = cases * t.fee;
    rev += r;
    direct += cases * (t.lab + t.consumable);
    clin += (r - cases * t.lab) * (t.clinPct / 100);
  });
  return (_ratioCache[p.id] = { labRatio: rev ? direct / rev : 0, clinRatio: rev ? clin / rev : 0 });
}

export interface TreatRow {
  key: string; label: string; short: string; color: string;
  cases: number; revenue: number; directCost: number; clinPay: number;
  contribution: number; margin: number; perCase: number;
}
export function treatRow(p: Practice, key: string, ctx: Ctx): TreatRow {
  const t = TREATMENTS[key], m = mult(ctx);
  const value = p.revenue * (p.mix[key] || 0) * m;
  const cases = Math.max(Math.round(value / t.fee), 0);
  const revenue = cases * t.fee, labCost = cases * t.lab, directCost = cases * (t.lab + t.consumable);
  const clinPay = (revenue - labCost) * (t.clinPct / 100);
  const contribution = revenue - directCost - clinPay;
  return { key, label: t.label, short: t.short, color: t.color, cases, revenue, directCost, clinPay, contribution, margin: revenue ? (contribution / revenue) * 100 : 0, perCase: cases ? contribution / cases : 0 };
}
export const practiceTreatments = (p: Practice, ctx: Ctx) => TKEYS.map((k) => treatRow(p, k, ctx));

export interface ChannelRow {
  key: string; label: string; color: string; paid: boolean; group: string;
  spend: number; leads: number; conversions: number; revenue: number;
  cpl: number; cpa: number; roas: number; roi: number;
}
export function channelRows(p: Practice, ctx: Ctx): ChannelRow[] {
  const m = mult(ctx), mktRevenue = p.revenue * ATTRIBUTION * p.convStrength * m, ad = p.adSpend;
  return CKEYS.map((key) => {
    const c = CHANNELS[key];
    const spend = Math.round(ad * c.spendShare * (c.paid ? m : 1));
    const revenue = Math.round(mktRevenue * c.revShare);
    const conversions = Math.max(Math.round(revenue / (c.avgVal * p.valueIndex)), 0);
    const leads = Math.max(Math.round(conversions / c.convRate), 0);
    return { key, label: c.label, color: c.color, paid: c.paid, group: c.group, spend, leads, conversions, revenue, cpl: leads ? spend / leads : 0, cpa: conversions ? spend / conversions : 0, roas: spend ? revenue / spend : revenue > 0 ? 99 : 0, roi: spend ? ((revenue - spend) / spend) * 100 : revenue > 0 ? 9900 : 0 };
  });
}
export function groupChannels(list: Practice[], ctx: Ctx): ChannelRow[] {
  return CKEYS.map((key) => {
    const rows = list.map((p) => channelRows(p, ctx).find((r) => r.key === key)!);
    const spend = sum(rows, (r) => r.spend), leads = sum(rows, (r) => r.leads), conversions = sum(rows, (r) => r.conversions), revenue = sum(rows, (r) => r.revenue);
    return { key, label: CHANNELS[key].label, color: CHANNELS[key].color, paid: CHANNELS[key].paid, group: CHANNELS[key].group, spend, leads, conversions, revenue, cpl: leads ? spend / leads : 0, cpa: conversions ? spend / conversions : 0, roas: spend ? revenue / spend : 0, roi: spend ? ((revenue - spend) / spend) * 100 : 0 };
  });
}

export function scopedPractices(ctx: Ctx): Practice[] {
  if (['all', 'academy', 'lab', 'practices'].includes(ctx.scope)) return PRACTICES;
  const one = PRACTICES.find((p) => p.id === ctx.scope);
  return one ? [one] : PRACTICES;
}

export interface ScopedEntity {
  id: string; name: string; region?: string; kind: 'practice' | 'academy' | 'lab';
  revenue: number; contribution: number; cashCollected: number; acceptedValue: number;
  netMarginPct: number; adSpend: number; collectPct: number;
  wagePct?: number; util?: number; note?: string;
  mktRevenue?: number; paidSpend?: number; leads?: number; conversions?: number;
}
export function scopedEntities(ctx: Ctx): ScopedEntity[] {
  const m = mult(ctx);
  const practiceEnt: ScopedEntity[] = PRACTICES.map((p) => {
    const tr = practiceTreatments(p, ctx), revenue = sum(tr, (r) => r.revenue), contribution = sum(tr, (r) => r.contribution), ch = channelRows(p, ctx);
    return { id: p.id, name: p.name, region: p.region, kind: 'practice', revenue, contribution, cashCollected: Math.round(revenue * p.collectPct / 100), acceptedValue: Math.round(p.acceptedValue * m), adSpend: sum(ch, (r) => r.spend), mktRevenue: sum(ch.filter((r) => r.paid), (r) => r.revenue), paidSpend: sum(ch.filter((r) => r.paid), (r) => r.spend), leads: sum(ch, (r) => r.leads), conversions: sum(ch, (r) => r.conversions), netMarginPct: revenue ? (contribution / revenue) * 100 : 0, collectPct: p.collectPct, wagePct: p.wagePct, util: p.util, note: p.note };
  });
  const acad: ScopedEntity = { id: ACADEMY.id, name: ACADEMY.name, region: 'Group · Academy', kind: 'academy', revenue: Math.round(ACADEMY.revenue * m), contribution: Math.round(ACADEMY.revenue * m * ACADEMY.marginPct / 100), cashCollected: Math.round(ACADEMY.revenue * m * ACADEMY.collectPct / 100), acceptedValue: Math.round(ACADEMY.acceptedValue * m), netMarginPct: ACADEMY.marginPct, adSpend: Math.round(ACADEMY.adSpend * m), collectPct: ACADEMY.collectPct };
  const lab: ScopedEntity = { id: LAB.id, name: LAB.name, region: 'Group · Lab', kind: 'lab', revenue: Math.round(LAB.revenue * m), contribution: Math.round(LAB.revenue * m * LAB.marginPct / 100), cashCollected: Math.round(LAB.revenue * m * LAB.collectPct / 100), acceptedValue: 0, netMarginPct: LAB.marginPct, adSpend: 0, collectPct: LAB.collectPct };
  if (ctx.scope === 'all') return [...practiceEnt, acad, lab];
  if (ctx.scope === 'practices') return practiceEnt;
  if (ctx.scope === 'academy') return [acad];
  if (ctx.scope === 'lab') return [lab];
  const one = practiceEnt.find((p) => p.id === ctx.scope);
  return one ? [one] : practiceEnt;
}

/* ---- P&L ---- */
export type RawEntity = Practice | Entity;
export function scopedRaw(ctx: Ctx): RawEntity[] {
  if (ctx.scope === 'all') return [...PRACTICES, ACADEMY, LAB];
  if (ctx.scope === 'practices') return [...PRACTICES];
  if (ctx.scope === 'academy') return [ACADEMY];
  if (ctx.scope === 'lab') return [LAB];
  const one = PRACTICES.find((p) => p.id === ctx.scope);
  return one ? [one] : [...PRACTICES];
}
export interface PLLine {
  rev: number; lab: number; clin: number; staff: number; mkt: number; prem: number; admin: number;
  gross: number; net: number; margin: number;
}
export function plEntity(e: RawEntity, m: number): PLLine {
  let rev: number, lab: number, clin: number, staff: number, mkt: number, prem: number, admin: number;
  if (e.id === 'academy') {
    rev = e.revenue * m; lab = rev * 0.05; clin = rev * 0.12; staff = rev * 0.18; mkt = (e as Entity).adSpend * m; prem = rev * 0.05; admin = rev * 0.08;
  } else if (e.id === 'lab') {
    rev = e.revenue * m; lab = rev * 0.3; clin = rev * 0.22; staff = rev * 0.1; mkt = 0; prem = rev * 0.06; admin = rev * 0.05;
  } else {
    const p = e as Practice;
    const r = baseTreatRatios(p);
    rev = p.revenue * m; lab = rev * (r.labRatio * 0.45 + 0.015); clin = rev * r.clinRatio; staff = rev * 0.14; mkt = p.adSpend * m; prem = rev * 0.07; admin = rev * 0.05;
  }
  const net = rev - lab - clin - staff - mkt - prem - admin;
  return { rev, lab, clin, staff, mkt, prem, admin, gross: rev - lab, net, margin: rev ? (net / rev) * 100 : 0 };
}
export function plTotals(list: RawEntity[], m: number): PLLine {
  const t: PLLine = { rev: 0, lab: 0, clin: 0, staff: 0, mkt: 0, prem: 0, admin: 0, gross: 0, net: 0, margin: 0 };
  list.forEach((e) => { const p = plEntity(e, m); (Object.keys(t) as (keyof PLLine)[]).forEach((k) => { if (k !== 'margin') t[k] += p[k]; }); });
  t.margin = t.rev ? (t.net / t.rev) * 100 : 0;
  return t;
}

/* ---- Chair + OCPSPD + associates ---- */
export function chairStats(p: Practice, ctx: Ctx) {
  const chairs = p.chairs, util = p.util, m = mult(ctx);
  const capHrsYr = chairs * CHAIR_CFG.openHrs * workDaysYr();
  const bookedHrsYr = (capHrsYr * util) / 100;
  const surgeryDaysYr = chairs * workDaysYr();
  return { chairs, util, capHrsYr, bookedHrsYr, surgeryDaysYr, annualRev: p.revenue * 12 * m };
}
export function ocpspd(p: Practice) {
  const pl = plEntity(p, 1);
  const opCostsYr = (pl.staff + pl.prem + pl.admin) * 12;
  const sd = p.chairs * workDaysYr();
  const perDay = sd ? opCostsYr / sd : 0;
  return { opCostsYr, surgeryDaysYr: sd, perDay, perHr: perDay / CHAIR_CFG.openHrs };
}

export interface Clinician {
  name: string; role: string; chair: number; split: number; labSplit: number;
  prod: number; daily: number; days: number; fees: number; labCost: number; profit: number;
}
export function practiceAssociates(p: Practice, ctx: Ctx): Clinician[] {
  const rev = p.revenue * mult(ctx);
  const n = Math.max(2, Math.min(p.chairs, ASSOC_TEMPLATE.length));
  const temps = ASSOC_TEMPLATE.slice(0, n);
  const shTot = sum(temps, (t) => t.share);
  const r = baseTreatRatios(p);
  const perDay = ocpspd(p).perDay;
  let dcount = 0;
  return temps.map((t, idx) => {
    const isDentist = t.role !== 'Therapist / Hygienist';
    if (isDentist) dcount++;
    const prod = rev * (t.share / shTot);
    const labCost = (prod * r.labRatio * t.labSplit) / 100;
    const fees = (prod * t.split) / 100;
    const name = t.role === 'Associate Dentist' ? `Associate · Chair ${dcount + 1}` : t.role;
    return { name, role: t.role, chair: Math.min(idx + 1, p.chairs), split: t.split, labSplit: t.labSplit, prod, daily: t.daysMo ? prod / t.daysMo : 0, days: t.daysMo, fees, labCost, profit: prod - fees - labCost - perDay * t.daysMo };
  });
}

/* ---- Insights (AI Analyst + Decision Lens) ---- */
export interface Insight { sev: 'good' | 'warn' | 'bad' | 'info'; t: string; d: string; v: string; }
const short = (name: string) => name.split('·')[0].replace('GM ', '').trim();

export function buildInsights(ctx: Ctx): Insight[] {
  const list = scopedPractices(ctx), ents = scopedEntities(ctx);
  const practices = ents.filter((e) => e.kind === 'practice');
  const gc = groupChannels(list, ctx);
  const revenue = sum(ents, (e) => e.revenue), profit = sum(ents, (e) => e.contribution);
  const margin = revenue ? (profit / revenue) * 100 : 0;
  void margin;
  const ins: Insight[] = [];
  // Not wired: no real revenue means no insights to assert. Return empty rather
  // than emitting hardcoded qualitative claims against zero data.
  if (!revenue) return ins;
  if (practices.length > 1) {
    const avg = sum(practices, (p) => p.netMarginPct) / practices.length;
    const w = practices.slice().sort((a, b) => a.netMarginPct - b.netMarginPct)[0];
    const gap = ((avg - w.netMarginPct) / 100) * w.revenue;
    if (gap > 0) ins.push({ sev: 'bad', t: `${short(w.name)} margin is ${pct(w.netMarginPct)} vs ${pct(avg)} group average`, d: `Closing the gap to group average adds ~${gbp(gap)}/period in profit. ${w.note || ''} Start with the wage ratio (${pct(w.wagePct || 0)}) and treatment mix.`, v: gbp(gap) + ' / period' });
  }
  const paid = gc.filter((c) => c.paid).sort((a, b) => b.roas - a.roas);
  if (paid.length >= 2) {
    const top = paid[0], bot = paid[paid.length - 1];
    const shift = bot.spend * 0.4, gain = shift * (top.roas - bot.roas);
    ins.push({ sev: 'good', t: `Shift ~${gbp(shift)} from ${bot.label} (${bot.roas.toFixed(2)}×) to ${top.label} (${top.roas.toFixed(2)}×)`, d: `At current returns that reallocation produces ~${gbp(gain)} more attributed revenue for the same spend. Re-test ${bot.label} creative before cutting further.`, v: gbp(gain) + ' revenue' });
  }
  const cw = practices.slice().sort((a, b) => a.collectPct - b.collectPct)[0];
  if (cw) {
    const out = cw.revenue - cw.cashCollected;
    ins.push({ sev: 'warn', t: `${short(cw.name)} is collecting only ${pct(cw.collectPct)} of billings`, d: `${gbp(out)} sits in outstanding balances — the cheapest cash in the business. Tighten deposits, card-on-file and same-day settlement at this site first.`, v: gbp(out) + ' cash' });
  }
  const hw = PRACTICES.slice().sort((a, b) => a.util - b.util)[0];
  const lat = hw.revenue * Math.max(0, (88 - hw.util) / hw.util);
  if (lat > 0) ins.push({ sev: 'info', t: `${short(hw.name)} runs at ${hw.util}% utilisation — most latent capacity in the group`, d: `Filling to 88% is ~${gbp(lat)}/period of near-pure-margin revenue (fixed cost already paid). Diary optimisation and recall beat any ad spend here.`, v: gbp(lat) + ' / period' });
  ins.push({ sev: 'bad', t: `~30% of group profit depends on you personally`, d: `This is your single biggest valuation discount. Moving implant/full-arch volume onto trained associates re-rates the exit multiple — worth several £m of Enterprise Value. Build the associate clinical pathway as a priority project.`, v: 'Multiple re-rate' });
  const trAgg: Record<string, { short: string; profit: number; cases: number }> = {};
  list.forEach((p) => practiceTreatments(p, ctx).forEach((r) => { if (!trAgg[r.key]) trAgg[r.key] = { short: r.short, profit: 0, cases: 0 }; trAgg[r.key].profit += r.contribution; trAgg[r.key].cases += r.cases; }));
  const trArr = Object.values(trAgg).map((t) => ({ ...t, perCase: t.cases ? t.profit / t.cases : 0 })).sort((a, b) => b.perCase - a.perCase);
  if (trArr.length) {
    const best = trArr[0];
    ins.push({ sev: 'good', t: `${best.short} is your best profit-per-case at ${gbp(best.perCase)}`, d: `Protect this treatment's chair time and weight marketing + recall toward it. Re-train front desk to convert and book ${best.short} consults faster — chair-hours spent here outperform everything else.`, v: gbp(best.perCase) + ' / case' });
  }
  ins.push({ sev: 'info', t: `A disciplined 3% fee uplift drops ~${gbp(revenue * 0.03 * 0.82)}/period straight to profit`, d: `Where demand and waiting lists support it (implants, full arch, Invisalign), price is the fastest lever with near-full drop-through. Review fee schedules quarterly against demand signals.`, v: gbp(revenue * 0.03 * 0.82) + ' / period' });
  ins.push({ sev: 'good', t: `Academy + Lab are your highest-margin, most-strategic lines`, d: `The lab captures component margin that would leak to third parties; the academy builds clinician pipeline and recurring income. Feed practice demand into both — vertical integration is a multiple story, not just a margin one.`, v: 'Strategic' });
  return ins;
}

/** Decision Lens alerts (Overview / Day). */
export function buildAlerts(ctx: Ctx): Insight[] {
  const ents = scopedEntities(ctx);
  const practices = ents.filter((e) => e.kind === 'practice');
  const out: Insight[] = [];
  // Not wired: no real revenue means no alerts to raise.
  if (!sum(ents, (e) => e.revenue)) return out;
  if (practices.length) {
    const worst = practices.slice().sort((a, b) => a.netMarginPct - b.netMarginPct)[0];
    out.push({ sev: 'bad', t: `${short(worst.name)} margin at ${pct(worst.netMarginPct)}`, d: `${worst.note || ''} Wage ratio ${pct(worst.wagePct || 0)}. Closing to group average adds ~${gbp(worst.revenue * 0.06)}/mo profit.`, v: gbp(worst.revenue * 0.06) });
    const cashWorst = practices.slice().sort((a, b) => a.collectPct - b.collectPct)[0];
    out.push({ sev: 'warn', t: `${short(cashWorst.name)} only collecting ${pct(cashWorst.collectPct)}`, d: `${gbp(cashWorst.revenue - cashWorst.cashCollected)} sat in outstanding balances — the cheapest cash you can recover this month.`, v: gbp(cashWorst.revenue - cashWorst.cashCollected) });
  } else {
    const e = ents[0];
    if (e) out.push({ sev: 'good', t: `${e.name}: ${pct(e.netMarginPct)} margin`, d: `${gbp(e.contribution)} profit on ${gbp(e.revenue)} turnover.`, v: gbp(e.contribution) });
  }
  return out;
}

/** Local AI answer (keyword match over insights) — placeholder until /api/analytics/ai-ask. */
export function localAnswer(q: string, ctx: Ctx): Insight[] {
  const ins = buildInsights(ctx);
  const ql = (q || '').toLowerCase();
  let hits = ins.filter((x) => (x.t + x.d).toLowerCase().split(/\W+/).some((w) => w.length > 3 && ql.includes(w)));
  PRACTICES.forEach((p) => { const nm = short(p.name).toLowerCase(); if (ql.includes(nm)) hits = ins.filter((x) => x.t.toLowerCase().includes(nm)).concat(hits); });
  if (!hits.length) hits = ins.slice(0, 3);
  return [...new Set(hits)].slice(0, 3);
}
