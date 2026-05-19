'use client';
// CRM Today — pixel-faithful port of preview/elevate-dental-os-v2.html
// (effective PAGES['crm-today'] at ~line 14307). A task inbox grouped into
// Overdue / New leads / Follow-ups / Book appointments / Admin / Coming up /
// Completed buckets, with four headline counters.
//
// Data flow:
//   buildTasks() -> split by completedAt + dueAt vs TASK_NOW
//     overdue   = open & due < start-of-today
//     today     = open & due within today
//     upcoming  = open & due after today (max 8)
//     completed = completed today
//   today is further bucketed by task type for the section headings.

import { useMemo, useState } from 'react';
import {
  buildTasks,
  LEADS,
  TASK_NOW,
  TASK_TYPES,
  journeyStyle,
  timeFromNow,
  formatDateTime,
  type CrmTask,
} from '../data';

/** Index leads by id for quick task-row lookups. */
const LEAD_BY_ID = Object.fromEntries(LEADS.map((l) => [l.id, l]));

/** CRM Today task-inbox screen. */
export default function TodayScreen() {
  // Locally track completed tasks (mock — no API). Seeded from the generator.
  const [done, setDone] = useState<Record<string, boolean>>({});
  const allTasks = useMemo(() => buildTasks(), []);

  // Partition tasks into the prototype's buckets relative to TASK_NOW.
  const { overdue, today, upcoming, completed, buckets } = useMemo(() => {
    const start = new Date(TASK_NOW);
    start.setHours(0, 0, 0, 0);
    const end = new Date(TASK_NOW);
    end.setHours(23, 59, 59, 999);

    const isDone = (t: CrmTask) => Boolean(t.completedAt) || done[t.id];
    const open = allTasks.filter((t) => !isDone(t));

    const ov = open.filter((t) => new Date(t.dueAt) < start);
    const td = open.filter(
      (t) => new Date(t.dueAt) >= start && new Date(t.dueAt) <= end,
    );
    const up = open
      .filter((t) => new Date(t.dueAt) > end)
      .slice(0, 8);
    const cp = allTasks.filter(
      (t) =>
        (t.completedAt && new Date(t.completedAt) >= start) || done[t.id],
    );

    return {
      overdue: ov,
      today: td,
      upcoming: up,
      completed: cp,
      buckets: {
        newLeads: td.filter((t) => t.type === 'call_first'),
        followups: td.filter(
          (t) => t.type === 'call_followup' || t.type === 'send_message',
        ),
        appts: td.filter((t) => t.type === 'book_appointment'),
        admin: td.filter(
          (t) => t.type === 'admin' || t.type === 'notification',
        ),
      },
    };
  }, [allTasks, done]);

  /** Mark a task complete (mock state only). */
  function complete(id: string) {
    setDone((d) => ({ ...d, [id]: true }));
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div
        className="mb-6 flex"
        style={{
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>
            Today
          </h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            {today.length} tasks today · {overdue.length} overdue ·{' '}
            {completed.length} done
          </p>
        </div>
      </div>

      {/* 4 headline counters */}
      <div
        className="grid gap-3 mb-5"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
      >
        {[
          { label: 'Overdue', value: overdue.length, colour: '#DC2626' },
          { label: 'New leads', value: buckets.newLeads.length, colour: '#3B82F6' },
          { label: 'Follow-ups', value: buckets.followups.length, colour: '#F59E0B' },
          { label: 'Done today', value: completed.length, colour: '#10B981' },
        ].map((s) => (
          <div
            key={s.label}
            className="card-padded"
            style={{ borderLeft: `3px solid ${s.colour}` }}
          >
            <span
              className="text-ink-muted uppercase font-bold"
              style={{ fontSize: 11, letterSpacing: '0.05em' }}
            >
              {s.label}
            </span>
            <div
              className="display font-bold"
              style={{ fontSize: 28, color: s.colour, marginTop: 2 }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Sections */}
      {overdue.length > 0 && (
        <TaskSection
          title={`Overdue (${overdue.length})`}
          titleColour="#DC2626"
          tasks={overdue}
          onComplete={complete}
        />
      )}
      {buckets.newLeads.length > 0 && (
        <TaskSection
          title={`New leads — first contact (${buckets.newLeads.length})`}
          subtitle="SLA: first call within 1 hour of capture"
          tasks={buckets.newLeads}
          onComplete={complete}
        />
      )}
      {buckets.followups.length > 0 && (
        <TaskSection
          title={`Follow-ups (${buckets.followups.length})`}
          tasks={buckets.followups}
          onComplete={complete}
        />
      )}
      {buckets.appts.length > 0 && (
        <TaskSection
          title={`Book appointments (${buckets.appts.length})`}
          tasks={buckets.appts}
          onComplete={complete}
        />
      )}
      {buckets.admin.length > 0 && (
        <TaskSection
          title={`Admin (${buckets.admin.length})`}
          tasks={buckets.admin}
          onComplete={complete}
        />
      )}
      {upcoming.length > 0 && (
        <TaskSection
          title="Coming up"
          tasks={upcoming}
          onComplete={complete}
        />
      )}

      {completed.length > 0 && (
        <>
          <h2
            className="display font-bold"
            style={{ fontSize: 16, margin: '24px 0 8px', color: '#10B981' }}
          >
            Completed today ({completed.length})
          </h2>
          {completed.map((t) => (
            <div
              key={t.id}
              className="card flex items-center"
              style={{
                padding: '10px 14px',
                gap: 12,
                marginBottom: 4,
                opacity: 0.75,
              }}
            >
              <span style={{ color: '#10B981', fontSize: 16 }}>✓</span>
              <span style={{ fontSize: 12, flex: 1 }}>{t.title}</span>
              <span className="text-ink-muted" style={{ fontSize: 10 }}>
                {t.completedAt ? formatDateTime(t.completedAt) : 'Just now'}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Inbox zero */}
      {overdue.length + today.length + upcoming.length === 0 && (
        <div
          className="card-padded text-center"
          style={{ padding: '60px 20px' }}
        >
          <h3
            className="display font-bold"
            style={{ fontSize: 18, margin: '12px 0 4px' }}
          >
            Inbox zero
          </h3>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            No tasks waiting. New leads will appear here automatically.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One titled group of task rows. Pulled out so each prototype heading +
 * its rows render with identical structure.
 */
function TaskSection({
  title,
  subtitle,
  titleColour,
  tasks,
  onComplete,
}: {
  title: string;
  subtitle?: string;
  titleColour?: string;
  tasks: CrmTask[];
  onComplete: (id: string) => void;
}) {
  return (
    <>
      <h2
        className="display font-bold"
        style={{ fontSize: 16, margin: '20px 0 8px', color: titleColour }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className="text-ink-muted"
          style={{ fontSize: 12, marginBottom: 8 }}
        >
          {subtitle}
        </p>
      )}
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} onComplete={onComplete} />
      ))}
    </>
  );
}

/** A single task row: type, title, lead context, assignee, done button. */
function TaskRow({
  task,
  onComplete,
}: {
  task: CrmTask;
  onComplete: (id: string) => void;
}) {
  const lead = LEAD_BY_ID[task.leadId];
  const type = TASK_TYPES[task.type] || { label: task.type, colour: '#64748B' };
  const isOverdue =
    !task.completedAt && new Date(task.dueAt) < TASK_NOW;
  const stage = lead ? journeyStyle(lead.status) : null;

  return (
    <div
      className="card"
      style={{
        padding: '12px 14px',
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: 12,
        alignItems: 'center',
        marginBottom: 6,
        borderLeft: isOverdue ? '3px solid #DC2626' : undefined,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
          <span style={{ color: type.colour, fontWeight: 700 }}>
            {type.label}
          </span>{' '}
          · {task.title}
        </div>
        <div
          className="text-ink-muted"
          style={{ fontSize: 11, marginTop: 2 }}
        >
          {stage && (
            <span
              style={{
                display: 'inline-block',
                padding: '2px 6px',
                background: stage.bg,
                color: stage.colour,
                borderRadius: 4,
                fontWeight: 600,
                marginRight: 6,
              }}
            >
              {stage.label}
            </span>
          )}
          {lead && `${lead.treatment} · £${lead.value.toLocaleString('en-GB')} · `}
          Due {timeFromNow(task.dueAt)}
          {isOverdue && (
            <span style={{ color: '#DC2626', fontWeight: 700 }}>
              {' '}
              · OVERDUE
            </span>
          )}
        </div>
      </div>
      <div className="text-ink-muted" style={{ fontSize: 11 }}>
        {task.assignedTo}
      </div>
      <button
        onClick={() => onComplete(task.id)}
        style={{
          padding: '6px 10px',
          background: '#10B981',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Done
      </button>
    </div>
  );
}
