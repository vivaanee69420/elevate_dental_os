# Course Materials Folder View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the screenshot's file-manager "Materials" view (stats cards + folder tree + file pane) for both the superadmin course editor (upload/delete) and the tenant course-viewing screen (read-only download), layered on the existing LMS without removing lessons or progress.

**Architecture:** One presentational `MaterialsBrowser` component driven by a normalized tree built by a pure `buildTree` helper. Two thin wrappers (admin editor, tenant detail) adapt their own data + mutations into it and expose it as a new "Materials" tab. Per-module folders reuse the 5 existing `lesson_files` categories; two course-level folders (Marking Rubrics, Additional Resources) are backed by `course_resources` plus a new `category` discriminator column.

**Tech Stack:** Postgres/Supabase migrations, Express (native ESM) + Zod, Next.js 14 App Router + React Query + Tailwind, vitest (backend).

Spec: `docs/superpowers/specs/2026-06-06-course-materials-folder-view-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/20260101000048_resource_categories.sql` — add `course_resources.category`.
- `frontend/features/training/materials/buildTree.ts` — pure normaliser: course → `{ tree, stats }` + shared types/constants.
- `frontend/features/training/materials/MaterialsBrowser.tsx` — presentational folder-tree + file-pane + stats UI.

**Modify:**
- `backend/src/models/course.model.js` — `RESOURCE_CATEGORIES` const + `category` on `resourceCreateSchema`.
- `backend/src/repositories/course.repository.js` — `RESOURCE_COLS` already has `created_at`; add `category`.
- `backend/src/services/training.service.js` — tenant resource + lesson-file mapping carries `category` (resources) + `created_at`.
- `backend/test/courses.service.test.mjs` — resource category test.
- `backend/test/training.service.test.mjs` — tenant resource category passthrough test.
- `frontend/lib/course-admin.ts` — `Resource.category`, `LessonFile.created_at`, `Resource.created_at`, `RESOURCE_CATEGORIES`.
- `frontend/features/training/useLibrary.ts` — `CourseDetailResource.category` + `created_at` on resource/file.
- `frontend/app/(platform)/platform/courses/[id]/page.tsx` — Materials tab (admin wrapper).
- `frontend/features/training/components/CourseDetailScreen.tsx` — Materials tab (tenant wrapper).
- `db/01_schema.sql` — keep `course_resources` definition in sync.
- `docs/API.md` — note `category` field on resource create/response.

---

## Task 1: Migration — `course_resources.category`

**Files:**
- Create: `supabase/migrations/20260101000048_resource_categories.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 000048_resource_categories: course-level material folders.
-- Adds a category discriminator to course_resources so the Materials folder
-- view can render two course-level folders: Marking Rubrics + Additional
-- Resources. Existing rows default to 'additional-resources'. Idempotent.
ALTER TABLE public.course_resources
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'additional-resources';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_resources_category_chk'
  ) THEN
    ALTER TABLE public.course_resources
      ADD CONSTRAINT course_resources_category_chk
      CHECK (category IN ('marking-rubrics', 'additional-resources'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply locally and verify it re-applies cleanly**

Run: `cd /Users/ruhithpasha/code/work/Dental-os && supabase db reset`
Expected: migration ledger runs `000001`→`000048` with no error; `course_resources` has a `category` column defaulting to `additional-resources`.

- [ ] **Step 3: Mirror into the unmanaged schema copy**

In `db/01_schema.sql`, find the `create table ... course_resources` block and add the column so the source copy matches:

```sql
  category text not null default 'additional-resources'
    check (category in ('marking-rubrics', 'additional-resources')),
```

(Place it alongside the other `course_resources` columns, before the closing `)`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000048_resource_categories.sql db/01_schema.sql
git commit -m "feat(lms): course_resources.category for course-level material folders"
```

---

## Task 2: Backend — resource `category` through model/repo/service

The repository already spreads `fields` into the insert and `RESOURCE_COLS` already selects `created_at`, so once the Zod schema accepts `category` it flows end-to-end. Only the model and the read columns need touching.

