'use client';
// Tenant course detail — reads /api/training/courses/:id (published, gated).
// Renders modules → lessons with markdown bodies and files grouped by category.
// Locked (mentorship) lessons show a teaser instead of body/files.
// Enrolment, per-lesson completion, and signed-URL downloads are wired live.
// See MODULE-LIBRARY.md.
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import {
  useCourse,
  useEnrol,
  useSetLessonComplete,
  downloadLessonAttachment,
  downloadLessonFile,
  downloadResource,
  type CourseDetailLessonFile,
} from '../useLibrary';
import { CATEGORIES } from '@/lib/course-admin';
import MaterialsBrowser from '../materials/MaterialsBrowser';
import {
  buildTree,
  type MaterialsInput,
  type MaterialFile,
} from '../materials/buildTree';

const PURPLE = '#9333EA';

function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface DownloadLinkProps {
  file: CourseDetailLessonFile;
  onError: (msg: string) => void;
}

function DownloadLink({ file, onError }: DownloadLinkProps) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await downloadLessonFile(file.id);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: busy ? 'default' : 'pointer',
        color: PURPLE,
        fontWeight: 600,
        fontSize: 12,
        opacity: busy ? 0.6 : 1,
      }}
    >
      ↓ {file.name}
      {file.size_bytes ? (
        <span className="text-ink-muted" style={{ fontWeight: 400 }}>
          {' '}({fmtSize(file.size_bytes)})
        </span>
      ) : null}
    </button>
  );
}

