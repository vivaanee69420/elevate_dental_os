'use client';
// Presentational Materials folder browser. Data-source agnostic: fed a tree +
// stats + callbacks by an admin or tenant wrapper. No data fetching here.
import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { MaterialsTree, MaterialsStats, FolderNode, MaterialFile } from './buildTree';

export function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB'); // dd/mm/yyyy
}

interface UploadModuleFile {
  (moduleId: string, category: string, lessonId: string, file: File): Promise<void>;
}
interface UploadResource {
  (category: 'marking-rubrics' | 'additional-resources', file: File): Promise<void>;
}

interface MaterialsBrowserProps {
  tree: MaterialsTree;
  stats: MaterialsStats;
  /** Tenant-only: download a file (lesson file or resource). */
  onDownload?: (file: MaterialFile) => void;
  /** Admin-only: lessons per module, for the upload lesson picker. */
  lessonsByModule?: Record<string, { id: string; title: string }[]>;
  onUploadModuleFile?: UploadModuleFile;
  onUploadResource?: UploadResource;
  onDeleteFile?: (file: MaterialFile) => Promise<void>;
}

// Mentorship lock badge — rule 7: no emoji. Small inline lucide lock icon.
function LockBadge() {
  return (
    <span
      className="inline-flex items-center text-ink-muted"
      role="img"
      aria-label="Mentorship locked"
      title="Mentorship locked"
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
    </span>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="text-xs font-semibold text-ink-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? 'text-brand' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

export default function MaterialsBrowser({
  tree,
  stats,
  onDownload,
  lessonsByModule,
  onUploadModuleFile,
  onUploadResource,
  onDeleteFile,
}: MaterialsBrowserProps) {
  // Default selection: first module's first folder, else first course folder.
  const firstFolder = tree.modules[0]?.folders[0] ?? tree.courseFolders[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstFolder?.id ?? null);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>(
    tree.modules[0] ? { [tree.modules[0].id]: true } : {},
  );
  const [pickedLesson, setPickedLesson] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const allFolders: FolderNode[] = [
    ...tree.modules.flatMap((m) => m.folders),
    ...tree.courseFolders,
  ];
  const selected = allFolders.find((f) => f.id === selectedId) ?? null;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setBusy(true);
    try {
      if (selected.kind === 'module-category' && onUploadModuleFile) {
        const lessonId = pickedLesson || lessonsByModule?.[selected.moduleId!]?.[0]?.id;
        if (!lessonId) throw new Error('Add a lesson to this module before uploading files.');
        await onUploadModuleFile(selected.moduleId!, selected.category!, lessonId, file);
      } else if (selected.kind === 'course-resource' && onUploadResource) {
        await onUploadResource(selected.resourceCategory!, file);
      }
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  const canUpload =
    selected &&
    ((selected.kind === 'module-category' && !!onUploadModuleFile) ||
      (selected.kind === 'course-resource' && !!onUploadResource));
  const moduleLessons =
    selected?.kind === 'module-category' ? lessonsByModule?.[selected.moduleId!] ?? [] : [];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Modules" value={stats.totalModules} />
        <StatCard label="Total Folders" value={stats.totalFolders} />
        <StatCard label="Total Files" value={stats.totalFiles} />
        <StatCard label="Selected" value={selected?.label ?? '—'} accent />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-5">
        {/* Folder tree */}
        <div className="rounded-lg border border-border bg-white p-4">
          <h3 className="font-bold text-ink mb-3">Folder Structure</h3>
          <div className="space-y-1">
            {tree.modules.map((m) => (
              <div key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenModules((o) => ({ ...o, [m.id]: !o[m.id] }))}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg text-sm font-semibold text-ink"
                >
                  <span className="text-ink-muted">{openModules[m.id] ? '▾' : '▸'}</span>
                  <span className="flex-1 text-left">{m.title}</span>
                  {m.locked && <LockBadge />}
                  <span className="text-xs font-bold rounded bg-ink text-white px-1.5 py-0.5">
                    {m.fileCount}
                  </span>
                </button>
                {openModules[m.id] && (
                  <div className="ml-5 space-y-0.5">
                    {m.folders.map((f) => (
                      <FolderRow
                        key={f.id}
                        folder={f}
                        active={f.id === selectedId}
                        onClick={() => {
                          setSelectedId(f.id);
                          setPickedLesson('');
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="pt-2 mt-2 border-t border-border space-y-0.5">
              {tree.courseFolders.map((f) => (
                <FolderRow
                  key={f.id}
                  folder={f}
                  active={f.id === selectedId}
                  onClick={() => setSelectedId(f.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* File pane */}
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-ink">{selected?.label ?? 'Select a folder'}</h3>
            {canUpload && (
              <div className="flex items-center gap-2">
                {selected?.kind === 'module-category' && moduleLessons.length > 0 && (
                  <select
                    value={pickedLesson}
                    onChange={(e) => setPickedLesson(e.target.value)}
                    className="px-2 py-1 rounded border border-border text-xs"
                    aria-label="Attach to lesson"
                  >
                    {moduleLessons.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                )}
                <label className="px-3 py-1.5 rounded bg-ink text-white text-xs font-semibold cursor-pointer">
                  {busy ? 'Uploading…' : 'Upload File'}
                  <input type="file" className="hidden" onChange={handleUpload} disabled={busy} />
                </label>
              </div>
            )}
          </div>

          {!selected || selected.files.length === 0 ? (
            <p className="text-sm text-ink-muted">No files in this folder.</p>
          ) : (
            <ul className="space-y-2">
              {selected.files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">{file.name}</div>
                    <div className="text-xs text-ink-muted">
                      {fmtSize(file.size_bytes)}
                      {file.created_at ? ` · ${fmtDate(file.created_at)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {onDownload && !file.locked && (
                      <button
                        type="button"
                        onClick={() => onDownload(file)}
                        className="text-xs font-semibold text-brand"
                        aria-label={`Download ${file.name}`}
                      >
                        ↓ Download
                      </button>
                    )}
                    {file.locked && <span className="text-xs text-ink-muted">Locked</span>}
                    {onDeleteFile && (
                      <button
                        type="button"
                        onClick={() => onDeleteFile(file)}
                        className="text-xs font-semibold text-danger"
                        aria-label={`Delete ${file.name}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function FolderRow({
  folder,
  active,
  onClick,
}: {
  folder: FolderNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
        active ? 'bg-brand/10 text-brand font-semibold' : 'text-ink hover:bg-bg'
      }`}
    >
      <span className="flex-1 text-left truncate">{folder.label}</span>
      <span className="text-xs font-bold rounded bg-ink text-white px-1.5 py-0.5">
        {folder.count}
      </span>
    </button>
  );
}
