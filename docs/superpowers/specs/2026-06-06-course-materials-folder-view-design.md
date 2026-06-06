# Course Materials Folder View — Design

Date: 2026-06-06
Status: Approved
Branch: feat/intelligence-os-phase0

## Goal

Build the file-manager "Materials" UI shown in the reference screenshot (Level 7 Diploma — Materials): a folder tree on the left (modules → category sub-folders, plus course-level folders), a file pane on the right with upload/download/delete, and summary stats cards. Ship it for **both** the superadmin course editor (read/write) and the tenant course-viewing screen (read-only downloads).

This layers on top of the existing LMS — it does **not** replace lessons, markdown bodies, or progress tracking.

## Decisions (from brainstorming)

1. **Keep lessons; add folder view.** Course still has modules → lessons (markdown + completion/progress). The Materials view is a new presentation that aggregates each module's files by category. No lesson layer is removed.
2. **Per-module folders = existing 5 `lesson_files` categories:** presentations, reading, assignments, clinical, misc (labels: Presentations, Reading Materials, Assignment Details, Clinical Cases, Miscellaneous).
3. **Marking Rubrics + Additional Resources = course-level folders, shown once** at the bottom of the tree (siblings of modules, matching the image). Backed by the existing `course_resources` table plus a new `category` discriminator column — NOT added to the `lesson_files` category enum.
4. **Upload target in a module category folder = pick a lesson.** When uploading into a Module → category folder, the user selects which lesson in that module the file attaches to (dropdown), then the file is added via the existing `addLessonFile` path.
5. **Scope = both admin and tenant.** Admin gets the full upload/delete Materials view; tenant gets the same folder-tree layout, read-only, with downloads gated by `mentorship_active`.
6. **"Add Folder" is out of scope.** The taxonomy is fixed (5 per-module categories + 2 course-level). No arbitrary user-created folders.

## Architecture

A single presentational component, `MaterialsBrowser`, renders the entire view (stats cards + folder tree + file pane). It is data-source agnostic: it takes a normalized tree + stats + a selected-folder selector + callbacks, and knows nothing about which API backs it. Two thin wrappers feed it:

- **Admin wrapper** — inside `frontend/app/(platform)/platform/courses/[id]/page.tsx`. Maps the admin `CourseDetail` into the tree, wires `coursesApi` mutations + `uploadAttachment`, and renders the lesson-picker on upload into module category folders.
- **Tenant wrapper** — inside `frontend/features/training/components/CourseDetailScreen.tsx`. Maps the `useLibrary` course into the tree, wires the existing download helpers, and renders read-only (no upload/delete controls).

Both wrappers expose Materials as a **new tab** alongside the existing UI (admin: beside the structure/lessons editor; tenant: beside lesson content). Existing components are not deleted.

A shared pure helper `buildTree.ts` converts a course-detail shape into `{ tree, stats }` so both wrappers produce identical structure.

### Component boundaries

- `MaterialsBrowser` — presentational. Props: `tree`, `stats`, `selectedFolderId`, `onSelectFolder`, `onDownload(file)`, optional `onUpload(folder, lessonId?, file)`, optional `onDelete(file)`, `readOnly`. No data fetching, no API knowledge. Testable in isolation.
- `buildTree(course)` — pure function: course detail → `{ tree: FolderNode[], stats }`. Same input shape normalized from both admin and tenant types via small adapters. Unit-testable.
- Admin/tenant wrappers — own data + mutations only; render `<MaterialsBrowser>`.

## Data model (tree + stats)

```
Tree:
  Module 1   [lock badge if module.access = 'mentorship']   count = files across its lessons
    Presentations        (count of lesson_files category=presentations in this module)
    Reading Materials     (reading)
    Assignment Details    (assignments)
    Clinical Cases        (clinical)
    Miscellaneous         (misc)
  Module 2 ...
  ── course-level ──
  Marking Rubrics         count = course_resources where category='marking-rubrics'
  Additional Resources    count = course_resources where category='additional-resources'

Stats cards:
  Total Modules = modules.length
  Total Folders = modules.length * 5 + 2
  Total Files   = sum(all lesson_files) + sum(all course_resources)
  Selected      = label of currently selected folder (e.g. "Reading Materials")
```

