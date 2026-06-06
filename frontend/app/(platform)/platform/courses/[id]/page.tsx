'use client';

// Platform course editor — metadata, publish, modules -> lessons (text + categorised
// file attachments, reorder, markdown preview), and course-level resources.
// Superadmin only. Catalog is global content. Attachments upload straight to S3
// via presign (lib/course-admin).
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { PageHeader } from '@/components/ui';
import {
  coursesApi,
  uploadAttachment,
  TRACKS,
  LEVELS,
  ACCESS,
  CATEGORIES,
  type CourseDetail,
  type Module,
  type Lesson,
  type LessonFile,
  type Resource,
  type Track,
  type Level,
  type Access,
  type Category,
} from '@/lib/course-admin';

function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function CourseEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMeta, setSavingMeta] = useState(false);

  // Editable metadata mirror.
  const [meta, setMeta] = useState<Partial<CourseDetail>>({});

  function load() {
    setLoading(true);
    coursesApi
      .get(id)
      .then((d) => {
        setCourse(d);
        setMeta({
          title: d.title,
          track: d.track,
          level: d.level,
          access: d.access,
          featured: d.featured,
          description: d.description,
          instructor: d.instructor,
          instructor_title: d.instructor_title,
          outcome: d.outcome,
        });
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    setSavingMeta(true);
    try {
      await coursesApi.update(id, meta);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingMeta(false);
    }
  }

  async function togglePublish() {
    if (!course) return;
    try {
      const next = course.status === 'published' ? 'draft' : 'published';
      await coursesApi.publish(id, next);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteCourse() {
    if (!window.confirm('Delete this course and all its lessons? This cannot be undone.')) return;
    try {
      await coursesApi.remove(id);
      router.push('/platform/courses');
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) return <div className="p-6 text-ink-muted">Loading…</div>;
  if (!course) return <div className="p-6 text-danger">{error || 'Course not found.'}</div>;

  return (
    <div className="space-y-6">
      <Link href="/platform/courses" className="text-sm text-ink-muted hover:text-ink">
        ← Back to courses
      </Link>
      <div className="flex items-start justify-between gap-4">
        <PageHeader title={course.title} subtitle={`Status: ${course.status}`} />
        <div className="flex gap-2 pt-1">
          <button
            onClick={togglePublish}
            className={`px-4 py-2 rounded text-sm font-semibold ${
              course.status === 'published'
                ? 'border border-border text-ink hover:bg-bg'
                : 'bg-brand text-white'
            }`}
          >
            {course.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
          <button
            onClick={deleteCourse}
            className="px-4 py-2 rounded text-sm font-semibold border border-danger text-danger hover:bg-danger/5"
          >
            Delete
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-danger">{error}</div>}

      {/* ---- Metadata ---- */}
      <form onSubmit={saveMeta} className="p-5 rounded-lg border border-border bg-white space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Title">
            <input
              value={meta.title ?? ''}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              className="ce-input"
            />
          </Field>
          <Field label="Outcome (one-line promise)">
            <input
              value={meta.outcome ?? ''}
              onChange={(e) => setMeta({ ...meta, outcome: e.target.value })}
              className="ce-input"
            />
          </Field>
          <Field label="Track">
            <select
              value={meta.track}
              onChange={(e) => setMeta({ ...meta, track: e.target.value as Track })}
              className="ce-input capitalize"
            >
              {TRACKS.map((t) => (
                <option key={t} value={t}>
                  {t.replace('-', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Level">
            <select
              value={meta.level}
              onChange={(e) => setMeta({ ...meta, level: e.target.value as Level })}
              className="ce-input capitalize"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Access">
            <select
              value={meta.access}
              onChange={(e) => setMeta({ ...meta, access: e.target.value as Access })}
              className="ce-input capitalize"
            >
              {ACCESS.map((a) => (
                <option key={a} value={a}>
                  {a === 'free' ? 'Free' : 'Mentorship'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Instructor">
            <input
              value={meta.instructor ?? ''}
              onChange={(e) => setMeta({ ...meta, instructor: e.target.value })}
              className="ce-input"
            />
          </Field>
          <Field label="Instructor title">
            <input
              value={meta.instructor_title ?? ''}
              onChange={(e) => setMeta({ ...meta, instructor_title: e.target.value })}
              className="ce-input"
            />
          </Field>
          <label className="flex items-center gap-2 mt-6">
            <input
              type="checkbox"
              checked={!!meta.featured}
              onChange={(e) => setMeta({ ...meta, featured: e.target.checked })}
            />
            <span className="text-sm text-ink">Featured</span>
          </label>
        </div>
        <Field label="Description">
          <textarea
            value={meta.description ?? ''}
            onChange={(e) => setMeta({ ...meta, description: e.target.value })}
            rows={2}
            className="ce-input"
          />
        </Field>
        <button
          type="submit"
          disabled={savingMeta}
          className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50"
        >
          {savingMeta ? 'Saving…' : 'Save details'}
        </button>
      </form>

      {/* ---- Modules ---- */}
      <ModulesSection course={course} onChange={load} setError={setError} />

      {/* ---- Resources ---- */}
      <ResourcesSection course={course} onChange={load} setError={setError} />

      {/* Local input styling (kept inline; no new global tokens). */}
      <style jsx>{`
        :global(.ce-input) {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Modules -> Lessons
// ---------------------------------------------------------------------------
function ModulesSection({
  course,
  onChange,
  setError,
}: {
  course: CourseDetail;
  onChange: () => void;
  setError: (s: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await coursesApi.addModule(course.id, { title: title.trim() });
      setTitle('');
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = course.modules.map((m) => m.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      await coursesApi.reorderModules(course.id, ids);
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <section className="p-5 rounded-lg border border-border bg-white space-y-3">
      <h2 className="font-semibold text-ink">Modules ({course.modules.length})</h2>
      {course.modules.length === 0 && (
        <p className="text-sm text-ink-muted">No modules yet. Add the first one below.</p>
      )}
      <div className="space-y-3">
        {course.modules.map((m, i) => (
          <ModuleCard
            key={m.id}
            courseId={course.id}
            module={m}
            isFirst={i === 0}
            isLast={i === course.modules.length - 1}
            onMove={(dir) => move(i, dir)}
            onChange={onChange}
            setError={setError}
          />
        ))}
      </div>
      <form onSubmit={add} className="flex items-end gap-3 pt-2 border-t border-border">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">New module title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-3 py-2 rounded border border-border text-sm w-80"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50"
        >
          Add module
        </button>
      </form>
    </section>
  );
}

function ModuleCard({
  courseId,
  module,
  isFirst,
  isLast,
  onMove,
  onChange,
  setError,
}: {
  courseId: string;
  module: Module;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onChange: () => void;
  setError: (s: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [title, setTitle] = useState(module.title);
  const [lessonTitle, setLessonTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveTitle() {
    if (title.trim() === module.title) return;
    try {
      await coursesApi.updateModule(courseId, module.id, { title: title.trim() });
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete module "${module.title}" and all its lessons?`)) return;
    try {
      await coursesApi.removeModule(courseId, module.id);
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function addLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!lessonTitle.trim()) return;
    setBusy(true);
    try {
      await coursesApi.addLesson(courseId, module.id, { title: lessonTitle.trim(), access: 'free' });
      setLessonTitle('');
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function moveLesson(index: number, dir: -1 | 1) {
    const ids = module.lessons.map((l) => l.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      await coursesApi.reorderLessons(courseId, module.id, ids);
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 p-3 bg-bg/40">
        <div className="flex flex-col">
          <button
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="text-xs text-ink-muted disabled:opacity-30 leading-none"
            aria-label="Move module up"
          >
            ▲
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={isLast}
            className="text-xs text-ink-muted disabled:opacity-30 leading-none"
            aria-label="Move module down"
          >
            ▼
          </button>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          className="flex-1 px-2 py-1 rounded border border-transparent hover:border-border text-sm font-semibold text-ink bg-transparent"
        />
        <span className="text-xs text-ink-muted">{module.lessons.length} lessons</span>
        <button
          onClick={() => setOpen((o) => !o)}
          className="px-2 py-1 text-xs font-semibold border border-border rounded text-ink hover:bg-white"
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
        <button
          onClick={remove}
          className="px-2 py-1 text-xs font-semibold border border-danger rounded text-danger"
        >
          Delete
        </button>
      </div>
      {open && (
        <div className="p-3 space-y-2">
          {module.lessons.map((lesson, i) => (
            <LessonRow
              key={lesson.id}
              courseId={courseId}
              lesson={lesson}
              isFirst={i === 0}
              isLast={i === module.lessons.length - 1}
              onMove={(dir) => moveLesson(i, dir)}
              onChange={onChange}
              setError={setError}
            />
          ))}
          <form onSubmit={addLesson} className="flex items-end gap-3 pt-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-muted">New lesson title</span>
              <input
                value={lessonTitle}
                onChange={(e) => setLessonTitle(e.target.value)}
                className="px-3 py-2 rounded border border-border text-sm w-72"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !lessonTitle.trim()}
              className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50"
            >
              Add lesson
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function LessonRow({
  courseId,
  lesson,
  isFirst,
  isLast,
  onMove,
  onChange,
  setError,
}: {
  courseId: string;
  lesson: Lesson;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onChange: () => void;
  setError: (s: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [access, setAccess] = useState<Access>(lesson.access);
  const [body, setBody] = useState(lesson.body ?? '');
  const [teaser, setTeaser] = useState(lesson.teaser ?? '');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await coursesApi.updateLesson(courseId, lesson.id, { title, access, body, teaser });
      onChange();
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete lesson "${lesson.title}"?`)) return;
    try {
      await coursesApi.removeLesson(courseId, lesson.id);
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="rounded border border-border bg-white">
      <div className="flex items-center gap-2 p-2">
        <div className="flex flex-col">
          <button
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="text-xs text-ink-muted disabled:opacity-30 leading-none"
            aria-label="Move up"
          >
            ▲
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={isLast}
            className="text-xs text-ink-muted disabled:opacity-30 leading-none"
            aria-label="Move down"
          >
            ▼
          </button>
        </div>
        <div className="flex-1">
          <span className="text-sm font-medium text-ink">{lesson.title}</span>
          <span className="ml-2 text-xs text-ink-muted">
            {lesson.access === 'free' ? 'Free' : 'Mentorship'} - {lesson.files.length} files
          </span>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="px-2 py-1 text-xs font-semibold border border-border rounded text-ink hover:bg-bg"
        >
          {open ? 'Close' : 'Edit'}
        </button>
        <button
          onClick={remove}
          className="px-2 py-1 text-xs font-semibold border border-danger rounded text-danger"
        >
          Delete
        </button>
      </div>
      {open && (
        <div className="p-3 border-t border-border space-y-3 bg-bg/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-muted">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="px-3 py-2 rounded border border-border text-sm"
              />
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
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-muted">Content (markdown)</span>
              <button
                type="button"
                onClick={() => setShowPreview((p) => !p)}
                className="text-xs text-brand font-semibold"
              >
                {showPreview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {showPreview ? (
              <div className="px-3 py-2 rounded border border-border bg-white prose prose-sm max-w-none min-h-[8rem]">
                <ReactMarkdown>{body || '_Nothing to preview_'}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="px-3 py-2 rounded border border-border text-sm font-mono"
              />
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-muted">Teaser (shown when locked)</span>
            <input
              value={teaser}
              onChange={(e) => setTeaser(e.target.value)}
              className="px-3 py-2 rounded border border-border text-sm"
            />
          </label>

          <LessonFiles courseId={courseId} lesson={lesson} onChange={onChange} setError={setError} />

          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save lesson'}
          </button>
        </div>
      )}
    </div>
  );
}

function LessonFiles({
  courseId,
  lesson,
  onChange,
  setError,
}: {
  courseId: string;
  lesson: Lesson;
  onChange: () => void;
  setError: (s: string | null) => void;
}) {
  const [active, setActive] = useState<Category>('presentations');
  const [uploading, setUploading] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadAttachment(file);
      await coursesApi.addLessonFile(courseId, lesson.id, {
        category: active,
        name: up.name,
        file_key: up.key,
        file_type: up.type,
        size_bytes: up.size,
        access: lesson.access,
      });
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function removeFile(f: LessonFile) {
    if (!window.confirm(`Remove "${f.name}"?`)) return;
    try {
      await coursesApi.removeLessonFile(courseId, lesson.id, f.id);
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const inCategory = lesson.files.filter((f) => f.category === active);

  return (
    <div className="rounded border border-border bg-white">
      <div className="flex flex-wrap gap-1 p-2 border-b border-border">
        {CATEGORIES.map((c) => {
          const count = lesson.files.filter((f) => f.category === c.key).length;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setActive(c.key)}
              className={`px-3 py-1 text-xs font-semibold rounded ${
                active === c.key ? 'bg-brand text-white' : 'border border-border text-ink hover:bg-bg'
              }`}
            >
              {c.label} {count > 0 ? `(${count})` : ''}
            </button>
          );
        })}
      </div>
      <div className="p-2 space-y-1">
        {inCategory.length === 0 && (
          <p className="text-xs text-ink-muted">No files in this category.</p>
        )}
        {inCategory.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between p-2 rounded border border-border text-sm"
          >
            <span className="text-ink">
              {f.name}{' '}
              <span className="text-ink-muted text-xs">{fmtSize(f.size_bytes)}</span>
            </span>
            <button
              onClick={() => removeFile(f)}
              className="px-2 py-1 text-xs font-semibold border border-danger rounded text-danger"
            >
              Remove
            </button>
          </div>
        ))}
        <label className="text-sm text-ink block pt-1">
          <span className="text-xs font-semibold text-ink-muted mr-2">
            Upload to {CATEGORIES.find((c) => c.key === active)?.label}:
          </span>
          <input type="file" onChange={onFile} disabled={uploading} />
        </label>
        {uploading && <span className="text-xs text-ink-muted">Uploading…</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
function ResourcesSection({
  course,
  onChange,
  setError,
}: {
  course: CourseDetail;
  onChange: () => void;
  setError: (s: string | null) => void;
}) {
  const [access, setAccess] = useState<Access>('free');
  const [uploading, setUploading] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadAttachment(file);
      await coursesApi.addResource(course.id, {
        name: up.name,
        file_key: up.key,
        file_type: up.type,
        size_bytes: up.size,
        access,
      });
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function remove(res: Resource) {
    if (!window.confirm(`Remove resource "${res.name}"?`)) return;
    try {
      await coursesApi.removeResource(course.id, res.id);
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <section className="p-5 rounded-lg border border-border bg-white space-y-3">
      <h2 className="font-semibold text-ink">Resources ({course.resources.length})</h2>

      <div className="space-y-1">
        {course.resources.map((res) => (
          <div
            key={res.id}
            className="flex items-center justify-between p-2 rounded border border-border text-sm"
          >
            <span className="text-ink">
              {res.name}{' '}
              <span className="text-ink-muted text-xs">
                {res.access === 'free' ? 'Free' : 'Mentorship'} · {fmtSize(res.size_bytes)}
              </span>
            </span>
            <button
              onClick={() => remove(res)}
              className="px-2 py-1 text-xs font-semibold border border-danger rounded text-danger"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-border">
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
        <label className="text-sm text-ink">
          <span className="text-xs font-semibold text-ink-muted mr-2">Upload resource:</span>
          <input type="file" onChange={onFile} disabled={uploading} />
        </label>
        {uploading && <span className="text-xs text-ink-muted">Uploading…</span>}
      </div>
    </section>
  );
}