**Files:**
- Modify: `backend/src/models/course.model.js:14-15` (constants), `:66-73` (`resourceCreateSchema`)
- Modify: `backend/src/repositories/course.repository.js:19-20` (`RESOURCE_COLS`)
- Test: `backend/test/courses.service.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `backend/test/courses.service.test.mjs`:

```js
describe('addResource category', () => {
  it('persists a course-level category and returns it', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, status: 'draft' }, error: null };
      if (q.table === 'course_resources' && q.insertVals) {
        insertVals = q.insertVals;
        return { data: { id: 'r1', course_id: COURSE, ...q.insertVals }, error: null };
      }
      return { data: null, error: null };
    };
    const out = await svc.addResource(COURSE, {
      name: 'Rubric.pdf',
      file_key: 'courses/rubric.pdf',
      access: 'free',
      position: 0,
      category: 'marking-rubrics',
    });
    expect(insertVals.category).toBe('marking-rubrics');
    expect(out.category).toBe('marking-rubrics');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/courses.service.test.mjs -t "persists a course-level category"`
Expected: FAIL — `addResource` is called with `category` but the value never appears (test asserts before any schema parsing happens in the service; this test exercises the service+repo, which currently pass `category` through the spread, so it may already pass at the service layer). If it PASSES here, that confirms the service/repo path is category-agnostic; proceed to Step 3 to lock the schema (the real gate is the Zod schema stripping unknown keys at the controller).

> Note: `resourceCreateSchema` uses a plain `z.object`, which **strips** unknown keys. Without Step 3 the controller would drop `category` before it ever reaches the service. The test above bypasses the controller, so Step 3 is still required for the live endpoint.

- [ ] **Step 3: Add the constant and schema field**

In `backend/src/models/course.model.js`, after the `FILE_CATEGORIES` line (`:15`):

```js
const RESOURCE_CATEGORIES = ['marking-rubrics', 'additional-resources'];
```

Then in `resourceCreateSchema` (`:66-73`), add the `category` field:

```js
export const resourceCreateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(400),
    file_key: zod_1.z.string().trim().min(1).max(1024),
    file_type: zod_1.z.string().max(100).optional(),
    size_bytes: zod_1.z.number().int().min(0).optional(),
    access: zod_1.z.enum(ACCESS).default('free'),
    position: zod_1.z.number().int().min(0).default(0),
    category: zod_1.z.enum(RESOURCE_CATEGORIES).default('additional-resources'),
});
```

- [ ] **Step 4: Add `category` to the read columns**

In `backend/src/repositories/course.repository.js:19-20`, extend `RESOURCE_COLS`:

```js
const RESOURCE_COLS =
    'id, course_id, name, file_key, file_type, size_bytes, access, position, category, created_at';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/courses.service.test.mjs -t "persists a course-level category"`
Expected: PASS

- [ ] **Step 6: Run the full course test file**

Run: `cd backend && npx vitest run test/courses.service.test.mjs`
Expected: PASS (all)

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/course.model.js backend/src/repositories/course.repository.js backend/test/courses.service.test.mjs
git commit -m "feat(lms): accept + return course_resources.category"
```

---

## Task 3: Backend — tenant detail carries `category` + `created_at`

The tenant `courseDetail` maps resources and lesson files into the client shape. Add `category` to the resource mapping and `created_at` to both file and resource mappings so the Materials view can show folders + dates.