A module category folder aggregates `lesson_files` of that category across **all** lessons in the module (read view). The right pane lists those files with name, size, date, and download (+ delete in admin).

## Schema

One migration: `supabase/migrations/20260101000048_resource_categories.sql`

- Add `course_resources.category text NOT NULL DEFAULT 'additional-resources' CHECK (category IN ('marking-rubrics','additional-resources'))`.
- Backfill: existing rows already default to `'additional-resources'` via the column default.
- Idempotent (guard the `ADD COLUMN` / constraint with `IF NOT EXISTS` / catalog checks so `supabase db reset` re-applies cleanly).
- End with `NOTIFY pgrst, 'reload schema';`.
- `lesson_files` category enum is **unchanged** (5 categories).

Also keep the unmanaged copies `db/01_schema.sql` in sync per CLAUDE.md.

## Backend changes

- `models/course.model.js`: `resourceCreateSchema` gains `category` (enum `['marking-rubrics','additional-resources']`, default `'additional-resources'`). Add a `RESOURCE_CATEGORIES` constant if useful.
- `repositories/course.repository.js`: `createResource` writes `category`; `listResources` / `getResourceById` select `category`.
- `services/course.service.js`: `addResource` passes `category` through.
- `services/training.service.js`: tenant course-detail resource mapping includes `category`.
- No new endpoints — `addResource`, `removeResource`, `addLessonFile`, `removeLessonFile` already cover all mutations.

## Frontend changes

- `lib/course-admin.ts`: `Resource.category: 'marking-rubrics' | 'additional-resources'`; add `RESOURCE_CATEGORIES` const with labels. `addResource` already forwards the body, so include `category` in the upload call.
- `features/training/useLibrary.ts`: `CourseDetailResource.category`. (`CourseDetailCategory` stays the 5 lesson-file categories.)
- New `features/training/materials/buildTree.ts` — pure helper + types (`FolderNode`, `MaterialsStats`).
- New `features/training/materials/MaterialsBrowser.tsx` — presentational component matching the screenshot layout (stats cards, folder tree with counts + lock badges, file pane with upload/download/delete).
- Admin wrapper (`platform/courses/[id]/page.tsx`): add a "Materials" tab; module category folder upload renders a lesson `<select>` (module's lessons) + file input → `addLessonFile`; course-level folder upload → `addResource(category)`; delete via `removeLessonFile` / `removeResource`.
- Tenant wrapper (`CourseDetailScreen.tsx`): add a "Materials" tab using `MaterialsBrowser` `readOnly`; downloads via existing `downloadLessonFile` / `downloadResource`; locked modules/files honour `mentorship_active` (reuse existing gating).

## Tenant access gating

Unchanged from current behaviour. Module/file `access = 'mentorship'` shows a lock when the org's `mentorship_active` is false; download endpoints already enforce the gate server-side (`lessonFileUrl`, `resourceDownloadUrl`). The folder tree renders the lock badge from the same flag.

## Out of scope

- Arbitrary user-created folders ("Add Folder" button) — taxonomy is fixed.
- Drag-and-drop file reorder.
- Folder rename.
- Lesson creation/removal from the Materials view (use the existing editor).
- Any change to lesson markdown bodies or progress tracking.

## Testing

- Backend: unit test that `addResource` persists and returns `category`; `getCourse` / tenant course-detail include `category`. Cross-org isolation unaffected (catalogue is global; resources have no org scope).
- Frontend: `buildTree` unit test — given a course detail, assert folder counts, stats, and course-level folder placement. (Frontend has no test runner gated in CI; add the test colocated for local `vitest` if a runner is wired, otherwise keep `buildTree` trivially verifiable by hand.)

## Migration / deploy notes

- Apply `000048` on hosted Supabase, then `NOTIFY pgrst, 'reload schema';` (PostgREST cache gotcha).
- Update `docs/API.md` only if any endpoint contract changes (none expected — `category` is an added field on existing request/response bodies; note it there).
