// AppError machine-readable `code` — surfaced in the error body only when set,
// so gated 403s can carry { error, code: 'FEATURE_DISABLED' } without every
// existing 2-arg AppError call site growing a code field.
import { describe, it, expect, vi } from 'vitest';
import { AppError, errorHandler } from '../src/middleware/errors.js';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const req = { method: 'GET', originalUrl: '/x' };

describe('AppError code surfacing', () => {
  it('includes code in the body when the AppError carries one', () => {
    const res = mockRes();
    errorHandler(new AppError('Feature not enabled', 403, 'FEATURE_DISABLED'), req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
  });

  it('omits code entirely for 2-arg AppErrors', () => {
    const res = mockRes();
    errorHandler(new AppError('Not found', 404), req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ error: 'Not found' });
    expect('code' in body).toBe(false);
  });
});