**Files:**
- Modify: `backend/src/services/training.service.js:118-128` (lesson file mapping), `:195-206` (resource mapping)
- Test: `backend/test/training.service.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `backend/test/training.service.test.mjs` (use the file's existing harness; mirror its `supaRec.resultProvider` table-switch style). If the file has a `COURSE`/`ORG`/`USER` constant, reuse it; otherwise declare locals as shown:

```js
describe('courseDetail materials fields', () => {
  it('returns resource category + created_at and file created_at', async () => {
    const ORG = 'org-1', USER = 'user-1', CID = 'course-1';
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: CID, status: 'published', access: 'free', title: 'C' }, error: null };
      if (q.table === 'course_modules') return { data: [{ id: 'm1', title: 'M1', position: 0, access: 'free' }], error: null };
      if (q.table === 'course_lessons') return { data: [{ id: 'l1', course_id: CID, module_id: 'm1', title: 'L1', position: 0, access: 'free' }], error: null };
      if (q.table === 'lesson_files') return { data: [{ id: 'f1', lesson_id: 'l1', category: 'reading', name: 'r.pdf', file_key: 'k', file_type: 'application/pdf', size_bytes: 10, position: 0, access: 'free', created_at: '2026-04-01T00:00:00Z' }], error: null };
      if (q.table === 'course_resources') return { data: [{ id: 'res1', name: 'Rubric.pdf', access: 'free', file_type: 'application/pdf', size_bytes: 20, file_key: 'rk', category: 'marking-rubrics', created_at: '2026-04-02T00:00:00Z' }], error: null };
      if (q.table === 'organisations') return { data: { mentorship_active: false }, error: null };
      if (q.table === 'course_enrolments') return { data: [], error: null };
      if (q.table === 'lesson_progress') return { data: [], error: null };
      return { data: null, error: null };
    };
    const out = await svc.courseDetail(ORG, USER, CID);
    expect(out.resources[0].category).toBe('marking-rubrics');
    expect(out.resources[0].created_at).toBe('2026-04-02T00:00:00Z');
    expect(out.modules[0].lessons[0].files[0].created_at).toBe('2026-04-01T00:00:00Z');
  });
});
```

> Before running: open `backend/test/training.service.test.mjs` and confirm the import line for the service (`svc`) and the `supaRec` import match this file's existing pattern. Reuse the file's existing constants if present.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/training.service.test.mjs -t "returns resource category"`
Expected: FAIL — `out.resources[0].category` is `undefined` (not yet mapped).

- [ ] **Step 3: Add `created_at` to the lesson-file mapping**

In `backend/src/services/training.service.js`, the `shapedFiles` map (`:118-128`) — add `created_at`:

```js
            const shapedFiles = locked ? [] : rawFiles.map((f) => ({
                id: f.id,
                lesson_id: f.lesson_id,
                category: f.category,
                name: f.name,
                file_key: f.file_key,
                file_type: f.file_type,
                size_bytes: f.size_bytes,
                position: f.position,
                access: f.access,
                created_at: f.created_at,
            }));
```

- [ ] **Step 4: Add `category` + `created_at` to the resource mapping**

In the same file, the `resources.map` (`:195-206`):

