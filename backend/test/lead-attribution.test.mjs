import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    pipelineChannelMap: vi.fn(async () => []),
    adLeadsInWindow: vi.fn(async () => []),
    acceptedContactsInWindow: vi.fn(async () => []),
    adSpendByProvider: vi.fn(async () => ({ google_ads: 0, meta_ads: 0 })),
  },
}));

const { classifyChannel, matchBreakdown, normName, leadAttributionService } = await import('../src/services/lead-attribution.service.js');
const { cockpitRepository } = await import('../src/repositories/cockpit.repository.js');

describe('classifyChannel', () => {
  it('maps facebook/google/instagram/website pipeline names, else other (never null)', () => {
    expect(classifyChannel('1. Facebook Ads Leads')).toBe('facebook');
    expect(classifyChannel('2. Google Ads Leads')).toBe('google');
    expect(classifyChannel('Fts Google ads marketing pipeline')).toBe('google');
    expect(classifyChannel('Website enquiries')).toBe('website');
    expect(classifyChannel('IG Lead Engine')).toBe('instagram');
    expect(classifyChannel('Dental Patient Pipeline')).toBe('other');
  });
});

describe('matchBreakdown (pure)', () => {
  const pipes = [
    { pipeline_id: 'fb1', name: '1. Facebook Ads Leads', practice_id: 'P1' },
    { pipeline_id: 'g1', name: '2. Google Ads Leads', practice_id: 'P1' },
  ];
  const leads = [
    { id: 'l1', ghl_pipeline_id: 'fb1', practice_id: 'P1', contacts: { phone: '07700 900 111', email: 'a@b.com' } },
    { id: 'l2', ghl_pipeline_id: 'fb1', practice_id: 'P1', contacts: { phone: '07700 900 222', email: 'x@y.com' } },
    { id: 'l3', ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: { phone: null, email: 'g@lead.com' } },
  ];
  const accepted = [
    { practice_id: 'P1', value_pence: 450000, phone: '+44 7700 900111', email: null, raw: {} },
    { practice_id: 'P1', value_pence: 120000, phone: null, email: 'G@LEAD.com', raw: {} },
  ];
  it('counts leads + matched conversions per practice/channel by phone or email', () => {
    const r = matchBreakdown(pipes, leads, accepted);
    const fb = r.channels.find((c) => c.channel === 'facebook');
    const g = r.channels.find((c) => c.channel === 'google');
    expect(fb.leads).toBe(2);
    expect(fb.conversions).toBe(1);          // l1 matched by phone (last-10 digits)
    expect(fb.matchedValuePence).toBe(450000);
    expect(g.leads).toBe(1);
    expect(g.conversions).toBe(1);           // l3 matched by email (case-insensitive)
    expect(g.matchedValuePence).toBe(120000);
  });

  it('tags each grouped channel with pipelineId/pipelineName + tags every per-lead row', () => {
    const r = matchBreakdown(pipes, leads, accepted);
    const fb = r.channels.find((c) => c.channel === 'facebook');
    const g = r.channels.find((c) => c.channel === 'google');
    expect(fb.pipelineId).toBe('fb1');
    expect(fb.pipelineName).toBe('1. Facebook Ads Leads');
    expect(fb.channel).toBe('facebook');
    expect(g.pipelineId).toBe('g1');
    expect(g.pipelineName).toBe('2. Google Ads Leads');
    expect(g.channel).toBe('google');

    expect(r.leads).toHaveLength(3);
    const l1 = r.leads.find((l) => l.id === 'l1');
    expect(l1.pipelineId).toBe('fb1');
    expect(l1.pipelineName).toBe('1. Facebook Ads Leads');
    expect(l1.channel).toBe('facebook');
  });
});

describe('normName', () => {
  it('normalises first+last or a single full name: lowercase, trimmed, whitespace collapsed', () => {
    expect(normName('Jane', 'Doe')).toBe('jane doe');
    expect(normName('  Jane   Doe  ')).toBe('jane doe');
    expect(normName('JANE', 'doe')).toBe('jane doe');
  });
  it('returns null for empty/blank input', () => {
    expect(normName('', '')).toBeNull();
    expect(normName(null)).toBeNull();
    expect(normName('   ')).toBeNull();
  });
});

