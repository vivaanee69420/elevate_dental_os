import { describe, it, expect } from 'vitest';
import { integrationConnectSchema } from '../src/models/integration.model.js';

describe('integrationConnectSchema.method', () => {
  it('accepts method oauth/key and defaults to undefined', () => {
    expect(integrationConnectSchema.parse({ provider: 'dentally', method: 'oauth' }).method).toBe('oauth');
    expect(integrationConnectSchema.parse({ provider: 'dentally', method: 'key' }).method).toBe('key');
    expect(integrationConnectSchema.parse({ provider: 'dentally' }).method).toBeUndefined();
  });
  it('rejects an unknown method', () => {
    expect(() => integrationConnectSchema.parse({ provider: 'dentally', method: 'nope' })).toThrow();
  });
});
