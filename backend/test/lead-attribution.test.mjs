import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    pipelineChannelMap: vi.fn(async () => []),
    adLeadsInWindow: vi.fn(async () => []),
    acceptedContactsInWindow: vi.fn(async () => []),
    acceptedForMatching: vi.fn(async () => []),
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
    cockpitRepository.acceptedForMatching.mockImplementation(async () => [
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

  it('scopes channels[]/scoped to the practice while group stays org-wide — from ONE org-wide load', async () => {
    cockpitRepository.pipelineChannelMap.mockImplementation(async () => [
      { pipeline_id: 'g1', name: '2. Google Ads Leads', practice_id: 'P1', practice_label: 'Ashford' },
      { pipeline_id: 'g2', name: '2. Google Ads Leads', practice_id: 'P2', practice_label: 'Maidstone' },
    ]);
    cockpitRepository.adLeadsInWindow.mockImplementation(async () => [
      { id: 'l1', contact_id: 'c1', ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: {} },
      { id: 'l2', contact_id: 'c2', ghl_pipeline_id: 'g2', practice_id: 'P2', contacts: {} },
    ]);
    cockpitRepository.acceptedForMatching.mockImplementation(async () => []);
    cockpitRepository.adSpendByProvider.mockImplementation(async () => ({ google_ads: 40000, meta_ads: 0 }));

    const r = await leadAttributionService.channelBreakdown('org1', { since: '2026-07-01', until: '2026-07-15', practiceId: 'P1' });
    // The scoped view shows only P1's lead...
    expect(r.channels.find((c) => c.channel === 'google').leads).toBe(1);
    expect(r.scoped.google.leads).toBe(1);
    // ...but the group total it is compared against still counts both.
    expect(r.group.google.leads).toBe(2);
    expect(r.groupChannels.google.leads).toBe(2);
    expect(r.groupChannels.google.cplPence).toBe(20000); // 40000 / 2

    // The repo reads are NOT practice-filtered — scoping happens after
    // matching, so a practice with no GHL subaccount can no longer show 0
    // leads next to a non-zero group total without explanation.
    expect(cockpitRepository.adLeadsInWindow).toHaveBeenCalledWith('org1', '2026-07-01', '2026-07-15');
    expect(cockpitRepository.pipelineChannelMap).toHaveBeenCalledWith('org1');
  });

  it('scoped is null when no practice is selected', async () => {
    cockpitRepository.pipelineChannelMap.mockImplementation(async () => []);
    cockpitRepository.adLeadsInWindow.mockImplementation(async () => []);
    cockpitRepository.acceptedForMatching.mockImplementation(async () => []);
    cockpitRepository.adSpendByProvider.mockImplementation(async () => ({ google_ads: 0, meta_ads: 0 }));
    const r = await leadAttributionService.channelBreakdown('org1', { since: '2026-07-01', until: '2026-07-15' });
    expect(r.scoped).toBeNull();
  });
});

describe('matchBreakdown — counts people, not opportunity rows', () => {
  const pipes = [
    { pipeline_id: 'g1', name: '1. Google Ads Leads', practice_id: 'P1', practice_label: 'Ashford', account_id: 'A1', account_label: 'Ashford' },
    { pipeline_id: 'g2', name: 'Google ads marketing pipeline', practice_id: 'P1', practice_label: 'Ashford', account_id: 'A1', account_label: 'Ashford' },
  ];

  it('counts one contact sitting in two pipelines of the same channel ONCE (entries keeps the raw row count)', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: { phone: '07700 900111' } },
      { id: 'l2', contact_id: 'c1', ghl_pipeline_id: 'g2', practice_id: 'P1', contacts: { phone: '07700 900111' } },
      { id: 'l3', contact_id: 'c2', ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: { phone: '07700 900222' } },
    ];
    const r = matchBreakdown(pipes, leads, []);
    const g = r.channels.find((c) => c.channel === 'google');
    expect(g.leads).toBe(2);    // two people
    expect(g.entries).toBe(3);  // three pipeline rows
    expect(r.group.google.leads).toBe(2);
  });

  it('does not double-count a conversion when the converted person is in two pipelines', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: { phone: '07700 900111' } },
      { id: 'l2', contact_id: 'c1', ghl_pipeline_id: 'g2', practice_id: 'P1', contacts: { phone: '07700 900111' } },
    ];
    const accepted = [
      { practice_id: 'P1', value_pence: 450000, phone: '+44 7700 900111', email: null, raw: {} },
    ];
    const r = matchBreakdown(pipes, leads, accepted);
    const g = r.channels.find((c) => c.channel === 'google');
    expect(g.conversions).toBe(1);
    expect(g.matchedValuePence).toBe(450000); // not 900000
  });
});

describe('matchBreakdown — subaccounts with no practice are bucketed, not counted', () => {
  // A GHL location that isn't a dental practice (an academy / accounting
  // location) has no practice mapping. Its leads must not inflate a
  // practice's Google/Facebook numbers, and must not vanish silently either.
  const pipes = [
    { pipeline_id: 'g1', name: '1. Google Ads Leads', practice_id: 'P1', practice_label: 'Ashford', account_id: 'A1', account_label: 'Ashford' },
    { pipeline_id: 'fbX', name: 'Diploma Facebook Ads July 26', practice_id: null, practice_label: null, account_id: 'A9', account_label: 'Academy' },
  ];
  const leads = [
    { id: 'l1', contact_id: 'c1', ghl_pipeline_id: 'g1', practice_id: 'P1', contacts: {} },
    { id: 'l2', contact_id: 'c2', ghl_pipeline_id: 'fbX', practice_id: null, contacts: {} },
    { id: 'l3', contact_id: 'c3', ghl_pipeline_id: 'fbX', practice_id: null, contacts: {} },
  ];

  it('excludes unmapped-subaccount leads from the group totals', () => {
    const r = matchBreakdown(pipes, leads, []);
    expect(r.group.google.leads).toBe(1);
    expect(r.group.facebook.leads).toBe(0);       // the academy's 2 do not count
    expect(r.channels.every((c) => c.practiceId !== null)).toBe(true);
  });

  it('reports them in unmapped, per subaccount, so nothing disappears silently', () => {
    const r = matchBreakdown(pipes, leads, []);
    expect(r.unmapped.leads).toBe(2);
    expect(r.unmapped.accounts).toEqual([{ accountId: 'A9', label: 'Academy', leads: 2 }]);
  });
});
