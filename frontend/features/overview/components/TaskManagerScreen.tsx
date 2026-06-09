'use client';
// Task Manager — Team & Owner Accountability. Live version backed by the real
// /api/tasks endpoints (was a mock with localStorage + fake roster).
//
// Permission model: reads are open to every role; ALL writes are Owner-only
// (enforced server-side with requireRole('owner')). Non-owners see the task
// list, KPIs, the overdue banner and the By-Person grouping, but get NO add
// form and no per-task action buttons — "only admin can add tasks, others can
// only see it". The UI gate here is cosmetic; the backend is the real boundary.
//
// British English throughout; no emojis. Status glyphs are symbols, not emoji.

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui';
import { useMe } from '@/hooks/useMe';
import { getTeam } from '@/features/system/api';
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  remindTask,
  remindOverdue,
  generateAiTasks,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@/features/overview/tasks-api';

// ── Display maps (match the DB enums) ──
const PRIORITY_COLOURS: Record<TaskPriority, string> = {
  urgent: 'var(--danger)',
  high: 'var(--warning)',
  normal: '#3B82F6',
  low: 'var(--ink-muted)',
};
const STATUS_COLOURS: Record<TaskStatus, string> = {
  open: 'var(--ink-soft)',
  in_progress: '#3B82F6',
  done: 'var(--success)',
  cancelled: 'var(--danger)',
};
const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};
const STATUS_GLYPH: Record<TaskStatus, string> = {
  open: '○',
  in_progress: '◐',
  done: '✓',
  cancelled: '×',
};

const PRIORITIES: TaskPriority[] = ['normal', 'high', 'urgent', 'low'];

type TabKey = 'all' | 'overdue' | 'person' | 'rules';

const REMINDER_RULES = [
  { n: '24h before due', d: 'Email + in-app reminder to the assignee 24 hours before the due date.', enabled: false },
  { n: 'On overdue', d: 'Daily 08:00 reminder to the assignee once a task becomes overdue (automatic cron).', enabled: true },
  { n: 'Manual nudge', d: 'Owner can send an ad-hoc reminder from any overdue task, copied to the owner.', enabled: true },
  { n: 'Weekly digest', d: 'Monday summary of open and overdue tasks per team member.', enabled: false },
];

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
function isOverdue(t: Task, today: string): boolean {
  return t.status !== 'done' && t.status !== 'cancelled' && !!t.due_date && t.due_date < today;
}
function assigneeName(t: Task): string {
  return t.assignee?.full_name?.trim() || 'Unassigned';
}
function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

