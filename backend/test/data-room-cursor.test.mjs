import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../src/lib/data-room/cursor.js';
import { AppError } from '../src/middleware/errors.js';

describe('cursor round-trip', () => {
  it('event cursor (date + uuid) survives encode/decode', () => {
    const c = { d: '2026-08-01T09:00:00.000Z', id: '4f6a2f1e-1b1c-4d3e-9a8b-0c1d2e3f4a5b' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('roster cursor (id only) round-trips with d null', () => {
    const c = { d: null, id: '4f6a2f1e-1b1c-4d3e-9a8b-0c1d2e3f4a5b' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('derived cursor (numeric offset) round-trips', () => {
    expect(decodeCursor(encodeCursor({ d: null, id: 40 }))).toEqual({ d: null, id: 40 });
  });
  it('is URL-safe (no + / =)', () => {
    const s = encodeCursor({ d: '2026-08-01T09:00:00.000+01:00', id: 'abc' });
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('decodeCursor rejects garbage with a 400', () => {
  for (const bad of ['', 'not-base64!!', Buffer.from('"just a string"').toString('base64url'),
    Buffer.from('{"d":1,"id":"x"}').toString('base64url'),
    Buffer.from('{"d":null}').toString('base64url'),
    Buffer.from('{"d":null,"id":{"a":1}}').toString('base64url')]) {
    it(`rejects ${JSON.stringify(bad).slice(0, 30)}`, () => {
      expect(() => decodeCursor(bad)).toThrow(AppError);
      try { decodeCursor(bad); } catch (e) { expect(e.statusCode).toBe(400); }
    });
  }
});
