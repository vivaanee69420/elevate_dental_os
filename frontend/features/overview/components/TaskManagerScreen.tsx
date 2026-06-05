'use client';
// Task Manager — Team & Owner Accountability. Pixel-faithful port of
// elevate-dental-os.html (PAGES['task-manager']). A task/kanban management
// screen: KPI tiles, an overdue banner with a bulk-reminder action, an
// add-task form, tabbed views (All / Overdue / By Person / By Business /
// Reminder Rules) and a task list with overdue highlighting.
//
// Port notes (faithful to the prototype, adapted to React conventions):
//   - The prototype kept the active tab + the task list in localStorage and
//     re-ran navigate('task-manager') on every mutation. Here that becomes
//     local component state: `tab` (useState) for tab switching, `tasks`
//     (useState seeded from the SEED_TASKS const below) for the list. No
//     localStorage, no onclick string handlers, no backend calls.
//   - Overdue / due-today are derived from `tasks` on each render, exactly as
//     tmGetOverdue / tmGetDueToday did.
//   - "Send All Reminders Now" + per-task "Remind" bump the reminder counters
//     in state and surface a window.alert (the no-op stand-in for the
//     prototype's email side-effect).
//   - British English throughout; emojis stripped from the UI.
//   - Mock money helpers are imported per the screen template even though this
//     screen carries no money figures.

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui';
import { formatPounds, formatPoundsCompact } from '@/features/_mock';

// Silence unused-import lint while keeping the template's money helpers wired.
void formatPounds;
void formatPoundsCompact;

// ── Reference data (team roster + businesses), British English, no emojis ──
type Member = {
  id: string;
  name: string;
  role: string;
  avatar: string;
  colour: string;
  email: string;
};

const TEAM: Member[] = [
  { id: 'gaurav', name: 'Owner', role: 'CEO · Owner', avatar: 'O', colour: 'var(--brand)', email: 'owner@company.com' },
  { id: 'nadia', name: 'Co-founder', role: 'Co-founder · Mastermind Academy', avatar: 'CF', colour: '#EC4899', email: 'cofounder@company.com' },
  { id: 'nikhil', name: 'Tech Lead', role: 'Paid Ads · Technical', avatar: 'TL', colour: '#3B82F6', email: 'nikhil@team.com' },
  { id: 'ruhith', name: 'Infrastructure', role: 'AWS · DNS · Technical', avatar: 'IF', colour: '#8B5CF6', email: 'ruhith@team.com' },
  { id: 'abhishek', name: 'Designer', role: 'Visual Design · Canva', avatar: 'DS', colour: 'var(--warning)', email: 'abhishek@team.com' },
  { id: 'sona', name: 'Content Lead', role: 'Content · Copy · Admin', avatar: 'CO', colour: '#06B6D4', email: 'sona@team.com' },
  { id: 'philippa', name: 'Accountant', role: 'PracticeBooks', avatar: 'AC', colour: 'var(--success)', email: 'accountant@company.com' },
  { id: 'john', name: 'Clinical Director', role: 'Clinical Director · BioWell', avatar: 'CD', colour: '#6366F1', email: 'clinical@company.com' },
];

type Business = { id: string; name: string; colour: string };

const BUSINESSES: Business[] = [
  { id: 'gm', name: 'Crestwell Dental Group', colour: 'var(--brand)' },
  { id: 'lab', name: 'PrecisionLab', colour: '#7C3AED' },
  { id: 'p4g', name: 'Mastermind Academy', colour: '#EC4899' },
  { id: 'bio', name: 'BioWell Dental', colour: 'var(--success)' },
  { id: 'elevate', name: 'PracticeBooks', colour: '#3B82F6' },
];

// ── Task model + seed data ──
type Priority = 'urgent' | 'high' | 'medium' | 'low';
type Status = 'not-started' | 'in-progress' | 'done' | 'blocked';

