# Course restructure: Module layer + categorised lesson files

**Date:** 2026-06-06
**Status:** Approved design — ready for implementation plan
**Slice:** Module Library (LMS) authoring + tenant read

## Problem

The current LMS catalog is two levels deep: `courses → course_lessons` (a flat,
position-ordered list) plus `course_resources` (a flat list of course-level
files). Each lesson carries a single optional attachment (`attachment_*`
columns) and a plain-text `body`.

The product needs a deeper structure that matches how Plan4Growth actually
organises its programmes (see Course Management + Materials screenshots):

- A course is split into **Modules** (Module 1, Module 2, …).
- Each module holds multiple **Lessons**.
- Each lesson is a markdown/HTML **article** plus **multiple files** grouped by
  category (Presentations, Reading Materials, Assignment Details, Clinical
  Cases, Miscellaneous).

Progress tracking is explicitly **out of scope** for this slice (the
`lesson_progress` table already exists and will be wired later).

## Decisions (locked during brainstorming)

- **Hierarchy:** `Course → Module → Lesson`.
- **Lesson body:** markdown/HTML, rendered (no WYSIWYG). Editor gets a live
  markdown preview; tenant view renders the same markdown.
- **Files:** per-lesson, categorised into a fixed set of categories.
- **S3:** reuse the existing presign plumbing (`/api/platform/courses/presign`
  → `fileRepository`). Env placeholders already exist in
  `backend/.env.example` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION`, `S3_BUCKET`). No new env work; real creds dropped in when the
  bucket is arranged.
- **`course_resources`:** kept as-is (course-level flat files) alongside the new
  per-lesson files — no breakage, no migration of existing resources.
- **Markdown rendering:** add `react-markdown` (frontend dep) for editor preview
  and tenant rendering.

## Data model (additive migration `20260101000047_course_modules.sql`)

Catalog tables stay GLOBAL — no `organisation_id` (same convention as
`000045_courses.sql`). Writes only via `serviceClient` on the platform path.

### New table `course_modules`

```sql
CREATE TABLE IF NOT EXISTS course_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  access TEXT NOT NULL DEFAULT 'free' CHECK (access IN ('free','mentorship')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `course_lessons` — add `module_id`

```sql
ALTER TABLE course_lessons
  ADD COLUMN IF NOT EXISTS module_id UUID
  REFERENCES course_modules(id) ON DELETE CASCADE;
```

`module_id` is nullable at the schema level (so the migration can run before
backfill) but every lesson MUST end up with a module after backfill. The
`body` and `teaser` columns are retained. The legacy single-attachment columns
(`attachment_file_key/name/type/size_bytes`) are retained for back-compat but
no longer the write path — content moves to `lesson_files`.

### New table `lesson_files`

```sql
CREATE TABLE IF NOT EXISTS lesson_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id UUID NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'misc'
    CHECK (category IN ('presentations','reading','assignments','clinical','misc')),
  name TEXT NOT NULL,
  file_key TEXT NOT NULL,            -- S3 key
  file_type TEXT,
  size_bytes BIGINT,
  position INTEGER NOT NULL DEFAULT 0,
  access TEXT NOT NULL DEFAULT 'free' CHECK (access IN ('free','mentorship')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Backfill (idempotent, inside the same migration)

1. For every existing course with at least one lesson and no module yet, create
   a default module titled `Module 1` (position 0).
2. Set `module_id` on those lessons to the default module (only where NULL).
3. For every lesson with a non-null `attachment_file_key` and no matching
   `lesson_files` row, insert one `lesson_files` row with `category = 'misc'`,
   copying name/key/type/size/access.

Guard each step with `WHERE NOT EXISTS` / `IS NULL` so re-running is a no-op.

### Triggers + indexes

- `course_modules_updated_at` trigger (reuse `set_updated_at()`).
- Indexes: `idx_course_modules_course (course_id, position)`,
  `idx_course_lessons_module (module_id, position)`,
  `idx_lesson_files_lesson (lesson_id, category, position)`.

### RLS

Belt-and-suspenders, mirroring `000045`:

- `course_modules`, `lesson_files`: `FOR SELECT` allowed when the owning course
  is `published` (subquery up the chain). Writes only via `serviceClient`.

After applying on hosted: `NOTIFY pgrst, 'reload schema';`

## Backend API (platform path, superadmin only)

Strict layering preserved: `models/ → controllers/ → services/ → repositories/`.

### Zod schemas (`models/course.model.js`)

- `moduleCreateSchema` `{ title, position?, access }`, `moduleUpdateSchema`
  (partial, ≥1 field).
- `lessonCreateSchema`: add optional `module_id` (UUID). A lesson must belong to
  a module — the service rejects an add with no resolvable module.
- `lessonFileCreateSchema` `{ category, name, file_key, file_type?, size_bytes?,
  access }`.
- `reorderSchema` reused for module reorder and per-module lesson reorder.
- New param schemas: `moduleIdParamSchema {id, moduleId}`,
  `lessonFileIdParamSchema {id, lessonId, fileId}`.

### Routes (`routes/platform-courses.routes.js`)

Register specific (`/reorder`) routes before parameterised ones, per existing
convention.

```
POST   /:id/modules
POST   /:id/modules/reorder
PATCH  /:id/modules/:moduleId
DELETE /:id/modules/:moduleId

POST   /:id/modules/:moduleId/lessons          # add lesson into a module
POST   /:id/modules/:moduleId/lessons/reorder  # reorder within a module
PATCH  /:id/lessons/:lessonId                   # (unchanged path) edit lesson
DELETE /:id/lessons/:lessonId                   # (unchanged path)

POST   /:id/lessons/:lessonId/files
DELETE /:id/lessons/:lessonId/files/:fileId
```

Existing `POST /:id/lessons` is replaced by the module-scoped add; the flat
lesson reorder route is replaced by the per-module variant.

### Service (`services/course.service.js`)

- Module CRUD + reorder (append at `maxModulePosition+1`, mirror lesson logic).
- `addLesson(courseId, moduleId, body)` validates module belongs to course.
- `reorderLessons` scoped to `(courseId, moduleId)`.
- Lesson file add/delete.
- `getCourse` returns nested shape:
  `{ ...course, modules: [{ ...module, lessons: [{ ...lesson, files: [...] }] }], resources: [...] }`.

### Repository (`repositories/course.repository.js`)

Add: `listModules`, `maxModulePosition`, `createModule`, `updateModule`,
`deleteModule`, `setModulePosition`; `listLessonFiles`, `createLessonFile`,
`deleteLessonFile`, `getLessonFileById`. `getCourse` assembly nests modules →
lessons → files (batch the lesson + file fetches to avoid N+1). The tenant read
path (`listPublished`/`getPublished`) gains the same nesting.

## Frontend

### Admin editor (`app/(platform)/platform/courses/[id]/page.tsx`)

Replace flat `LessonsSection` with a **module accordion**:

- Each module is a collapsible card with title/access edit, up/down reorder,
  delete, and an "Add lesson" form.
- Lesson rows live inside their module; reorder is within the module.
- Lesson edit panel: title, access, **markdown textarea with live preview**
  (split or toggle), teaser, and a **categorised file uploader** — tabbed by
  category (Presentations / Reading / Assignments / Clinical / Misc) with a file
  list + upload per category, matching the screenshot's folder tree.
- Course-level Resources section kept unchanged.

### Tenant view (`features/training/components/CourseDetailScreen.tsx`)

Render `modules → lessons`; lesson article rendered from markdown via
`react-markdown`; lesson files grouped by category for download (presign on the
tenant download path as today). Locked lessons show `teaser`.

### Client types (`lib/course-admin.ts`)

Add `Module`, `LessonFile`, `Category` types; `CourseDetail` becomes
`{ ...Course, modules: ModuleWithLessons[], resources: Resource[] }`. Add
`coursesApi` methods for module + lesson-file CRUD and reorder.

## Testing

- Backend vitest: module CRUD + reorder, lesson add requires valid module,
  lesson-file add/delete, nested `getCourse` shape, cross-course guard (can't
  reparent a lesson into another course's module). Mirror existing
  `courses.service.test.mjs` / `training.service.test.mjs` style.
- Migration backfill: assert existing lessons land under `Module 1` and a legacy
  attachment becomes a `misc` `lesson_files` row; re-run is a no-op.

## Out of scope

- Progress tracking / completion UI (deferred).
- WYSIWYG / inline-image upload editor (markdown only this slice).
- Migrating `course_resources` into modules.
- Drag-and-drop reorder (up/down buttons reused).

## Migration / deploy notes

- Migration is additive + idempotent; re-applies cleanly on `supabase db reset`.
- Apply on hosted via Supabase MCP `apply_migration`, then
  `NOTIFY pgrst, 'reload schema';`.
- Keep `db/01_schema.sql` in sync per CLAUDE.md.
