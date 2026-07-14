// backend/test/emergent-map-monthly-pl.test.mjs
import { describe, it, expect } from 'vitest';
const { mapMonthlyPl, monthlyPlExternalId } = await import('../src/lib/integrations/emergent-sync.js');

const ORG = '00000000-0000-0000-0000-000000000001';
const DATA = {
  id: 'biz1_2026-08-01', business_id: 'biz1', business_name: 'Ashford', date: '2026-08-01',
  notes: 'Busy summer month',
  revenue: 95000, gross_profit: 60400.0, net_profit: 21220.0,
  total_cost_of_sales: 34600.0, total_operating_expenses: 39180.0,
  cash_collected: 88500, tx_accepted_amount: 81000, bank_balance: 52400, average_wait_time: 11,
  principal_fees: 18000, principal_fees_notes: '3 associates',
  hygienist_therapist: 6500, lab_fees: 4200, materials: 5100, sedation_services: 800,
  advertising_marketing: 7500, advertising_marketing_notes: 'Meta + Google',
  bank_charges: 150, business_rates_rent: 5200, salaries_staff_cost: 21000, telephone_wifi: 180,
  utilities: 1300, insurance: 850, management_fees: 2000, subscriptions: 420, it_expenses: 300,
  card_machine_charges: 280,
  locum_cover: 1750, // custom line a CEO added (extra="allow")
  created_at: '2026-07-14T12:01:07.914529+00:00', created_by: 'user-1',
  last_updated_at: '2026-07-14T12:01:07.913839+00:00', last_updated_by: 'user-1',
  last_updated_by_email: 'demo@dental.com',
};

describe('mapMonthlyPl', () => {
  it('maps headline roll-ups to pence', () => {
    const r = mapMonthlyPl(DATA, ORG);
    expect(r.revenue_pence).toBe(9500000);
    expect(r.net_profit_pence).toBe(2122000);
    expect(r.total_cost_of_sales_pence).toBe(3460000);
    expect(r.cash_collected_pence).toBe(8850000);
    expect(r.bank_balance_pence).toBe(5240000);
  });
  it('keeps average_wait_time as a non-money numeric', () => {
    expect(mapMonthlyPl(DATA, ORG).average_wait_time).toBe(11);
  });
  it('maps known cost-of-sales and opex lines to typed pence columns', () => {
    const r = mapMonthlyPl(DATA, ORG);
    expect(r.principal_fees_pence).toBe(1800000);
    expect(r.materials_pence).toBe(510000);
    expect(r.advertising_marketing_pence).toBe(750000);
    expect(r.card_machine_charges_pence).toBe(28000);
  });
  it('routes an unknown line into custom_lines (pence) and never loses it', () => {
    expect(mapMonthlyPl(DATA, ORG).custom_lines).toEqual({ locum_cover: 175000 });
  });
  it('collects every *_notes into line_notes keyed by line', () => {
    expect(mapMonthlyPl(DATA, ORG).line_notes).toEqual({
      principal_fees: '3 associates', advertising_marketing: 'Meta + Google',
    });
  });
  it('maps keys, month and audit fields', () => {
    const r = mapMonthlyPl(DATA, ORG);
    expect(r.organisation_id).toBe(ORG);
    expect(r.period_month).toBe('2026-08-01');
    expect(r.external_id).toBe(monthlyPlExternalId(DATA));
    expect(r.notes).toBe('Busy summer month');
    expect(r.last_updated_by_email).toBe('demo@dental.com');
    expect(r.raw).toBe(DATA);
  });
});
