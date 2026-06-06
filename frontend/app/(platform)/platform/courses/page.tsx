'use client';

// Platform course-authoring — Module Library list + create. Superadmin only
// (the platform proxy injects the platform_token; the backend gates on the
// superadmin role). Courses are GLOBAL content seen by every tenant.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import {
  coursesApi,
  TRACKS,
  ACCESS,
  type Course,
  type Track,
  type Access,
} from '@/lib/course-admin';

export default function PlatformCoursesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Create form state.
  const [title, setTitle] = useState('');
  const [track, setTrack] = useState<Track>('foundations');
  const [access, setAccess] = useState<Access>('free');
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    coursesApi
      .list()
      .then((d) => {
        setRows(d.courses);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const course = await coursesApi.create({ title: title.trim(), track, access });
      router.push(`/platform/courses/${course.id}`);
    } catch (e: any) {
      setError(e.message);
      setCreating(false);
    }
  }

  const columns: Column<Course>[] = [
    { header: 'Title', render: (r) => <span className="font-medium text-ink">{r.title}</span> },
    { header: 'Track', render: (r) => <span className="capitalize">{r.track.replace('-', ' ')}</span> },
    { header: 'Level', render: (r) => <span className="capitalize">{r.level}</span> },
    {
      header: 'Access',
      render: (r) => (
        <span
          className={`px-2 py-0.5 rounded text-xs font-semibold ${
            r.access === 'free'
              ? 'bg-success/10 text-success'
              : 'bg-brand/10 text-brand'
          }`}
        >
          {r.access === 'free' ? 'Free' : 'Mentorship'}
        </span>
      ),
    },
    {
      header: 'Status',
      render: (r) => (
        <span
          className={`px-2 py-0.5 rounded text-xs font-semibold ${
            r.status === 'published'
              ? 'bg-success/10 text-success'
              : 'bg-ink-muted/10 text-ink-muted'
          }`}
        >
          {r.status === 'published' ? 'Published' : 'Draft'}
        </span>
      ),
    },
    { header: 'Updated', render: (r) => new Date(r.updated_at).toLocaleDateString('en-GB') },
    {
      header: '',
      render: (r) => (
        <button
          onClick={() => router.push(`/platform/courses/${r.id}`)}
          className="px-3 py-1 rounded text-xs font-semibold border border-border text-ink hover:bg-bg"
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Module Library — Courses"
        subtitle="Author courses once; every tenant sees the published catalogue."
      />

      {error && <div className="text-sm text-danger">{error}</div>}

      {/* Create */}
      <form
        onSubmit={create}
        className="flex flex-wrap items-end gap-3 p-4 rounded-lg border border-border bg-white"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">New course title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Reading Your Numbers"
            className="px-3 py-2 rounded border border-border text-sm w-72"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">Track</span>
          <select
            value={track}
            onChange={(e) => setTrack(e.target.value as Track)}
            className="px-3 py-2 rounded border border-border text-sm capitalize"
          >
            {TRACKS.map((t) => (
              <option key={t} value={t}>
                {t.replace('-', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">Access</span>
          <select
            value={access}
            onChange={(e) => setAccess(e.target.value as Access)}
            className="px-3 py-2 rounded border border-border text-sm capitalize"
          >
            {ACCESS.map((a) => (
              <option key={a} value={a}>
                {a === 'free' ? 'Free' : 'Mentorship'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={creating || !title.trim()}
          className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create course'}
        </button>
      </form>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <div className="p-6 text-center text-ink-muted">
            {loading ? 'Loading…' : 'No courses yet. Create one above.'}
          </div>
        }
      />
    </div>
  );
}
