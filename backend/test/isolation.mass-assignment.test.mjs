// Cross-org regression (isolation audit A4): a PATCH body must never be able
// to re-home a row into another tenant. The UPDATE's WHERE is org-scoped, so
// the row selected is always the caller's — but before this guard the SET was
// not, and `organisation_id` was a writable column on the two freeform patch
// schemas. Neither route carries a role gate, so ANY authenticated tenant user
// could have done it.
import { describe, it, expect } from 'vitest';
import { contactUpdateSchema } from '../src/models/contact.model.js';
import { appointmentUpdateSchema } from '../src/models/appointment.model.js';

const VICTIM = '00000000-0000-0000-0000-0000000000b0';

describe('freeform patch schemas strip tenancy', () => {
  it('contact patch drops organisation_id but keeps real fields', () => {
    const parsed = contactUpdateSchema.parse({
      first_name: 'Ann',
      organisation_id: VICTIM,
      pms_external_id: 'collide-with-victim-dedup-key',
    });
    expect(parsed.organisation_id).toBeUndefined();
    expect(parsed.first_name).toBe('Ann');
    // Non-tenancy fields still pass through — this guard is about tenancy only.
    expect(parsed.pms_external_id).toBe('collide-with-victim-dedup-key');
  });

  it('appointment patch drops organisation_id but keeps real fields', () => {
    const parsed = appointmentUpdateSchema.parse({
      status: 'no_show',
      organisation_id: VICTIM,
    });
    expect(parsed.organisation_id).toBeUndefined();
    expect(parsed.status).toBe('no_show');
  });

  it('row identity (id, created_at) is not patchable either', () => {
    const parsed = contactUpdateSchema.parse({ id: 'other-row', created_at: '2020-01-01', notes: 'x' });
    expect(parsed).toEqual({ notes: 'x' });
  });
});
