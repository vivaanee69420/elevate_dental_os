import { describe, it, expect } from 'vitest';
const { poundsToPence } = await import('../src/lib/integrations/emergent-sync.js');

describe('poundsToPence', () => {
  it('converts pounds (int/float) to integer pence', () => {
    expect(poundsToPence(4500)).toBe(450000);
    expect(poundsToPence(4500.0)).toBe(450000);
    expect(poundsToPence(1850.5)).toBe(185050);
    expect(poundsToPence(50)).toBe(5000);
  });
  it('rounds to the nearest penny', () => {
    expect(poundsToPence(12.345)).toBe(1235);
    expect(poundsToPence(12.344)).toBe(1234);
  });
  it('treats null/undefined/empty as 0', () => {
    expect(poundsToPence(null)).toBe(0);
    expect(poundsToPence(undefined)).toBe(0);
    expect(poundsToPence('')).toBe(0);
  });
});
