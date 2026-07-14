import { describe, it, expect } from 'vitest';
const { classifyChannel, matchBreakdown } = await import('../src/services/lead-attribution.service.js');

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