type Task = {
  id: string;
  title: string;
  desc: string;
  assignee: string;
  priority: Priority;
  status: Status;
  dueDate: string; // ISO yyyy-mm-dd
  category: string;
  business: string;
  createdBy: string;
  reminderSent: number;
  lastReminded: string | null;
};

// Relative-date helper mirrors the prototype's `dd(offset)` seed dates so the
// overdue / due-today logic still demonstrates against "today".
function dd(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

const SEED_TASKS: Task[] = [
  { id: 't1', title: 'Approve Q2 P&L for Crestwell Dental Group', desc: 'Review and sign off Q2 numbers for board pack', assignee: 'philippa', priority: 'high', status: 'in-progress', dueDate: dd(2), category: 'finance', business: 'gm', createdBy: 'gaurav', reminderSent: 1, lastReminded: dd(-1) },
  { id: 't2', title: 'Launch BDCDS NEC follow-up sequence', desc: '8-email Manychat automation to 247 leads from Birmingham', assignee: 'sona', priority: 'urgent', status: 'in-progress', dueDate: dd(0), category: 'marketing', business: 'p4g', createdBy: 'gaurav', reminderSent: 0, lastReminded: null },
  { id: 't3', title: 'Configure Meta Pixel for BioWell Dental', desc: 'New domain specialist.example.com - install pixel + CAPI', assignee: 'nikhil', priority: 'high', status: 'not-started', dueDate: dd(-2), category: 'marketing', business: 'bio', createdBy: 'gaurav', reminderSent: 2, lastReminded: dd(-1) },
  { id: 't4', title: 'Renew DBS check — Dr Sunita Patel', desc: 'DBS expires 2026-08-01, start renewal now', assignee: 'sona', priority: 'medium', status: 'not-started', dueDate: dd(5), category: 'compliance', business: 'gm', createdBy: 'gaurav', reminderSent: 0, lastReminded: null },
  { id: 't5', title: 'Beechcroft Lodge utilisation review', desc: 'Currently 68% — find 12% improvement plan', assignee: 'nadia', priority: 'high', status: 'in-progress', dueDate: dd(3), category: 'ops', business: 'gm', createdBy: 'gaurav', reminderSent: 0, lastReminded: null },
  { id: 't6', title: 'Set up MTDREADY discovery calendar', desc: 'Accountant needs GHL calendar w/ 30min slots', assignee: 'philippa', priority: 'medium', status: 'done', dueDate: dd(-3), category: 'sales', business: 'elevate', createdBy: 'gaurav', reminderSent: 0, lastReminded: null },
  { id: 't7', title: 'AWS S3 backup audit', desc: 'Verify nightly backups for all 5 practice databases', assignee: 'ruhith', priority: 'medium', status: 'in-progress', dueDate: dd(7), category: 'ops', business: 'gm', createdBy: 'gaurav', reminderSent: 0, lastReminded: null },
  { id: 't8', title: 'Q3 Mastermind Academy content batch (40 reels)', desc: '40 reels covering Implant Training + Practice Freedom', assignee: 'sona', priority: 'high', status: 'in-progress', dueDate: dd(10), category: 'marketing', business: 'p4g', createdBy: 'gaurav', reminderSent: 0, lastReminded: null },
  { id: 't9', title: 'BioWell Dental CPD diploma curriculum', desc: 'Finalise 12-module curriculum with Clinical Director', assignee: 'john', priority: 'urgent', status: 'in-progress', dueDate: dd(1), category: 'training', business: 'bio', createdBy: 'gaurav', reminderSent: 0, lastReminded: null },
  { id: 't10', title: 'Composite bonding refresher — clinical team', desc: 'Book in-house CPD session with Clinical Director', assignee: 'abhishek', priority: 'high', status: 'not-started', dueDate: dd(-1), category: 'training', business: 'gm', createdBy: 'gaurav', reminderSent: 1, lastReminded: dd(0) },
];

const PRIORITY_COLOURS: Record<Priority, string> = {
  urgent: 'var(--danger)',
  high: 'var(--warning)',
  medium: '#3B82F6',
  low: 'var(--ink-muted)',
};
const STATUS_COLOURS: Record<Status, string> = {
  'not-started': 'var(--ink-soft)',
  'in-progress': '#3B82F6',
  done: 'var(--success)',
  blocked: 'var(--danger)',
};
const STATUS_LABELS: Record<Status, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
};
const STATUS_GLYPH: Record<Status, string> = {
  'not-started': '○',
  'in-progress': '◐',
  done: '✓',
  blocked: '!',
};

