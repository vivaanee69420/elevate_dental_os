import { describe, it, expect } from 'vitest';
import { contactRow, upsertOpportunity, applyWebhookEvent } from '../src/lib/integrations/gohighlevel-sync.js';

describe('GHL practice_id stamping', () => {
  it('contactRow stamps the given practice_id', () => {
    const row = contactRow('org-1', { id: 'c1', firstName: 'Ann', email: 'A@x.com' }, 'prac-9');
    expect(row.practice_id).toBe('prac-9');
    expect(row.organisation_id).toBe('org-1');
    expect(row.source).toBe('gohighlevel');
  });
  it('contactRow omits practice_id when none given (back-compat null)', () => {
    const row = contactRow('org-1', { id: 'c1', firstName: 'Ann' });
    expect(row.practice_id ?? null).toBeNull();
  });
  it('upsertOpportunity writes practice_id on the lead row', async () => {
    let captured = null;
    const db = { from() { return {
      select() { return this; }, eq() { return this; }, ilike() { return this; },
      maybeSingle: async () => ({ data: { id: 'contact-1' } }),
      upsert: async (row) => { captured = row; return { error: null }; },
    }; } };
    const r = await upsertOpportunity('org-1', { id: 'opp-1', contact: { id: 'c1' } }, 'prac-9', {}, db, new Map([['c1', 'contact-1']]), null);
    expect(r.ok).toBe(true);
    expect(captured.practice_id).toBe('prac-9');
  });
});

describe('contactRow attribution', () => {
    it('stamps attribution and a capture timestamp when GHL sends it', () => {
        const r = contactRow('org-1', {
            id: 'c1', firstName: 'Ada', email: 'A@Example.com',
            attributions: [{ utmSessionSource: 'Paid Social', utmCampaignId: '120249721894530517',
                             utmAdId: '120249722055010517', isFirst: true }],
        }, 'practice-1', 'acct-1');
        expect(r.ad_campaign_id).toBe('120249721894530517');
        expect(r.ad_id).toBe('120249722055010517');
        expect(r.attribution_source).toBe('Paid Social');
        expect(typeof r.attribution_captured_at).toBe('string');
    });

    it('omits attribution keys entirely when there is none, so an upsert cannot null out a row that already has it', () => {
        const r = contactRow('org-1', { id: 'c2', firstName: 'Bob' }, null, null);
        expect(r).not.toHaveProperty('ad_campaign_id');
        expect(r).not.toHaveProperty('attribution_captured_at');
    });
});
