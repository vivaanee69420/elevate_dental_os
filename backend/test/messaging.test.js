import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { getByProvider: vi.fn(async () => null) }, // no per-tenant override
}));
vi.mock('../src/lib/aws-ses.js', () => ({ sendEmail: vi.fn(async () => 'ses-msg-1') }));
vi.mock('../src/lib/aws-sns.js', () => ({ sendSMS: vi.fn(async () => 'sns-msg-1') }));
vi.mock('../src/lib/postmark.js', () => ({ sendEmail: vi.fn(async () => 'pm-1') }));
vi.mock('../src/lib/twilio.js', () => ({ sendSMS: vi.fn(async () => 'tw-1') }));
vi.mock('../src/lib/supabase.js', () => ({
    serviceClient: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import { sendEmail, sendSMS } from '../src/lib/messaging.js';
import * as ses from '../src/lib/aws-ses.js';
import * as sns from '../src/lib/aws-sns.js';
import * as postmark from '../src/lib/postmark.js';
import * as twilio from '../src/lib/twilio.js';

beforeEach(() => { vi.clearAllMocks(); delete process.env.USE_LEGACY_EMAIL; delete process.env.USE_LEGACY_SMS; });

describe('messaging platform fallback', () => {
    it('routes email to SES by default', async () => {
        const r = await sendEmail({ orgId: 'o1', to: 'a@b.com', subject: 's', body: 'b' });
        expect(ses.sendEmail).toHaveBeenCalledOnce();
        expect(postmark.sendEmail).not.toHaveBeenCalled();
        expect(r.provider).toBe('ses');
        expect(r.external_id).toBe('ses-msg-1');
    });
    it('routes sms to SNS by default', async () => {
        const r = await sendSMS({ orgId: 'o1', to: '+447700900000', body: 'b' });
        expect(sns.sendSMS).toHaveBeenCalledOnce();
        expect(twilio.sendSMS).not.toHaveBeenCalled();
        expect(r.provider).toBe('sns_sms');
    });
    it('uses Postmark when USE_LEGACY_EMAIL=true', async () => {
        process.env.USE_LEGACY_EMAIL = 'true';
        const r = await sendEmail({ orgId: 'o1', to: 'a@b.com', subject: 's', body: 'b' });
        expect(postmark.sendEmail).toHaveBeenCalledOnce();
        expect(ses.sendEmail).not.toHaveBeenCalled();
        expect(r.provider).toBe('postmark');
    });
    it('uses Twilio when USE_LEGACY_SMS=true', async () => {
        process.env.USE_LEGACY_SMS = 'true';
        const r = await sendSMS({ orgId: 'o1', to: '+447700900000', body: 'b' });
        expect(twilio.sendSMS).toHaveBeenCalledOnce();
        expect(sns.sendSMS).not.toHaveBeenCalled();
        expect(r.provider).toBe('twilio');
    });
});