type TabKey = 'all' | 'overdue' | 'person' | 'business' | 'rules';

const REMINDER_RULES = [
  { n: '24h before due', d: 'Send assignee an email + in-app reminder 24 hours before due date', enabled: true },
  { n: 'On overdue', d: 'Immediate email to assignee, copy to Owner on the day a task becomes overdue', enabled: true },
  { n: 'Overdue +1 day', d: 'Second reminder, copy to Owner + line manager', enabled: true },
  { n: 'Overdue +3 days', d: 'Escalation to Owner with red-flag dashboard alert + WhatsApp message', enabled: true },
  { n: 'Weekly digest', d: 'Every Monday 8am - summary of open + overdue tasks per team member', enabled: true },
  { n: 'Pop-up on login', d: "If task is overdue, show modal on assignee's next login with task list and Snooze 1h option", enabled: true },
];

function isOverdue(t: Task, today: string): boolean {
  return t.status !== 'done' && t.dueDate < today;
}

// ── Single task row ──
function TaskRow({
  t,
  today,
  onToggle,
  onRemind,
  onDelete,
}: {
  t: Task;
  today: string;
  onToggle: (id: string) => void;
  onRemind: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const member =
    TEAM.find((m) => m.id === t.assignee) ?? { name: 'Unassigned', colour: 'var(--ink-soft)', avatar: '??' };
  const business =
    BUSINESSES.find((b) => b.id === t.business) ?? { name: '—', colour: 'var(--ink-soft)' };
  const overdue = isOverdue(t, today);
  const done = t.status === 'done';
  const dueDateFormatted = new Date(t.dueDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });

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
        onClick={() => onToggle(t.id)}
        title={STATUS_LABELS[t.status]}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{ width: 6, height: 6, borderRadius: '50%', background: business.colour }}
            />
            {business.name}
          </span>
          <span>·</span>
          <span style={{ textTransform: 'capitalize' }}>{t.category}</span>
          {t.desc ? (
            <>
              <span>·</span>
              <span style={{ opacity: 0.75 }}>
                {t.desc.length > 50 ? `${t.desc.substring(0, 50)}…` : t.desc}
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
            background: member.colour,
            color: '#fff',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          {member.avatar}
        </div>
        <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>
          {member.name.split(' ')[0]}
        </span>
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
        {dueDateFormatted}
      </div>
      {t.reminderSent > 0 ? (
        <span
          title={`${t.reminderSent} reminder(s) sent · last: ${t.lastReminded}`}
          style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}
        >
          {t.reminderSent} sent
        </span>
      ) : (
        <span />
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        {t.status !== 'done' && overdue ? (
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

/** Task Manager page. */
export default function TaskManagerScreen() {
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [tasks, setTasks] = useState<Task[]>(SEED_TASKS);
  const [tab, setTab] = useState<TabKey>('all');

  // New-task form fields.
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAssignee, setNewAssignee] = useState(TEAM[0].id);
  const [newBusiness, setNewBusiness] = useState(BUSINESSES[0].id);
  const [newCategory, setNewCategory] = useState('marketing');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newDue, setNewDue] = useState('');

  const overdue = useMemo(() => tasks.filter((t) => isOverdue(t, today)), [tasks, today]);
  const dueToday = useMemo(
    () => tasks.filter((t) => t.status !== 'done' && t.dueDate === today),
    [tasks, today],
  );
  const completedThisWeek = tasks.filter((t) => t.status === 'done').length;

  function toggleStatus(id: string) {
    const order: Status[] = ['not-started', 'in-progress', 'done'];
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: order[(order.indexOf(t.status) + 1) % order.length] } : t,
      ),
    );
  }

  function deleteTask(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this task?')) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function sendReminder(id: string) {
    const t = tasks.find((x) => x.id === id);
    setTasks((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, reminderSent: (x.reminderSent || 0) + 1, lastReminded: today } : x,
      ),
    );
    const member = TEAM.find((m) => m.id === t?.assignee);
    if (typeof window !== 'undefined') {
      window.alert(
        `Reminder sent to ${member?.name || 'team'} (${member?.email || 'email'})\n\nTask: ${t?.title}\n\nA copy has also been emailed to the Owner (owner notification).`,
      );
    }
  }

  function sendAllReminders() {
    setTasks((prev) =>
      prev.map((t) =>
        isOverdue(t, today)
          ? { ...t, reminderSent: (t.reminderSent || 0) + 1, lastReminded: today }
          : t,
      ),
    );
    if (typeof window !== 'undefined') {
      window.alert(
        `Bulk reminder sent for ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}. Owners notified.`,
      );
    }
  }

  function addTask() {
    const title = newTitle.trim();
    if (!title) {
      if (typeof window !== 'undefined') window.alert('Enter a task title');
      return;
    }
    const task: Task = {
      id: `t${Date.now()}`,
      title,
      desc: newDesc.trim(),
      assignee: newAssignee,
      priority: newPriority,
      status: 'not-started',
      dueDate: newDue || dd(7),
      category: newCategory,
      business: newBusiness,
      createdBy: 'gaurav',
      reminderSent: 0,
      lastReminded: null,
    };
    setTasks((prev) => [task, ...prev]);
    setNewTitle('');
    setNewDesc('');
    setNewDue('');
  }

  const rowProps = { today, onToggle: toggleStatus, onRemind: sendReminder, onDelete: deleteTask };

  const tabs: { k: TabKey; l: string }[] = [
    { k: 'all', l: `All Tasks (${tasks.length})` },
    { k: 'overdue', l: `Overdue (${overdue.length})` },
    { k: 'person', l: 'By Person' },
    { k: 'business', l: 'By Business' },
    { k: 'rules', l: 'Reminder Rules' },
  ];

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

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="display text-3xl font-bold">Task Manager &middot; Team &amp; Owner Accountability</h1>
          <p className="text-sm text-ink-muted mt-1">
            Assign tasks across team and businesses &middot; auto-reminders fire on overdue
            &middot; owner gets escalation alerts
          </p>
        </div>
      </div>

      {/* KPI tiles */}
      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}
      >
        <Kpi label="Total Tasks" value={tasks.length.toString()} sub="across all teams" />
        <Kpi
          label="Due Today"
          value={dueToday.length.toString()}
          sub={dueToday.length > 0 ? 'needs action' : 'all clear'}
        />
        <Kpi
          label="Overdue"
          value={overdue.length.toString()}
          sub={overdue.length > 0 ? 'auto-reminders firing' : 'on track'}
        />
        <Kpi label="Completed" value={completedThisWeek.toString()} sub="this week" />
        <Kpi label="Active Team" value={TEAM.length.toString()} sub="with assignments" />
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
              Auto-reminders sent to assignees + owner notified by email &middot; Pop-up on next
              login
            </div>
          </div>
          <button
            onClick={sendAllReminders}
            style={{
              background: '#991B1B',
              color: '#fff',
              border: 'none',
              padding: '9px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Send All Reminders Now
          </button>
        </div>
      ) : null}

      {/* Add-task form */}
      <div
        style={{
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 18,
          marginBottom: 18,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: '0 0 12px' }}>
          Add Task
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto',
            gap: 8,
            alignItems: 'end',
          }}
        >
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
            <select
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              style={inputStyle}
            >
              {TEAM.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Business</label>
            <select
              value={newBusiness}
              onChange={(e) => setNewBusiness(e.target.value)}
              style={inputStyle}
            >
              {BUSINESSES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              style={inputStyle}
            >
              {['marketing', 'ops', 'finance', 'compliance', 'sales', 'training', 'tech'].map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as Priority)}
              style={inputStyle}
            >
              {(['medium', 'high', 'urgent', 'low'] as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Due</label>
            <input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button
            onClick={addTask}
            style={{
              background: 'var(--brand)',
              color: '#fff',
              border: 'none',
              padding: '9px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              height: 38,
            }}
          >
            Add
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
      {tab === 'all' &&
        (tasks.length > 0 ? (
          tasks.map((t) => <TaskRow key={t.id} t={t} {...rowProps} />)
        ) : (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-muted)' }}>
            No tasks yet. Add one above.
          </div>
        ))}

      {tab === 'overdue' &&
        (overdue.length > 0 ? (
          overdue.map((t) => <TaskRow key={t.id} t={t} {...rowProps} />)
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: 48,
              color: 'var(--success)',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            No overdue tasks. Team is on top of it.
          </div>
        ))}

      {tab === 'person' &&
        TEAM.map((m) => {
          const memberTasks = tasks.filter((t) => t.assignee === m.id && t.status !== 'done');
          const memberOverdue = memberTasks.filter((t) => t.dueDate < today).length;
          return (
            <div
              key={m.id}
              style={{
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 16,
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    background: m.colour,
                    color: '#fff',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {m.avatar}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{m.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{m.role}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span
                    style={{
                      padding: '4px 10px',
                      background: '#F8FAFC',
                      borderRadius: 6,
                      color: '#475569',
                      fontWeight: 600,
                    }}
                  >
                    {memberTasks.length} open
                  </span>
                  {memberOverdue > 0 ? (
                    <span
                      style={{
                        padding: '4px 10px',
                        background: '#FEE2E2',
                        borderRadius: 6,
                        color: '#991B1B',
                        fontWeight: 700,
                      }}
                    >
                      {memberOverdue} overdue
                    </span>
                  ) : null}
                </div>
              </div>
              {memberTasks.length > 0 ? (
                memberTasks.map((t) => <TaskRow key={t.id} t={t} {...rowProps} />)
              ) : (
                <div
                  style={{
                    padding: '8px 12px',
                    color: 'var(--ink-soft)',
                    fontSize: 12.5,
                    fontStyle: 'italic',
                  }}
                >
                  No open tasks
                </div>
              )}
            </div>
          );
        })}

      {tab === 'business' &&
        BUSINESSES.map((b) => {
          const bizTasks = tasks.filter((t) => t.business === b.id && t.status !== 'done');
          return (
            <div
              key={b.id}
              style={{
                background: '#fff',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${b.colour}`,
                borderRadius: 10,
                padding: 16,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <h3 style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', margin: 0 }}>
                  {b.name}
                </h3>
                <span
                  style={{
                    padding: '4px 10px',
                    background: `${b.colour}22`,
                    color: b.colour,
                    borderRadius: 6,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  {bizTasks.length} open
                </span>
              </div>
              {bizTasks.length > 0 ? (
                bizTasks.map((t) => <TaskRow key={t.id} t={t} {...rowProps} />)
              ) : (
                <div
                  style={{
                    padding: '8px 12px',
                    color: 'var(--ink-soft)',
                    fontSize: 12.5,
                    fontStyle: 'italic',
                  }}
                >
                  No open tasks
                </div>
              )}
            </div>
          );
        })}

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
                <div
                  style={{
                    width: 36,
                    height: 20,
                    background: r.enabled ? 'var(--success)' : '#CBD5E1',
                    borderRadius: 10,
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      background: '#fff',
                      borderRadius: '50%',
                      position: 'absolute',
                      top: 2,
                      [r.enabled ? 'right' : 'left']: 2,
                      boxShadow: '0 1px 3px rgba(0,0,0,.15)',
                    }}
                  />
                </div>
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
              <b>Owner Email:</b> All escalations cc: <b>owner@company.com</b> &middot; Change in
              Settings &rarr; Notifications
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
