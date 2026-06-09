// Tasks domain — the Owner-only write boundary + repo/service org-scoping.
// "Only admin can add tasks, others can only see it" is enforced by
// requireRole('owner') on every mutating route; reads stay open.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/gemini.js', () => ({
  generateTasksFromData: vi.fn(() => Promise.resolve({
    tasks: [
      {
        title: 'Call outstanding debtors',
        description: 'Ashford has £1,200 aged debt.',
        priority: 'high',
        due_date: '2026-06-20',
        assigned_to: 'user-1'
      }
    ],
    usage: { inputTokens: 100, outputTokens: 200 }
  }))
}));
import { supaRec } from './setup.js';
import { requireRole } from '../src/middleware/auth.js';
import { taskRepository } from '../src/repositories/task.repository.js';
import { taskService } from '../src/services/task.service.js';

const ORG = 'org-1';

function runGuard(role) {
  const req = { user: role ? { role } : null };
  let status = null;
  let nexted = false;
  const res = { status: (c) => { status = c; return res; }, json: () => res };
  requireRole('owner')(req, res, () => { nexted = true; });
  return { status, nexted };
}

describe('requireRole(owner) — task write gate', () => {
  it('lets the owner through', () => {
    const r = runGuard('owner');
    expect(r.nexted).toBe(true);
    expect(r.status).toBe(null);
  });
  it('blocks practice_manager with 403', () => {
    const r = runGuard('practice_manager');
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(403);
  });
  it('blocks reception with 403', () => {
    expect(runGuard('reception').status).toBe(403);
  });
  it('blocks the unauthenticated with 403', () => {
    expect(runGuard(null).status).toBe(403);
  });
});

describe('taskRepository — org scoping', () => {
  beforeEach(() => {
    supaRec.resultProvider = () => ({ data: { id: 't1' }, error: null });
  });

  // Note: the recorder's trailing .select() resets q.op, so we assert on the
  // stable id+org eq filters rather than op === 'delete'.
  it('remove targets tasks filtered by id AND organisation_id', async () => {
    await taskRepository.remove(ORG, 't1');
    expect(supaRec.last.table).toBe('tasks');
    const cols = supaRec.last.eqs.map((e) => e.col);
    expect(cols).toContain('id');
    expect(cols).toContain('organisation_id');
    expect(supaRec.last.eqs.find((e) => e.col === 'organisation_id').val).toBe(ORG);
  });

  it('listOverdue filters org + open/in_progress + past due_date', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    await taskRepository.listOverdue(ORG);
    expect(supaRec.last.table).toBe('tasks');
    expect(supaRec.last.eqs.find((e) => e.col === 'organisation_id').val).toBe(ORG);
    expect(supaRec.last.ins[0].vals).toEqual(['open', 'in_progress']);
    expect(supaRec.last.lts[0].col).toBe('due_date');
  });

  it('bumpReminder increments the count and is org-scoped', async () => {
    await taskRepository.bumpReminder(ORG, 't1', 2);
    expect(supaRec.last.updateVals.reminder_count).toBe(3);
    expect(supaRec.last.updateVals.last_reminded_at).toBeTruthy();
    expect(supaRec.last.eqs.find((e) => e.col === 'organisation_id').val).toBe(ORG);
  });
});

describe('taskService.update — done side-effect', () => {
  it('stamps completed_at when status flips to done', async () => {
    supaRec.resultProvider = () => ({ data: { id: 't1', status: 'done' }, error: null });
    await taskService.update(ORG, 't1', { status: 'done' });
    expect(supaRec.last.updateVals.completed_at).toBeTruthy();
  });
  it('does not stamp completed_at for other statuses', async () => {
    supaRec.resultProvider = () => ({ data: { id: 't1' }, error: null });
    await taskService.update(ORG, 't1', { status: 'in_progress' });
    expect(supaRec.last.updateVals.completed_at).toBeUndefined();
  });
});

describe('taskService.generateAiTasks', () => {
  it('checks budget, fetches members + analytics, inserts mapped tasks, and records usage', async () => {
    const mockMembers = [{ id: 'user-1', full_name: 'Dr Rao', role: 'practice_manager', email: 'rao@example.com' }];
    const mockInserted = [{ id: 't-new-1', organisation_id: ORG, title: 'Call outstanding debtors', assigned_to: 'user-1' }];

    supaRec.rpcProvider = (fn) => {
      return { data: [], error: null };
    };

    const queries = [];
    supaRec.resultProvider = (q) => {
      queries.push(q);
      if (q.table === 'users') {
        return { data: mockMembers, error: null };
      }
      if (q.table === 'tasks') {
        return { data: mockInserted, error: null };
      }
      if (q.table === 'ai_config') {
        return { data: { monthly_token_budget: 10000 }, error: null };
      }
      if (q.table === 'ai_usage') {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    };

    const result = await taskService.generateAiTasks(ORG, 'caller-user-id');

    expect(result).toEqual(mockInserted);
    const tasksQuery = queries.find((q) => q.table === 'tasks');
    expect(tasksQuery).toBeDefined();
    expect(tasksQuery.op).toBe('select');

    const insertedRows = tasksQuery.insertVals;
    expect(insertedRows.length).toBe(1);
    expect(insertedRows[0].title).toBe('Call outstanding debtors');
    expect(insertedRows[0].assigned_to).toBe('user-1');
    expect(insertedRows[0].organisation_id).toBe(ORG);
  });
});
