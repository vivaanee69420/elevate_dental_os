// Task Manager API wrappers. Talks to the live /api/tasks endpoints through
// the same-origin proxy (lib/api). Reads are open to every role; all writes
// are Owner-only and 403 server-side for anyone else — the screen hides the
// write controls for non-owners, but the backend is the real boundary.
import { api } from '@/lib/api';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  due_date: string | null; // ISO yyyy-mm-dd
  priority: TaskPriority;
  status: TaskStatus;
  completed_at: string | null;
  reminder_count: number;
  last_reminded_at: string | null;
  // Joined assignee (tasks_assigned_to_fkey).
  assignee?: { id: string; full_name: string | null } | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assigned_to?: string;
  due_date?: string;
  priority?: TaskPriority;
}

export type UpdateTaskInput = Partial<{
  title: string;
  description: string | null;
  assigned_to: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
}>;

export async function listTasks(): Promise<Task[]> {
  const r = await api<{ tasks: Task[] }>('/api/tasks');
  return r.tasks ?? [];
}

export function createTask(body: CreateTaskInput): Promise<Task> {
  return api<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
}

export function updateTask(id: string, body: UpdateTaskInput): Promise<Task> {
  return api<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteTask(id: string): Promise<{ ok: boolean }> {
  return api(`/api/tasks/${id}`, { method: 'DELETE' });
}

export function remindTask(id: string): Promise<Task> {
  return api(`/api/tasks/${id}/remind`, { method: 'POST' });
}

export function remindOverdue(): Promise<{ reminded: number; total: number }> {
  return api('/api/tasks/remind-overdue', { method: 'POST' });
}
