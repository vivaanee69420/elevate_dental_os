// Cross-org regression (isolation audit A4): a body-supplied FK belonging to
// ANOTHER organisation must be refused before it is stored.
//
// Why this matters more than it looks: the row itself was always org-stamped
// correctly, so `.eq('organisation_id', orgId)` passed on every read. But
// PostgREST *embedded* resources (`contact:contacts(...)`) resolve the FK as a
// join under serviceClient, which bypasses RLS and applies no org predicate of
// its own. A stored foreign id therefore became a cross-org PII read on the
// next list call. Validating on the way IN closes the whole class.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/repositories/task.repository.js', () => ({
  taskRepository: { create: vi.fn(async () => ({ data: { id: 't1' }, error: null })) },
}));
vi.mock('../src/repositories/payment.repository.js', () => ({
  paymentRepository: { insertManual: vi.fn(async () => ({ data: { id: 'p1' }, error: null })) },
}));
vi.mock('../src/repositories/comm.repository.js', () => ({
  commRepository: { create: vi.fn(async () => ({ data: { id: 'c1' }, error: null })) },
}));

const { taskRepository } = await import('../src/repositories/task.repository.js');
const { paymentRepository } = await import('../src/repositories/payment.repository.js');
const { commRepository } = await import('../src/repositories/comm.repository.js');
const { taskService } = await import('../src/services/task.service.js');
const { paymentService } = await import('../src/services/payment.service.js');
const { commService } = await import('../src/services/comm.service.js');

const ORG = 'org-a';
const FOREIGN = '00000000-0000-0000-0000-0000000000b1';

// Ownership probes hit `.select('id').eq('id',…).eq('organisation_id',…)`.
// `owned` decides whether the probed row is ours.
function ownership(owned) {
  supaRec.resultProvider = (q) => {
    const probesId = (q.eqs || []).some((e) => e.col === 'id');
    const probesOrg = (q.eqs || []).some((e) => e.col === 'organisation_id');
    if (probesId && probesOrg) return { data: owned ? { id: 'x' } : null, error: null };
    return { data: [], error: null };
  };
}

beforeEach(() => { vi.clearAllMocks(); ownership(false); });

describe('foreign FK is refused before the write', () => {
  it('task: a foreign assignee 404s and no task is created', async () => {
    await expect(taskService.create(ORG, { title: 'x', assigned_to: FOREIGN }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(taskRepository.create).not.toHaveBeenCalled();
  });

  it('payment: a foreign contact 404s and nothing is inserted', async () => {
    await expect(paymentService.createManual(ORG, {
      practice_id: FOREIGN, amount_pence: 1000,
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(paymentRepository.insertManual).not.toHaveBeenCalled();
  });

  it('comm: a foreign contact 404s before any message is sent or stored', async () => {
    await expect(commService.send(ORG, {
      channel: 'email', to: 'a@b.dev', body: 'x', contact_id: FOREIGN,
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(commRepository.create).not.toHaveBeenCalled();
  });
});

describe('owned FKs still pass', () => {
  beforeEach(() => ownership(true));

  it('task with an assignee from our own org is created', async () => {
    await taskService.create(ORG, { title: 'x', assigned_to: 'ours' });
    expect(taskRepository.create).toHaveBeenCalledOnce();
    // The trusted org id wins over anything in the body (spread ordering).
    expect(taskRepository.create.mock.calls[0][0].organisation_id).toBe(ORG);
  });

  it('a task with no assignee needs no ownership probe at all', async () => {
    await taskService.create(ORG, { title: 'x' });
    expect(taskRepository.create).toHaveBeenCalledOnce();
  });
});
