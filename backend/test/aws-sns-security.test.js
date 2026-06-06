import { describe, it, expect } from 'vitest';
import { isSnsHost, confirmSubscription } from '../src/lib/aws-sns.js';

describe('isSnsHost (SSRF allowlist)', () => {
    it('accepts a real SNS cert/subscribe host', () => {
        expect(isSnsHost('https://sns.eu-west-2.amazonaws.com/SimpleNotificationService-abc.pem')).toBe(true);
    });
    it('rejects a lookalike suffix host', () => {
        expect(isSnsHost('https://sns.eu-west-2.amazonaws.com.attacker.com/x.pem')).toBe(false);
    });
    it('rejects an internal/metadata host', () => {
        expect(isSnsHost('http://169.254.169.254/latest/meta-data/')).toBe(false);
        expect(isSnsHost('http://localhost:8080/internal')).toBe(false);
    });
    it('rejects garbage', () => {
        expect(isSnsHost('not a url')).toBe(false);
    });
});

describe('confirmSubscription SSRF guard', () => {
    it('refuses a non-SNS SubscribeURL without making a request', async () => {
        await expect(confirmSubscription('http://169.254.169.254/x')).rejects.toThrow(/non-SNS/);
    });
});