// ── Single task row ──
function TaskRow({
  t,
  today,
  isOwner,
  onCycle,
  onRemind,
  onDelete,
}: {
  t: Task;
  today: string;
  isOwner: boolean;
  onCycle: (t: Task) => void;
  onRemind: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const overdue = isOverdue(t, today);
  const done = t.status === 'done';
  const name = assigneeName(t);
  const dueFormatted = t.due_date
    ? new Date(t.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'No date';

  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${overdue ? '#FECACA' : 'var(--border)'}`,
        borderLeft: `4px solid ${PRIORITY_COLOURS[t.priority]}`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 8,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto auto auto auto',
        gap: 14,
        alignItems: 'center',
      }}
    >
      <button
        onClick={() => isOwner && onCycle(t)}
        title={STATUS_LABELS[t.status]}
        disabled={!isOwner}
        style={{
          background: 'none',
          border: 'none',
          cursor: isOwner ? 'pointer' : 'default',
          fontSize: 18,
          padding: 0,
          color: STATUS_COLOURS[t.status],
        }}
      >
        {STATUS_GLYPH[t.status]}
      </button>
      <div>
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: done ? 'var(--ink-soft)' : 'var(--ink)',
            textDecoration: done ? 'line-through' : 'none',
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-muted)',
            marginTop: 2,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span>{STATUS_LABELS[t.status]}</span>
          {t.description ? (
            <>
              <span>·</span>
              <span style={{ opacity: 0.75 }}>
                {t.description.length > 60 ? `${t.description.substring(0, 60)}…` : t.description}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            width: 26,
            height: 26,
            background: t.assignee ? 'var(--brand)' : 'var(--ink-soft)',
            color: '#fff',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          {initials(name)}
        </div>
        <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>{name.split(' ')[0]}</span>
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          padding: '3px 9px',
          borderRadius: 5,
          background: `${PRIORITY_COLOURS[t.priority]}22`,
          color: PRIORITY_COLOURS[t.priority],
          letterSpacing: '.04em',
        }}
      >
        {t.priority}
      </span>
      <div
        style={{
          fontSize: 12,
          color: overdue ? 'var(--danger)' : '#475569',
          fontWeight: overdue ? 700 : 500,
        }}
      >
        {overdue ? 'Overdue · ' : ''}
        {dueFormatted}
      </div>
      {t.reminder_count > 0 ? (
        <span
          title={`${t.reminder_count} reminder(s) sent${t.last_reminded_at ? ` · last: ${new Date(t.last_reminded_at).toLocaleDateString('en-GB')}` : ''}`}
          style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}
        >
          {t.reminder_count} sent
        </span>
      ) : (
        <span />
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        {isOwner && overdue ? (
          <button
            onClick={() => onRemind(t.id)}
            style={{
              background: '#FEF3C7',
              color: '#92400E',
              border: '1px solid var(--warning)',
              padding: '4px 9px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Remind
          </button>
        ) : null}
        {isOwner ? (
          <button
            onClick={() => onDelete(t.id)}
            title="Delete"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ink-soft)',
              cursor: 'pointer',
              fontSize: 14,
              padding: 4,
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── KPI tile ──
function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs text-ink-muted mt-1">{sub}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--border)',
  borderRadius: 7,
  fontSize: 13,
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: 'var(--ink-muted)',
  letterSpacing: '.04em',
  display: 'block',
  marginBottom: 4,
};

/** Task Manager page. */
export default function TaskManagerScreen() {
  const today = useMemo(() => todayISO(), []);
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isOwner = me?.role === 'owner';

  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: listTasks });
  // Stable reference so the derived useMemos below don't recompute every render.
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  // Assignee roster — owner only (the members endpoint requires a manage perm).
  const teamQuery = useQuery({
    queryKey: ['team'],
    queryFn: getTeam,
    enabled: !!isOwner,
    staleTime: 5 * 60_000,
  });
  const team = teamQuery.data?.members ?? [];

  const [tab, setTab] = useState<TabKey>('all');

  // New-task form fields.
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('normal');
  const [newDue, setNewDue] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });

  const createMut = useMutation({ mutationFn: createTask, onSuccess: invalidate });
  const updateMut = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof updateTask>[1] }) =>
      updateTask(v.id, v.body),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({ mutationFn: deleteTask, onSuccess: invalidate });
  const remindMut = useMutation({ mutationFn: remindTask, onSuccess: invalidate });
  const remindAllMut = useMutation({
    mutationFn: remindOverdue,
    onSuccess: (r) => {
      invalidate();
      if (typeof window !== 'undefined')
        window.alert(`Reminders sent for ${r.reminded} of ${r.total} overdue task(s).`);
    },
  });

  const generateAiMut = useMutation({
    mutationFn: generateAiTasks,
    onSuccess: (res) => {
      invalidate();
      if (typeof window !== 'undefined')
        window.alert(`Successfully generated and assigned ${res.tasks.length} new tasks based on live practice metrics!`);
    },
    onError: (err) => {
      if (typeof window !== 'undefined')
        window.alert(`Failed to generate tasks: ${(err as Error).message}`);
    },
  });

  const handleGenerateAiTasks = () => {
    if (typeof window !== 'undefined' && !window.confirm('Would you like Elevate AI to analyze all practice data and auto-generate & assign 3-5 high-priority tasks for your team?')) {
      return;
    }
    generateAiMut.mutate();
  };

  const overdue = useMemo(() => tasks.filter((t) => isOverdue(t, today)), [tasks, today]);
  const dueToday = useMemo(
    () => tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled' && t.due_date === today),
    [tasks, today],
  );
  const completed = tasks.filter((t) => t.status === 'done').length;
  const assigneeCount = useMemo(
    () => new Set(tasks.map((t) => t.assigned_to).filter(Boolean)).size,
    [tasks],
  );

  function cycleStatus(t: Task) {
    const order: TaskStatus[] = ['open', 'in_progress', 'done'];
    const next = order[(order.indexOf(t.status as TaskStatus) + 1) % order.length];
    updateMut.mutate({ id: t.id, body: { status: next } });
  }

  function removeTask(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this task?')) return;
    deleteMut.mutate(id);
  }

  function addTask() {
    const title = newTitle.trim();
    if (!title) {
      if (typeof window !== 'undefined') window.alert('Enter a task title');
      return;
    }
    createMut.mutate(
      {
        title,
        description: newDesc.trim() || undefined,
        assigned_to: newAssignee || undefined,
        due_date: newDue || undefined,
        priority: newPriority,
      },
      {
        onSuccess: () => {
          setNewTitle('');
          setNewDesc('');
          setNewDue('');
          setNewAssignee('');
        },
      },
    );
  }

  const rowProps = { today, isOwner: !!isOwner, onCycle: cycleStatus, onRemind: remindMut.mutate, onDelete: removeTask };

  const tabs: { k: TabKey; l: string }[] = [
    { k: 'all', l: `All Tasks (${tasks.length})` },
    { k: 'overdue', l: `Overdue (${overdue.length})` },
    { k: 'person', l: 'By Person' },
    { k: 'rules', l: 'Reminder Rules' },
  ];

  // Group open tasks by assignee for the By-Person tab (derived from the task
  // join, so it works for every role without the members endpoint).
  const byPerson = useMemo(() => {
    const map = new Map<string, { name: string; tasks: Task[] }>();
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'cancelled') continue;
      const key = t.assigned_to ?? 'unassigned';
      if (!map.has(key)) map.set(key, { name: assigneeName(t), tasks: [] });
      map.get(key)!.tasks.push(t);
    }
    return [...map.values()].sort((a, b) => b.tasks.length - a.tasks.length);
  }, [tasks]);

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="display text-3xl font-bold">Task Manager &middot; Team &amp; Owner Accountability</h1>
          <p className="text-sm text-ink-muted mt-1">
            {isOwner
              ? 'Assign tasks across the team · auto-reminders fire daily on overdue · send manual nudges'
              : 'Tasks assigned across the team · only the owner can add or change tasks'}
          </p>
        </div>
        {isOwner ? (
          <button
            onClick={handleGenerateAiTasks}
            disabled={generateAiMut.isPending}
            style={{
              background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
              color: '#fff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: generateAiMut.isPending ? 'default' : 'pointer',
              opacity: generateAiMut.isPending ? 0.7 : 1,
              boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.2), 0 2px 4px -1px rgba(79, 70, 229, 0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
            }}
          >
            <span>{generateAiMut.isPending ? '✦ Analyzing & Generating…' : '✦ Generate AI Tasks'}</span>
          </button>
        ) : null}
      </div>

      {tasksQuery.isError ? (
        <div
          style={{
            background: '#FEE2E2',
            border: '1px solid var(--danger)',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 18,
            color: '#991B1B',
            fontSize: 13,
          }}
        >
          Could not load tasks: {(tasksQuery.error as Error)?.message ?? 'unknown error'}
        </div>
      ) : null}

      {/* KPI tiles */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        <Kpi label="Total Tasks" value={tasks.length.toString()} sub="across the team" />
        <Kpi label="Due Today" value={dueToday.length.toString()} sub={dueToday.length > 0 ? 'needs action' : 'all clear'} />
        <Kpi label="Overdue" value={overdue.length.toString()} sub={overdue.length > 0 ? 'auto-reminders firing' : 'on track'} />
        <Kpi label="Completed" value={completed.toString()} sub="marked done" />
        <Kpi label="Assignees" value={assigneeCount.toString()} sub="with open work" />
      </div>

      {/* Overdue banner */}
      {overdue.length > 0 ? (
        <div
          style={{
            background: '#FEE2E2',
            border: '1px solid var(--danger)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: '#991B1B', fontSize: 14 }}>
              {overdue.length} task{overdue.length > 1 ? 's' : ''} overdue
            </div>
            <div style={{ color: '#991B1B', fontSize: 12.5, marginTop: 2 }}>
              Auto-reminders email assignees daily at 08:00 · the owner can also nudge now
            </div>
          </div>
          {isOwner ? (
            <button
              onClick={() => remindAllMut.mutate()}
              disabled={remindAllMut.isPending}
              style={{
                background: '#991B1B',
                color: '#fff',
                border: 'none',
                padding: '9px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: remindAllMut.isPending ? 'default' : 'pointer',
                opacity: remindAllMut.isPending ? 0.7 : 1,
              }}
            >
              {remindAllMut.isPending ? 'Sending…' : 'Send All Reminders Now'}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Add-task form — owner only */}
      {isOwner ? (
        <div
          style={{
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 18,
            marginBottom: 18,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: '0 0 12px' }}>Add Task</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={labelStyle}>Task</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="What needs doing?"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Assignee</label>
              <select value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name || m.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as TaskPriority)} style={inputStyle}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Due</label>
              <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} style={inputStyle} />
            </div>
            <button
              onClick={addTask}
              disabled={createMut.isPending}
              style={{
                background: 'var(--brand)',
                color: '#fff',
                border: 'none',
                padding: '9px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: createMut.isPending ? 'default' : 'pointer',
                height: 38,
                opacity: createMut.isPending ? 0.7 : 1,
              }}
            >
              {createMut.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Optional notes..."
            style={{ ...inputStyle, marginTop: 8 }}
          />
        </div>
      ) : null}

      {/* Tabs */}
      <div
        style={{
          borderBottom: '1px solid var(--border)',
          marginBottom: 20,
          background: '#fff',
          borderRadius: '10px 10px 0 0',
          padding: '0 16px',
        }}
      >
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {tabs.map((t) => {
            const active = tab === t.k;
            return (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                style={{
                  padding: '14px',
                  border: 'none',
                  background: 'none',
                  borderBottom: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
                  color: active ? 'var(--brand)' : 'var(--ink-muted)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t.l}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab body */}
      {tasksQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-muted)' }}>Loading tasks…</div>
      ) : null}

      {!tasksQuery.isLoading && tab === 'all' &&
        (tasks.length > 0 ? (
          tasks.map((t) => <TaskRow key={t.id} t={t} {...rowProps} />)
        ) : (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-muted)' }}>
            {isOwner ? 'No tasks yet. Add one above.' : 'No tasks yet.'}
          </div>
        ))}

      {!tasksQuery.isLoading && tab === 'overdue' &&
        (overdue.length > 0 ? (
          overdue.map((t) => <TaskRow key={t.id} t={t} {...rowProps} />)
        ) : (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--success)', fontWeight: 600, fontSize: 14 }}>
            No overdue tasks. The team is on top of it.
          </div>
        ))}

      {!tasksQuery.isLoading && tab === 'person' &&
        (byPerson.length > 0 ? (
          byPerson.map((group) => {
            const groupOverdue = group.tasks.filter((t) => isOverdue(t, today)).length;
            return (
              <div
                key={group.name}
                style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 10 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      background: 'var(--brand)',
                      color: '#fff',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {initials(group.name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{group.name}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                    <span style={{ padding: '4px 10px', background: '#F8FAFC', borderRadius: 6, color: '#475569', fontWeight: 600 }}>
                      {group.tasks.length} open
                    </span>
                    {groupOverdue > 0 ? (
                      <span style={{ padding: '4px 10px', background: '#FEE2E2', borderRadius: 6, color: '#991B1B', fontWeight: 700 }}>
                        {groupOverdue} overdue
                      </span>
                    ) : null}
                  </div>
                </div>
                {group.tasks.map((t) => (
                  <TaskRow key={t.id} t={t} {...rowProps} />
                ))}
              </div>
            );
          })
        ) : (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-muted)' }}>No open tasks.</div>
        ))}

      {tab === 'rules' && (
        <Card>
          <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 14 }}>
            Auto-Reminder Rules
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {REMINDER_RULES.map((r) => (
              <div
                key={r.n}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 14,
                  background: '#F8FAFC',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{r.n}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3 }}>{r.d}</div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '3px 9px',
                    borderRadius: 5,
                    background: r.enabled ? 'var(--success)22' : '#E2E8F0',
                    color: r.enabled ? 'var(--success)' : 'var(--ink-muted)',
                  }}
                >
                  {r.enabled ? 'Active' : 'Planned'}
                </span>
              </div>
            ))}
            <div
              style={{
                padding: 14,
                background: '#FEF3C7',
                borderLeft: '3px solid var(--warning)',
                borderRadius: 6,
                fontSize: 12.5,
                color: '#92400E',
                marginTop: 6,
              }}
            >
              Overdue reminders email the assignee daily at 08:00 (UK). The owner can send an
              immediate nudge from any overdue task; each nudge is copied to the owner.
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