export default function CourseDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: course, isLoading, error } = useCourse(id);
  const enrol = useEnrol();
  const setComplete = useSetLessonComplete(id);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'content' | 'materials'>('content');

  async function download(fn: () => Promise<void>) {
    setDownloadError(null);
    try {
      await fn();
    } catch (e) {
      setDownloadError((e as Error).message);
    }
  }

  if (isLoading) return <div className="p-6 text-ink-muted">Loading course…</div>;
  if (error)
    return <div className="p-6 text-danger">{(error as Error).message}</div>;
  if (!course) return <div className="p-6 text-ink-muted">Course not found.</div>;

  const total = course.lessons.length;
  const done = course.lessons.filter((l) => l.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const modules = course.modules ?? [];

  // Adapt the loaded course into the Materials folder-view input. `course` is
  // guaranteed non-null here (early returns above). Per-lesson files are
  // flattened into their module; the '__unassigned__' fallback bucket is
  // excluded from the Materials view.
  function toMaterialsInput(c: NonNullable<typeof course>): MaterialsInput {
    return {
      modules: (c.modules ?? [])
        .filter((m) => m.id !== '__unassigned__')
        .map((m) => ({
          id: m.id,
          title: m.title,
          locked: m.access === 'mentorship' && !c.mentorship_active,
          files: m.lessons.flatMap((l) =>
            l.files.map((f) => ({
              id: f.id,
              name: f.name,
              size_bytes: f.size_bytes,
              created_at: f.created_at,
              category: f.category,
              lessonId: l.id,
            })),
          ),
        })),
      resources: c.resources.map((r) => ({
        id: r.id,
        name: r.name,
        size_bytes: r.size_bytes,
        created_at: r.created_at,
        category: r.category,
        locked: r.locked,
      })),
    };
  }

  function downloadMaterial(file: MaterialFile) {
    if (file.source === 'lesson-file') download(() => downloadLessonFile(file.id));
    else download(() => downloadResource(file.id));
  }

  return (
    <div className="mx-auto space-y-5" style={{ maxWidth: 880 }}>
      <button
        onClick={() => router.push('/training-library')}
        className="text-sm text-ink-muted hover:text-ink"
      >
        ← Back to Module Library
      </button>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '3px 8px',
              borderRadius: 4,
              color: 'white',
              background: course.access === 'free' ? 'var(--success)' : PURPLE,
            }}
          >
            {course.access === 'free' ? 'Free' : 'Mentorship'}
          </span>
          <span className="text-ink-muted" style={{ fontSize: 12 }}>
            Level: {course.level}
          </span>
        </div>
        <h1 className="display font-bold" style={{ fontSize: 26 }}>
          {course.title}
        </h1>
        {course.outcome && (
          <p className="text-ink" style={{ fontSize: 14, marginTop: 6 }}>
            {course.outcome}
          </p>
        )}
        {course.desc && (
          <p className="text-ink-muted" style={{ fontSize: 13, marginTop: 6 }}>
            {course.desc}
          </p>
        )}
        <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {course.instructor}
          {course.instructorTitle ? ` · ${course.instructorTitle}` : ''}
        </p>
      </div>

      {/* Enrolment + progress bar */}
      <div
        className="card flex items-center justify-between"
        style={{ padding: 14, gap: 16 }}
      >
        <div style={{ flex: 1 }}>
          <div className="display font-bold" style={{ fontSize: 13, marginBottom: 6 }}>
            {course.enrolled ? `Progress · ${done}/${total} lessons` : 'Not enrolled'}
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 4,
              background: 'var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: PURPLE,
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
        {!course.enrolled && (
          <button
            onClick={() => enrol.mutate(id)}
            disabled={enrol.isPending}
            style={{
              background: PURPLE,
              color: 'white',
              border: 'none',
              padding: '10px 18px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: enrol.isPending ? 'default' : 'pointer',
              opacity: enrol.isPending ? 0.6 : 1,
            }}
          >
            {enrol.isPending ? 'Enrolling…' : 'Enrol'}
          </button>
        )}
      </div>

      {downloadError && (
        <div className="text-sm text-danger">{downloadError}</div>
      )}

      {/* Content / Materials tab bar */}
      <div className="flex gap-2 border-b border-border">
        {(['content', 'materials'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px capitalize ${
              tab === t ? 'text-ink border-ink' : 'text-ink-muted border-transparent'
            }`}
            style={tab === t ? { borderColor: PURPLE, color: PURPLE } : undefined}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'materials' ? (
        (() => {
          const { tree, stats } = buildTree(toMaterialsInput(course));
          return (
            <MaterialsBrowser
              tree={tree}
              stats={stats}
              onDownload={downloadMaterial}
            />
          );
        })()
      ) : (
        <>
      {/* Modules → Lessons */}
      {modules.length === 0 ? (
        <p className="text-ink-muted text-sm">No lessons in this course yet.</p>
      ) : (
        <div className="space-y-6">
          {modules.map((m) => (
            <section key={m.id} className="space-y-3">
              {/* Only show module heading when there is more than one module or
                  when the module has a real (non-fallback) id */}
              {m.id !== '__unassigned__' && (
                <h2 className="display font-bold" style={{ fontSize: 18 }}>
                  {m.title}
                </h2>
              )}
              {m.id === '__unassigned__' && modules.length === 1 && (
                <h2 className="display font-bold" style={{ fontSize: 18 }}>
                  Lessons ({total})
                </h2>
              )}
              {m.lessons.map((l, i) => (
                <article
                  key={l.id}
                  className="card"
                  style={{ padding: 16 }}
                >
                  {/* Lesson header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="display font-bold" style={{ fontSize: 15 }}>
                      {i + 1}. {l.title}
                    </div>
                    <div className="flex items-center gap-2">
                      {l.completed && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: 'var(--success)',
                            textTransform: 'uppercase',
                          }}
                        >
                          Completed
                        </span>
                      )}
                      {l.access === 'mentorship' && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: PURPLE,
                            textTransform: 'uppercase',
                          }}
                        >
                          {l.locked ? 'Locked' : 'Mentorship'}
                        </span>
                      )}
                    </div>
                  </div>

                  {l.locked ? (
                    /* Locked lesson: show teaser only */
                    <div className="text-ink-muted" style={{ fontSize: 13 }}>
                      {l.teaser || 'Unlock mentorship to view this lesson.'}
                    </div>
                  ) : (
                    <>
                      {/* Markdown body */}
                      {l.body ? (
                        <div className="prose prose-sm max-w-none text-ink">
                          <ReactMarkdown>{l.body}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="text-ink-muted" style={{ fontSize: 13 }}>
                          No written content for this lesson.
                        </div>
                      )}

                      {/* Legacy single attachment (attachment_name) */}
                      {l.attachment_name && (
                        <div style={{ fontSize: 12, marginTop: 8 }}>
                          <button
                            onClick={() =>
                              download(() => downloadLessonAttachment(l.id))
                            }
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              color: PURPLE,
                              fontWeight: 600,
                            }}
                          >
                            ↓ {l.attachment_name}
                          </button>{' '}
                          <span className="text-ink-muted">
                            {l.attachment_size_bytes
                              ? `(${fmtSize(l.attachment_size_bytes)})`
                              : ''}
                          </span>
                        </div>
                      )}

                      {/* Files grouped by category */}
                      {CATEGORIES.map((c) => {
                        const files = l.files.filter((f) => f.category === c.key);
                        if (files.length === 0) return null;
                        return (
                          <div key={c.key} className="pt-2">
                            <p
                              className="text-ink-muted"
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                marginBottom: 4,
                              }}
                            >
                              {c.label}
                            </p>
                            <ul className="space-y-1">
                              {files.map((f) => (
                                <li key={f.id}>
                                  <DownloadLink
                                    file={f}
                                    onError={setDownloadError}
                                  />
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}

                      {/* Mark complete / not done */}
                      <div style={{ marginTop: 12 }}>
                        <button
                          onClick={() =>
                            setComplete.mutate({
                              lessonId: l.id,
                              completed: !l.completed,
                            })
                          }
                          disabled={setComplete.isPending}
                          style={{
                            background: l.completed ? 'white' : PURPLE,
                            color: l.completed ? 'var(--ink)' : 'white',
                            border: l.completed
                              ? '1px solid var(--border)'
                              : 'none',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {l.completed ? 'Mark not done' : 'Mark complete'}
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      )}

      {/* Resources */}
      {course.resources.length > 0 && (
        <section className="space-y-2">
          <h2 className="display font-bold" style={{ fontSize: 18 }}>
            Resources ({course.resources.length})
          </h2>
          {course.resources.map((r) => (
            <div
              key={r.id}
              className="card flex items-center justify-between"
              style={{ padding: 12 }}
            >
              <span className="text-ink" style={{ fontSize: 13 }}>
                {r.name}{' '}
                <span className="text-ink-muted" style={{ fontSize: 11 }}>
                  {r.access === 'free' ? 'Free' : 'Mentorship'}
                  {r.size_bytes ? ` · ${fmtSize(r.size_bytes)}` : ''}
                </span>
              </span>
              {r.locked ? (
                <span className="text-ink-muted" style={{ fontSize: 11 }}>
                  Locked
                </span>
              ) : (
                <button
                  onClick={() => download(() => downloadResource(r.id))}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: PURPLE,
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  ↓ Download
                </button>
              )}
            </div>
          ))}
        </section>
      )}
        </>
      )}
    </div>
  );
}