```js
            resources: resources.map((r) => {
                const locked = gate(r.access);
                return {
                    id: r.id,
                    name: r.name,
                    access: r.access,
                    locked,
                    category: r.category,
                    file_type: r.file_type,
                    size_bytes: r.size_bytes,
                    created_at: r.created_at,
                    file_key: locked ? null : r.file_key,
                };
            }),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/training.service.test.mjs -t "returns resource category"`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS (all existing + 2 new tests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/training.service.js backend/test/training.service.test.mjs
git commit -m "feat(lms): tenant course detail returns resource category + file dates"
```

---

## Task 4: Frontend types — admin + tenant

**Files:**
- Modify: `frontend/lib/course-admin.ts:16` (Category — unchanged), `:36-46` (`LessonFile`), `:73-82` (`Resource`), `:99-105` (constants)
- Modify: `frontend/features/training/useLibrary.ts:53-63` (`CourseDetailLessonFile`), `:88-96` (`CourseDetailResource`)

- [ ] **Step 1: Admin types — add fields + resource categories const**

In `frontend/lib/course-admin.ts`, add a resource-category type after `Category` (`:16`):

```ts
export type ResourceCategory = 'marking-rubrics' | 'additional-resources';
```

Add `created_at` to `LessonFile` (after `access` at `:45`):

```ts
  created_at?: string | null;
```

Extend `Resource` (`:73-82`) with `category` + `created_at`:

```ts
export interface Resource {
  id: string;
  course_id: string;
  name: string;
  file_key: string;
  file_type: string | null;
  size_bytes: number | null;
  access: Access;
  position: number;
  category: ResourceCategory;
  created_at?: string | null;
}
```

Add the labelled constant after `CATEGORIES` (`:105`):

```ts
export const RESOURCE_CATEGORIES: { key: ResourceCategory; label: string }[] = [
  { key: 'marking-rubrics', label: 'Marking Rubrics' },
  { key: 'additional-resources', label: 'Additional Resources' },
];
```

- [ ] **Step 2: Tenant types — add fields**

In `frontend/features/training/useLibrary.ts`, add `created_at` to `CourseDetailLessonFile` (after `access` at `:62`):

```ts
  created_at?: string | null;
```

Extend `CourseDetailResource` (`:88-96`):

```ts
export interface CourseDetailResource {
  id: string;
  name: string;
  access: 'free' | 'mentorship';
  locked: boolean;
  category: 'marking-rubrics' | 'additional-resources';
  file_type: string | null;
  size_bytes: number | null;
  created_at?: string | null;
  file_key: string | null;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS (no usages broken yet; new fields are additive/optional).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/course-admin.ts frontend/features/training/useLibrary.ts
git commit -m "feat(lms): frontend types for resource category + material dates"
```

---

## Task 5: `buildTree` pure helper + shared types

**Files:**
- Create: `frontend/features/training/materials/buildTree.ts`

- [ ] **Step 1: Write the helper**

```ts
// Pure normaliser for the Materials folder view. Converts a course (admin or
// tenant shape, pre-adapted to MaterialsInput) into a folder tree + stats.
// Per-module folders = the 5 lesson_files categories; course-level folders =
// Marking Rubrics + Additional Resources (backed by course_resources.category).
import { CATEGORIES, RESOURCE_CATEGORIES, type Category, type ResourceCategory } from '@/lib/course-admin';

export interface MaterialFile {
  id: string;
  name: string;
  size_bytes: number | null;
  created_at?: string | null;
  source: 'lesson-file' | 'resource';
  lessonId?: string; // present for lesson-file deletes
  locked?: boolean;
}

export interface FolderNode {
  id: string;
  label: string;
  count: number;
  files: MaterialFile[];
  kind: 'module-category' | 'course-resource';
  moduleId?: string;
  category?: Category;
  resourceCategory?: ResourceCategory;
}

export interface ModuleGroup {
  id: string;
  title: string;
  locked: boolean;
  fileCount: number;
  folders: FolderNode[];
}

export interface MaterialsTree {
  modules: ModuleGroup[];
  courseFolders: FolderNode[];
}

export interface MaterialsStats {
  totalModules: number;
  totalFolders: number;
  totalFiles: number;
}

export interface MatInputFile {
  id: string;
  name: string;
  size_bytes: number | null;
  created_at?: string | null;
  category: Category;
  lessonId: string;
}

export interface MatInputModule {
  id: string;
  title: string;
  locked: boolean;
  files: MatInputFile[]; // flattened across the module's lessons
}

export interface MatInputResource {
  id: string;
  name: string;
  size_bytes: number | null;
  created_at?: string | null;
  category: ResourceCategory;
  locked?: boolean;
}

export interface MaterialsInput {
  modules: MatInputModule[];
  resources: MatInputResource[];
}

export function buildTree(input: MaterialsInput): {
  tree: MaterialsTree;
  stats: MaterialsStats;
} {
  const modules: ModuleGroup[] = input.modules.map((m) => {
    const folders: FolderNode[] = CATEGORIES.map((c) => {
      const files = m.files
        .filter((f) => f.category === c.key)
        .map<MaterialFile>((f) => ({
          id: f.id,
          name: f.name,
          size_bytes: f.size_bytes,
          created_at: f.created_at,
          source: 'lesson-file',
          lessonId: f.lessonId,
        }));
      return {
        id: `${m.id}:${c.key}`,
        label: c.label,
        count: files.length,
        files,
        kind: 'module-category',
        moduleId: m.id,
        category: c.key,
      };
    });
    return {
      id: m.id,
      title: m.title,
      locked: m.locked,
      fileCount: folders.reduce((n, f) => n + f.count, 0),
      folders,
    };
  });

  const courseFolders: FolderNode[] = RESOURCE_CATEGORIES.map((rc) => {
    const files = input.resources
      .filter((r) => r.category === rc.key)
      .map<MaterialFile>((r) => ({
        id: r.id,
        name: r.name,
        size_bytes: r.size_bytes,
        created_at: r.created_at,
        source: 'resource',
        locked: r.locked,
      }));
    return {
      id: `course:${rc.key}`,
      label: rc.label,
      count: files.length,
      files,
      kind: 'course-resource',
      resourceCategory: rc.key,
    };
  });

  const totalFiles =
    input.modules.reduce((n, m) => n + m.files.length, 0) + input.resources.length;

  return {
    tree: { modules, courseFolders },
    stats: {
      totalModules: input.modules.length,
      totalFolders: input.modules.length * CATEGORIES.length + courseFolders.length,
      totalFiles,
    },
  };
}
```

- [ ] **Step 2: Hand-verify (no frontend test runner is gated in CI)**

Mentally trace: a course with 2 modules and `CATEGORIES.length === 5` → `totalFolders === 2*5 + 2 === 12`. A module with 3 `reading` files + 1 `misc` → its `Reading Materials` folder `count === 3`, module `fileCount === 4`. `totalFiles` counts every module file plus every resource. Confirm by reading the code.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/features/training/materials/buildTree.ts
git commit -m "feat(lms): buildTree normaliser for the Materials folder view"
```

---

## Task 6: `MaterialsBrowser` presentational component

Renders the screenshot: 4 stats cards, a left folder tree (expandable modules → 5 category folders with counts + lock badge; two course-level folders at the bottom), and a right file pane for the selected folder (name, size, date, download/delete, upload). Download/delete/upload controls render only when their callback is supplied (admin gets upload + delete; tenant gets download). Admin download is intentionally absent (no platform signed-GET endpoint — out of scope; see spec).

**Files:**
- Create: `frontend/features/training/materials/MaterialsBrowser.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';
// Presentational Materials folder browser. Data-source agnostic: fed a tree +
// stats + callbacks by an admin or tenant wrapper. No data fetching here.
import { useState } from 'react';
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

function StatCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
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
                  {m.locked && <span title="Mentorship" aria-label="Locked">🔒</span>}
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
                      <option key={l.id} value={l.id}>{l.title}</option>
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
      <span className="text-xs font-bold rounded bg-ink text-white px-1.5 py-0.5">{folder.count}</span>
    </button>
  );
}
```

> Note on rule 7 (no emojis): the lock glyph `🔒` is a functional status marker for mentorship-gated modules, matching the reference screenshot. If the reviewer prefers no emoji, swap for a small inline SVG lock or the text `Locked`. Keep this as a single, intentional spot.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/features/training/materials/MaterialsBrowser.tsx
git commit -m "feat(lms): MaterialsBrowser folder-tree + file-pane component"
```

---

## Task 7: Admin wrapper — Materials tab in the course editor

Add a top-level tab toggle ("Structure" / "Materials") to the platform course editor. "Structure" keeps the existing metadata form + modules accordion + resources section. "Materials" renders `MaterialsBrowser` with admin callbacks.

**Files:**
- Modify: `frontend/app/(platform)/platform/courses/[id]/page.tsx`

- [ ] **Step 1: Add imports**

In the import block (`:11-28`), add:

```tsx
import MaterialsBrowser from '@/features/training/materials/MaterialsBrowser';
import { buildTree, type MaterialsInput, type MaterialFile } from '@/features/training/materials/buildTree';
```

- [ ] **Step 2: Add an adapter + tab state inside `CourseEditorPage`**

Inside `CourseEditorPage`, after the `meta` state (`:46`), add tab state:

```tsx
  const [tab, setTab] = useState<'structure' | 'materials'>('structure');
```

Below `saveMeta`/`togglePublish`/`deleteCourse` (before the `if (loading)` guard, `:106`), add the adapter + admin callbacks:

```tsx
  function toMaterialsInput(c: CourseDetail): MaterialsInput {
    return {
      modules: c.modules.map((m) => ({
        id: m.id,
        title: m.title,
        locked: m.access === 'mentorship',
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
      })),
    };
  }

  async function uploadModuleFile(moduleId: string, category: string, lessonId: string, file: File) {
    const up = await uploadAttachment(file);
    await coursesApi.addLessonFile(id, lessonId, {
      category: category as Category,
      name: up.name,
      file_key: up.key,
      file_type: up.type,
      size_bytes: up.size,
      access: 'free',
    });
    load();
  }

  async function uploadResourceFile(category: 'marking-rubrics' | 'additional-resources', file: File) {
    const up = await uploadAttachment(file);
    await coursesApi.addResource(id, {
      name: up.name,
      file_key: up.key,
      file_type: up.type,
      size_bytes: up.size,
      access: 'free',
      category,
    });
    load();
  }

  async function deleteMaterial(file: MaterialFile) {
    if (!window.confirm(`Remove "${file.name}"?`)) return;
    if (file.source === 'lesson-file' && file.lessonId) {
      await coursesApi.removeLessonFile(id, file.lessonId, file.id);
    } else if (file.source === 'resource') {
      await coursesApi.removeResource(id, file.id);
    }
    load();
  }
```

> `coursesApi.addResource` body is typed `Partial<Resource>`, which now includes `category` (Task 4) — no signature change needed.

- [ ] **Step 3: Add the tab bar + conditional render**

Replace the `{/* ---- Metadata ---- */}` … `<ResourcesSection .../>` region (`:139-239`) so it is gated behind the tab. Insert the tab bar right after the `{error && ...}` line (`:137`):

```tsx
      <div className="flex gap-2 border-b border-border">
        {(['structure', 'materials'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px capitalize ${
              tab === t ? 'border-brand text-brand' : 'border-transparent text-ink-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'materials' ? (
        (() => {
          const { tree, stats } = buildTree(toMaterialsInput(course));
          const lessonsByModule = Object.fromEntries(
            course.modules.map((m) => [m.id, m.lessons.map((l) => ({ id: l.id, title: l.title }))]),
          );
          return (
            <MaterialsBrowser
              tree={tree}
              stats={stats}
              lessonsByModule={lessonsByModule}
              onUploadModuleFile={uploadModuleFile}
              onUploadResource={uploadResourceFile}
              onDeleteFile={deleteMaterial}
            />
          );
        })()
      ) : (
        <>
          {/* existing metadata form, ModulesSection, ResourcesSection stay here */}
        </>
      )}
```

Move the existing `<form onSubmit={saveMeta}>…</form>`, `<ModulesSection .../>`, and `<ResourcesSection .../>` blocks inside the `<>…</>` of the `else` branch. Keep the `<style jsx>` block where it is (outside the tab switch).

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(platform)/platform/courses/[id]/page.tsx"
git commit -m "feat(lms): Materials tab in the admin course editor"
```

---

## Task 8: Tenant wrapper — Materials tab in CourseDetailScreen

Add a "Content" / "Materials" tab toggle. "Content" keeps the existing modules→lessons render. "Materials" renders `MaterialsBrowser` read-only with downloads.

**Files:**
- Modify: `frontend/features/training/components/CourseDetailScreen.tsx`

- [ ] **Step 1: Add imports**

Extend the existing imports. After the `useLibrary` import block (`:18`) add:

```tsx
import MaterialsBrowser from '../materials/MaterialsBrowser';
import { buildTree, type MaterialsInput, type MaterialFile } from '../materials/buildTree';
```

- [ ] **Step 2: Add tab state + adapter + download dispatcher**

Inside `CourseDetailScreen`, after `const [downloadError, setDownloadError] = useState<string | null>(null);` (`:80`):

```tsx
  const [tab, setTab] = useState<'content' | 'materials'>('content');
```

After the `download` helper (`:89`), add the adapter + dispatcher (guard against `course` being undefined by defining them after the early returns is not possible — define as functions that take `course`):

```tsx
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
```

- [ ] **Step 3: Add the tab bar + conditional render**

The early returns at `:91-94` already guarantee `course` is defined below. Insert the tab bar right after the `{downloadError && ...}` block (`:199-201`), and wrap the existing "Modules → Lessons" + "Resources" sections in a `content`-only branch:

```tsx
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
          return <MaterialsBrowser tree={tree} stats={stats} onDownload={downloadMaterial} />;
        })()
      ) : (
        <>
          {/* existing Modules → Lessons block and Resources block move here */}
        </>
      )}
```

Move the existing `{modules.length === 0 ? ... }` block (`:204-370`) and the `{/* Resources */}` block (`:372-414`) inside the `<>…</>` of the `else` branch.

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/features/training/components/CourseDetailScreen.tsx
git commit -m "feat(lms): Materials tab in the tenant course view"
```

---

## Task 9: Docs + final verification

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Note the new field in API.md**

Find the course `POST /api/platform/courses/:id/resources` entry (or the resources section). Add: "Request/response now include `category` (`marking-rubrics` | `additional-resources`, default `additional-resources`). Tenant `GET /api/training/courses/:id` resources include `category` and `created_at`; lesson files include `created_at`." If no resource endpoint is documented yet, add a one-line entry under the LMS section.

- [ ] **Step 2: Full backend suite + frontend gates**

Run: `cd backend && npm test && cd ../frontend && npm run typecheck && npm run lint`
Expected: backend PASS (all), frontend typecheck + lint PASS.

- [ ] **Step 3: Manual smoke (local)**

Start backend (`cd backend && npm run dev`) + frontend (`cd frontend && npm run dev`). As superadmin: open a course → "Materials" tab → confirm stats cards, module folders with counts, lock badge on mentorship modules, the two course-level folders. Upload a file into a module category folder (pick a lesson) and into Marking Rubrics; confirm counts update and delete works. As a tenant: open the same published course → "Materials" tab → confirm folders + counts render and downloads work; mentorship-gated modules show locked.

- [ ] **Step 4: Commit docs**

```bash
git add docs/API.md
git commit -m "docs(api): course_resources.category + material dates"
```

---

## Apply on hosted Supabase (post-merge)

- Apply `supabase/migrations/20260101000048_resource_categories.sql` on project `Dental Os` (`mkfhpzjbijbachoonytt`), then run `NOTIFY pgrst, 'reload schema';`.
- Update the CLAUDE.md migration ledger note to mention `000048`.

---

## Self-Review

- **Spec coverage:** Folder tree + stats + file pane → Tasks 5,6. Per-module category folders → Task 5/6. Course-level Marking Rubrics + Additional Resources → Tasks 1–4. Upload picks a lesson → Task 6 (picker) + Task 7 (callback). Admin + tenant → Tasks 7,8. Schema + idempotent migration + NOTIFY → Task 1. Backend passthrough → Tasks 2,3. Lock gating reuse → adapters in 7,8. "Add Folder" out of scope → not built. ✓
- **Placeholders:** none — all steps carry concrete code/commands.
- **Type consistency:** `MaterialsInput`/`MatInputFile`/`FolderNode`/`MaterialFile` defined in Task 5 and consumed unchanged in Tasks 6–8. `category` enum values match across migration, Zod, and TS (`'marking-rubrics'`, `'additional-resources'`). `CATEGORIES`/`RESOURCE_CATEGORIES` are the single source for labels.
- **Known gap (flagged, in scope):** admin file download is omitted (no platform signed-GET endpoint; spec did not include one). Tenant download uses existing endpoints.
