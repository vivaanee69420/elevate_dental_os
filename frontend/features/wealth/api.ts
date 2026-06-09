// Wealth API slice — owner-only live endpoints backed by business_health.baseline.
//
// Unit note (confirmed against backend/src/routes/wealth.routes.js):
//   /api/wealth/net  -> assets / liabilities / net_worth are RAW WHOLE POUNDS
//     (straight off the baseline jsonb, no *100 applied server-side).
//   /api/wealth/fire -> *_pence fields ARE integer pence (server multiplies the
//     baseline whole-pound values by 100); years_to_fire is a plain count.
//
// Pensions + Property stay on mock — their endpoints return { note: 'Phase 7' }.
import { api } from '@/lib/api';

/** GET /api/wealth/net — aggregate balance sheet. Values are whole pounds. */
export interface NetWorth {
  assets: number; // whole pounds
  liabilities: number; // whole pounds
  net_worth: number; // whole pounds (= assets - liabilities)
}

export function getNetWorth() {
  return api<NetWorth>('/api/wealth/net');
}

/** GET /api/wealth/fire — FIRE projection inputs. Money fields are integer pence. */
export interface FirePlan {
  fire_target_pence: number; // integer pence
  current_savings_pence: number; // integer pence
  years_to_fire: number | null;
}

export function getFire() {
  return api<FirePlan>('/api/wealth/fire');
}