describe('matchBreakdown — name matching (practice-scoped, last resort)', () => {
  const pipes = [
    { pipeline_id: 'fb1', name: '1. Facebook Ads Leads', practice_id: 'P1' },
    { pipeline_id: 'fb2', name: '1. Facebook Ads Leads', practice_id: 'P2' },
  ];

  it('matches by name only within the SAME practice, and the matched value carries treatmentName', () => {
    const leads = [
      { id: 'l1', ghl_pipeline_id: 'fb1', practice_id: 'P1', contacts: { phone: null, email: null, first_name: 'Jane', last_name: 'Doe' } },
    ];
    const accepted = [
      { practice_id: 'P1', value_pence: 450000, phone: null, email: null, patient_name: 'Jane Doe', treatment_name: 'Implant', accepted_date: '2026-07-02', raw: {} },
    ];
    const r = matchBreakdown(pipes, leads, accepted);
    const fb1 = r.channels.find((c) => c.practiceId === 'P1');
    expect(fb1.conversions).toBe(1);
    expect(fb1.matchedValuePence).toBe(450000);
  });

  it('does NOT convert a same-name lead in a DIFFERENT practice', () => {
    const leads = [
      { id: 'l2', ghl_pipeline_id: 'fb2', practice_id: 'P2', contacts: { phone: null, email: null, first_name: 'Jane', last_name: 'Doe' } },
    ];
    const accepted = [
      { practice_id: 'P1', value_pence: 450000, phone: null, email: null, patient_name: 'Jane Doe', treatment_name: 'Implant', accepted_date: '2026-07-02', raw: {} },
    ];
    const r = matchBreakdown(pipes, leads, accepted);
    const fb2 = r.channels.find((c) => c.practiceId === 'P2');
    expect(fb2.conversions).toBe(0);
    expect(fb2.matchedValuePence).toBe(0);
  });

  it('preserves phone/email precedence over name', () => {
    const leads = [
      { id: 'l3', ghl_pipeline_id: 'fb1', practice_id: 'P1', contacts: { phone: '07700 900 111', email: null, first_name: 'Jane', last_name: 'Doe' } },
    ];
    const accepted = [
      // Phone matches, but the name on the accepted row is different — the
      // phone match must win (it's checked first, cross-practice).
      { practice_id: 'P1', value_pence: 100000, phone: '+44 7700 900111', email: null, patient_name: 'Someone Else', treatment_name: 'Whitening', accepted_date: '2026-07-01', raw: {} },
    ];
    const r = matchBreakdown(pipes, leads, accepted);
    const fb1 = r.channels.find((c) => c.practiceId === 'P1');
    expect(fb1.matchedValuePence).toBe(100000);
  });
});

describe('leadAttributionService.channelBreakdown groupChannels (org-wide CPL/ROI)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes org-wide cplPence and roi per channel, null-guarded', async () => {
    cockpitRepository.pipelineChannelMap.mockImplementation(async () => [
      { pipeline_id: 'g1', name: '2. Google Ads Leads', practice_id: 'P1', practice_label: 'Ashford' },
    ]);
    cockpitRepository.adLeadsInWindow.mockImplementation(async () => Array.from({ length: 10 }, (_, i) => ({
      id: `l${i}`, ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: { phone: null, email: `lead${i}@x.com` },
    })));
    cockpitRepository.acceptedContactsInWindow.mockImplementation(async () => [
      { practice_id: 'P1', value_pence: 200000, phone: null, email: 'lead0@x.com', patient_name: null, treatment_name: 'Implant', accepted_date: '2026-07-01', raw: {} },
    ]);
    cockpitRepository.adSpendByProvider.mockImplementation(async () => ({ google_ads: 100000, meta_ads: 0 }));

    const r = await leadAttributionService.channelBreakdown('org1', { since: '2026-07-01', until: '2026-07-15' });
    expect(r.groupChannels.google.leads).toBe(10);
    expect(r.groupChannels.google.conversions).toBe(1);
    expect(r.groupChannels.google.matchedValuePence).toBe(200000);
    expect(r.groupChannels.google.spendPence).toBe(100000);
    expect(r.groupChannels.google.cplPence).toBe(10000); // 100000 / 10
    expect(r.groupChannels.google.roi).toBeCloseTo(2); // 200000 / 100000
    expect(r.groupChannels.facebook.leads).toBe(0);
    expect(r.groupChannels.facebook.cplPence).toBeNull();
    expect(r.groupChannels.facebook.roi).toBeNull();
  });

  it('groupChannels stays org-wide even when practiceId scopes the request', async () => {
    cockpitRepository.pipelineChannelMap.mockImplementation(async (orgId, practiceId) => {
      const all = [
        { pipeline_id: 'g1', name: '2. Google Ads Leads', practice_id: 'P1', practice_label: 'Ashford' },
        { pipeline_id: 'g2', name: '2. Google Ads Leads', practice_id: 'P2', practice_label: 'Maidstone' },
      ];
      return practiceId ? all.filter((p) => p.practice_id === practiceId) : all;
    });
    cockpitRepository.adLeadsInWindow.mockImplementation(async (orgId, since, until, practiceId) => {
      const all = [
        { id: 'l1', ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: {} },
        { id: 'l2', ghl_pipeline_id: 'g2', practice_id: 'P2', contacts: {} },
      ];
      return practiceId ? all.filter((l) => l.practice_id === practiceId) : all;
    });
    cockpitRepository.acceptedContactsInWindow.mockImplementation(async () => []);
    cockpitRepository.adSpendByProvider.mockImplementation(async () => ({ google_ads: 40000, meta_ads: 0 }));

    const r = await leadAttributionService.channelBreakdown('org1', { since: '2026-07-01', until: '2026-07-15', practiceId: 'P1' });
    // Practice-scoped channels[] only reflects P1's single lead.
    expect(r.channels.find((c) => c.channel === 'google').leads).toBe(1);
    // groupChannels ignores practiceId — both P1 and P2 leads count.
    expect(r.groupChannels.google.leads).toBe(2);
    expect(r.groupChannels.google.cplPence).toBe(20000); // 40000 / 2
  });
});
