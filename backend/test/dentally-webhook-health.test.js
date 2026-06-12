import { describe, it, expect } from 'vitest';
import { __test } from '../src/lib/integrations/dentally-sync.js';

const { classifyWebhook } = __test;
const ORG = '1a5f888a-0dfe-4802-acf8-6003665089ad';
const B64 = Buffer.from(ORG).toString('base64url');
const ourUrl = `https://app.example.com/webhooks/dentally/${B64}.sigpart`;

describe('classifyWebhook', () => {
  it('returns unregistered when no webhook points at our org endpoint', () => {
    const r = classifyWebhook([{ id: 1, url: 'https://other.com/webhooks/dentally/xyz', active: true }], ORG);
    expect(r.registered).toBe(false);
    expect(r.status).toBe('unregistered');
  });

  it('flags a disabled webhook (auto-disabled after failures)', () => {
    const r = classifyWebhook([{ id: 82890, url: ourUrl, active: false, failed_deliveries: 50, successful_deliveries: 0, last_delivered_at: null }], ORG);
    expect(r.registered).toBe(true);
    expect(r.status).toBe('disabled');
    expect(r.failedDeliveries).toBe(50);
    expect(r.id).toBe(82890);
  });

  it('flags active-but-every-delivery-failing (secret mismatch)', () => {
    const r = classifyWebhook([{ id: 5, url: ourUrl, active: true, failed_deliveries: 12, successful_deliveries: 0 }], ORG);
    expect(r.status).toBe('failing');
  });

  it('reports delivering when there are successful deliveries', () => {
    const r = classifyWebhook([{ id: 5, url: ourUrl, active: true, failed_deliveries: 1, successful_deliveries: 99, last_delivered_at: '2026-06-12T03:00:00Z' }], ORG);
    expect(r.status).toBe('delivering');
    expect(r.successfulDeliveries).toBe(99);
  });

  it('reports idle when active with no deliveries yet', () => {
    const r = classifyWebhook([{ id: 5, url: ourUrl, active: true, failed_deliveries: 0, successful_deliveries: 0 }], ORG);
    expect(r.status).toBe('idle');
  });

  it('matches our org by token payload, ignoring other orgs sharing the host', () => {
    const otherB64 = Buffer.from('00000000-0000-0000-0000-000000000000').toString('base64url');
    const list = [
      { id: 1, url: `https://app.example.com/webhooks/dentally/${otherB64}.s`, active: true, successful_deliveries: 5 },
      { id: 2, url: ourUrl, active: false, failed_deliveries: 3, successful_deliveries: 0 },
    ];
    const r = classifyWebhook(list, ORG);
    expect(r.id).toBe(2);
    expect(r.status).toBe('disabled');
  });
});
