# Course Module Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Module layer between Course and Lesson, and replace the single per-lesson attachment with multiple categorised per-lesson files, across the Module Library (LMS) DB, backend API, and frontend (admin authoring + tenant view).

**Architecture:** Additive Supabase migration (`course_modules` table, `module_id` on `course_lessons`, `lesson_files` table) with idempotent backfill. Backend keeps strict `models → controllers → services → repositories` layering on the platform/superadmin path. Frontend admin editor becomes a module accordion with a categorised file uploader; tenant view renders modules → lessons with markdown bodies.

**Tech Stack:** Postgres (Supabase, RLS), Express (native ESM), Zod, vitest. Next.js 14 App Router, React Query, Tailwind, `react-markdown` (new dep).

---

## Spec

`docs/superpowers/specs/2026-06-06-course-module-restructure-design.md`

## File map

- Create: `supabase/migrations/20260101000047_course_modules.sql` — schema + backfill + RLS.
- Modify: `backend/src/models/course.model.js` — module + lesson-file Zod schemas, `module_id` on lesson schema, new param schemas.
- Modify: `backend/src/repositories/course.repository.js` — module + lesson-file data access, `module_id` in `LESSON_COLS`, module-scoped lesson positioning, nested fetch helpers.
- Modify: `backend/src/services/course.service.js` — module CRUD/reorder, module-scoped `addLesson`/`reorderLessons`, lesson-file add/delete, nested `getCourse`.
- Modify: `backend/src/controllers/course.controller.js` — module + lesson-file handlers, module-scoped lesson handlers.
- Modify: `backend/src/routes/platform-courses.routes.js` — new nested routes.
- Modify: `backend/test/courses.service.test.mjs` — extend with module/file/nesting tests.
- Modify: `frontend/lib/course-admin.ts` — `Module`/`LessonFile`/`Category` types, nested `CourseDetail`, new `coursesApi` methods.
- Modify: `frontend/app/(platform)/platform/courses/[id]/page.tsx` — module accordion + categorised uploader + markdown preview.
- Modify: `frontend/features/training/components/CourseDetailScreen.tsx` — render modules → lessons, markdown body, files by category.
- Modify: `frontend/package.json` — add `react-markdown`.

---

### Task 1: Migration — schema, backfill, RLS

**Files:**
- Create: `supabase/migrations/20260101000047_course_modules.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- course_modules + lesson_files — adds a Module layer between courses and
-- course_lessons, and replaces the single per-lesson attachment with multiple
-- categorised per-lesson files. Catalog stays GLOBAL (no organisation_id), same
-- convention as 000045_courses.sql; writes only via serviceClient on the
-- platform path. Additive + idempotent — re-applies cleanly on supabase db reset.
-- After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

-- ---- Module layer ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  access TEXT NOT NULL DEFAULT 'free' CHECK (access IN ('free','mentorship')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE course_lessons
  ADD COLUMN IF NOT EXISTS module_id UUID
  REFERENCES course_modules(id) ON DELETE CASCADE;

-- ---- Per-lesson categorised files ------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id UUID NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'misc'
    CHECK (category IN ('presentations','reading','assignments','clinical','misc')),
  name TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_type TEXT,
  size_bytes BIGINT,
  position INTEGER NOT NULL DEFAULT 0,
  access TEXT NOT NULL DEFAULT 'free' CHECK (access IN ('free','mentorship')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---- Backfill (idempotent) -------------------------------------------------
-- 1. One default 'Module 1' per course that has lessons but no module yet.
INSERT INTO course_modules (course_id, title, position)
SELECT DISTINCT cl.course_id, 'Module 1', 0
FROM course_lessons cl
WHERE NOT EXISTS (
  SELECT 1 FROM course_modules cm WHERE cm.course_id = cl.course_id
);

-- 2. Attach module-less lessons to their course's default module.
UPDATE course_lessons cl
SET module_id = cm.id
FROM course_modules cm
WHERE cl.module_id IS NULL
  AND cm.course_id = cl.course_id
  AND cm.position = 0
  AND cm.title = 'Module 1';

-- 3. Migrate each legacy single attachment into a misc lesson_files row.
INSERT INTO lesson_files (lesson_id, category, name, file_key, file_type, size_bytes, access)
SELECT cl.id, 'misc',
       COALESCE(cl.attachment_name, 'Attachment'),
       cl.attachment_file_key, cl.attachment_type, cl.attachment_size_bytes, cl.access
FROM course_lessons cl
WHERE cl.attachment_file_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM lesson_files lf
    WHERE lf.lesson_id = cl.id AND lf.file_key = cl.attachment_file_key
  );

-- ---- Triggers + indexes ----------------------------------------------------
DROP TRIGGER IF EXISTS course_modules_updated_at ON course_modules;
CREATE TRIGGER course_modules_updated_at BEFORE UPDATE ON course_modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_course_modules_course ON course_modules(course_id, position);
CREATE INDEX IF NOT EXISTS idx_course_lessons_module ON course_lessons(module_id, position);
CREATE INDEX IF NOT EXISTS idx_lesson_files_lesson ON lesson_files(lesson_id, category, position);

-- ---- RLS (belt-and-suspenders; writes only via serviceClient) --------------
ALTER TABLE course_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_modules_read ON course_modules;
CREATE POLICY course_modules_read ON course_modules
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id AND c.status = 'published')
  );

ALTER TABLE lesson_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lesson_files_read ON lesson_files;
CREATE POLICY lesson_files_read ON lesson_files
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM course_lessons cl
      JOIN courses c ON c.id = cl.course_id
      WHERE cl.id = lesson_id AND c.status = 'published'
    )
  );

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify it applies cleanly and is idempotent (local DB)**

Run from repo root:
```bash
supabase db reset
```
Expected: all migrations apply `000001`→`000047` with no error. If `supabase` is unavailable in this environment, instead syntax-check the file by eye against `20260101000045_courses.sql` conventions and defer the DB apply to the human.

- [ ] **Step 3: Verify idempotency**

Re-apply the single file:
```bash
supabase db reset
```
Run again is not how single-file idempotency is checked; instead confirm by inspection that every statement is guarded (`IF NOT EXISTS`, `WHERE NOT EXISTS`, `IS NULL`, `DROP ... IF EXISTS`). There must be no bare `CREATE TABLE`/`INSERT` that would fail on a second run.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000047_course_modules.sql
git commit -m "feat(lms): migration — course_modules, lesson_files, module_id backfill"
```

---

### Task 2: Zod schemas for modules + lesson files

**Files:**
- Modify: `backend/src/models/course.model.js`

- [ ] **Step 1: Add the category constant and module/file schemas**

After the existing `ACCESS` constant (line ~14) add:
```js
const FILE_CATEGORIES = ['presentations', 'reading', 'assignments', 'clinical', 'misc'];
```

After `courseUpdateSchema` (line ~34) add:
```js
export const moduleCreateSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200),
    position: zod_1.z.number().int().min(0).optional(),
    access: zod_1.z.enum(ACCESS).default('free'),
});

export const moduleUpdateSchema = moduleCreateSchema.partial().refine(
    (o) => Object.keys(o).length > 0,
    { message: 'no fields to update' },
);
```

- [ ] **Step 2: Add `module_id` to the lesson create schema**

In `lessonCreateSchema` (line ~36) add a field:
```js
    module_id: uuid.optional(),
```
(The route supplies `module_id` from the path; this keeps body-supplied values valid too.)

- [ ] **Step 3: Add the lesson-file schema and new param schemas**

After `resourceCreateSchema` (line ~60) add:
```js
export const lessonFileCreateSchema = zod_1.z.object({
    category: zod_1.z.enum(FILE_CATEGORIES).default('misc'),
    name: zod_1.z.string().trim().min(1).max(400),
    file_key: zod_1.z.string().trim().min(1).max(1024),
    file_type: zod_1.z.string().max(100).optional(),
    size_bytes: zod_1.z.number().int().min(0).optional(),
    access: zod_1.z.enum(ACCESS).default('free'),
});
```

At the end of the file (after `resourceIdParamSchema`, line ~75) add:
```js
export const moduleIdParamSchema = zod_1.z.object({ id: uuid, moduleId: uuid });
export const lessonFileIdParamSchema = zod_1.z.object({ id: uuid, lessonId: uuid, fileId: uuid });
```

- [ ] **Step 4: Syntax-check**

Run:
```bash
cd backend && node --check src/models/course.model.js
```
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/course.model.js
git commit -m "feat(lms): zod schemas for modules + categorised lesson files"
```

---

### Task 3: Repository — module data access

**Files:**
- Modify: `backend/src/repositories/course.repository.js`

- [ ] **Step 1: Add `module_id` to `LESSON_COLS` and a module/file column set**

Replace the `LESSON_COLS` definition (line ~13) with:
```js
const LESSON_COLS =
    'id, course_id, module_id, title, position, access, body, teaser, attachment_file_key, attachment_name, attachment_type, attachment_size_bytes, created_at, updated_at';
const MODULE_COLS =
    'id, course_id, title, position, access, created_at, updated_at';
const LESSON_FILE_COLS =
    'id, lesson_id, category, name, file_key, file_type, size_bytes, position, access, created_at';
```

- [ ] **Step 2: Add module read/write methods**

Inside the `courseRepository` object, after `listResources` (line ~98) add:
```js
    async listModules(courseId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_modules')
            .select(MODULE_COLS)
            .eq('course_id', courseId)
            .order('position', { ascending: true })
            .limit(1000);
        if (error) throw new Error(error.message);
        return data || [];
    },

    async getModuleById(moduleId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_modules')
            .select(MODULE_COLS)
            .eq('id', moduleId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    async maxModulePosition(courseId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_modules')
            .select('position')
            .eq('course_id', courseId)
            .order('position', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? data.position : -1;
    },

    async createModule(courseId, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_modules')
            .insert({ ...fields, course_id: courseId })
            .select(MODULE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async updateModule(courseId, moduleId, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_modules')
            .update(fields)
            .eq('course_id', courseId)
            .eq('id', moduleId)
            .select(MODULE_COLS)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    async deleteModule(courseId, moduleId) {
        const { error } = await supabase_1.serviceClient
            .from('course_modules')
            .delete()
            .eq('course_id', courseId)
            .eq('id', moduleId);
        if (error) throw new Error(error.message);
    },

    async setModulePosition(courseId, moduleId, position) {
        const { error } = await supabase_1.serviceClient
            .from('course_modules')
            .update({ position })
            .eq('course_id', courseId)
            .eq('id', moduleId);
        if (error) throw new Error(error.message);
    },
```

- [ ] **Step 3: Make lesson positioning module-scoped**

Replace `maxLessonPosition` (line ~211) and `setLessonPosition` (line ~256) with module-scoped variants:
```js
    async maxLessonPosition(moduleId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_lessons')
            .select('position')
            .eq('module_id', moduleId)
            .order('position', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? data.position : -1;
    },
```
```js
    async setLessonPosition(moduleId, lessonId, position) {
        const { error } = await supabase_1.serviceClient
            .from('course_lessons')
            .update({ position })
            .eq('module_id', moduleId)
            .eq('id', lessonId);
        if (error) throw new Error(error.message);
    },
```

- [ ] **Step 4: Syntax-check**

Run:
```bash
cd backend && node --check src/repositories/course.repository.js
```
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/course.repository.js
git commit -m "feat(lms): repository — module data access + module-scoped lesson positioning"
```

---

### Task 4: Repository — lesson-file data access + nested fetch

**Files:**
- Modify: `backend/src/repositories/course.repository.js`

- [ ] **Step 1: Add lesson-file methods**

After the module methods (end of Task 3 Step 2 block) add:
```js
    async listLessonFilesForLessons(lessonIds) {
        if (!lessonIds.length) return [];
        const { data, error } = await supabase_1.serviceClient
            .from('lesson_files')
            .select(LESSON_FILE_COLS)
            .in('lesson_id', lessonIds)
            .order('position', { ascending: true })
            .limit(5000);
        if (error) throw new Error(error.message);
        return data || [];
    },

    async getLessonFileById(fileId) {
        const { data, error } = await supabase_1.serviceClient
            .from('lesson_files')
            .select(LESSON_FILE_COLS)
            .eq('id', fileId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    async maxLessonFilePosition(lessonId) {
        const { data, error } = await supabase_1.serviceClient
            .from('lesson_files')
            .select('position')
            .eq('lesson_id', lessonId)
            .order('position', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? data.position : -1;
    },

    async createLessonFile(lessonId, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('lesson_files')
            .insert({ ...fields, lesson_id: lessonId })
            .select(LESSON_FILE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async deleteLessonFile(lessonId, fileId) {
        const { error } = await supabase_1.serviceClient
            .from('lesson_files')
            .delete()
            .eq('lesson_id', lessonId)
            .eq('id', fileId);
        if (error) throw new Error(error.message);
    },
```

- [ ] **Step 2: Syntax-check**

Run:
```bash
cd backend && node --check src/repositories/course.repository.js
```
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add backend/src/repositories/course.repository.js
git commit -m "feat(lms): repository — lesson-file data access"
```

---

### Task 5: Service — module CRUD + reorder (test-first)

**Files:**
- Modify: `backend/test/courses.service.test.mjs`
- Modify: `backend/src/services/course.service.js`

- [ ] **Step 1: Write failing tests for module CRUD/reorder**

Append to `backend/test/courses.service.test.mjs`:
```js
describe('addModule', () => {
  it('appends at maxModulePosition + 1 and scopes to the course', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C' }, error: null };
      if (q.table === 'course_modules') {
        if (q.insertVals) {
          insertVals = q.insertVals;
          return { data: { id: 'm9', ...q.insertVals }, error: null };
        }
        return { data: { position: 1 }, error: null }; // maxModulePosition read
      }
      return { data: null, error: null };
    };
    await svc.addModule(COURSE, { title: 'Module 2', access: 'free' });
    expect(insertVals.position).toBe(2);
    expect(insertVals.course_id).toBe(COURSE);
  });

  it('throws 404 when the course is missing', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.addModule(COURSE, { title: 'x' })).rejects.toThrow('Course not found');
  });
});

describe('reorderModules', () => {
  it('throws 404 when the course is missing', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.reorderModules(COURSE, ['m1', 'm2'])).rejects.toThrow('Course not found');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
cd backend && npx vitest run test/courses.service.test.mjs -t "addModule"
```
Expected: FAIL — `svc.addModule is not a function`.

- [ ] **Step 3: Implement module service methods**

In `backend/src/services/course.service.js`, after `deleteCourse` (line ~54) add:
```js
    async addModule(courseId, body) {
        const course = await courseRepository.getCourse(courseId);
        if (!course) throw new AppError('Course not found', 404);
        let position = body.position;
        if (position === undefined) {
            position = (await courseRepository.maxModulePosition(courseId)) + 1;
        }
        return courseRepository.createModule(courseId, { ...body, position });
    },

    async updateModule(courseId, moduleId, body) {
        const mod = await courseRepository.updateModule(courseId, moduleId, body);
        if (!mod) throw new AppError('Module not found', 404);
        return mod;
    },

    async deleteModule(courseId, moduleId) {
        await courseRepository.deleteModule(courseId, moduleId);
        return { deleted: true };
    },

    async reorderModules(courseId, ids) {
        const course = await courseRepository.getCourse(courseId);
        if (!course) throw new AppError('Course not found', 404);
        await Promise.all(
            ids.map((moduleId, i) =>
                courseRepository.setModulePosition(courseId, moduleId, i),
            ),
        );
        return courseRepository.listModules(courseId);
    },
```

- [ ] **Step 4: Run tests, verify they pass**

Run:
```bash
cd backend && npx vitest run test/courses.service.test.mjs -t "addModule"
cd backend && npx vitest run test/courses.service.test.mjs -t "reorderModules"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/test/courses.service.test.mjs backend/src/services/course.service.js
git commit -m "feat(lms): service — module CRUD + reorder"
```

---

### Task 6: Service — module-scoped lessons + lesson files + nested getCourse (test-first)

**Files:**
- Modify: `backend/test/courses.service.test.mjs`
- Modify: `backend/src/services/course.service.js`

- [ ] **Step 1: Write failing tests**

Append to `backend/test/courses.service.test.mjs`:
```js
const MODULE = 'module-1';

describe('addLesson (module-scoped)', () => {
  it('validates the module belongs to the course and appends at maxPosition + 1', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C' }, error: null };
      if (q.table === 'course_modules') return { data: { id: MODULE, course_id: COURSE }, error: null };
      if (q.table === 'course_lessons') {
        if (q.insertVals) {
          insertVals = q.insertVals;
          return { data: { id: 'l9', ...q.insertVals }, error: null };
        }
        return { data: { position: 0 }, error: null }; // maxLessonPosition read
      }
      return { data: null, error: null };
    };
    await svc.addLesson(COURSE, MODULE, { title: 'Lesson 2', access: 'free' });
    expect(insertVals.position).toBe(1);
    expect(insertVals.module_id).toBe(MODULE);
    expect(insertVals.course_id).toBe(COURSE);
  });

  it('throws 404 when the module belongs to another course', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C' }, error: null };
      if (q.table === 'course_modules') return { data: { id: MODULE, course_id: 'other-course' }, error: null };
      return { data: null, error: null };
    };
    await expect(svc.addLesson(COURSE, MODULE, { title: 'x' })).rejects.toThrow('Module not found');
  });
});

describe('addLessonFile', () => {
  it('appends at maxLessonFilePosition + 1 scoped to the lesson', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: COURSE }, error: null };
      if (q.table === 'lesson_files') {
        if (q.insertVals) {
          insertVals = q.insertVals;
          return { data: { id: 'f1', ...q.insertVals }, error: null };
        }
        return { data: { position: 2 }, error: null }; // maxLessonFilePosition read
      }
      return { data: null, error: null };
    };
    await svc.addLessonFile(COURSE, 'l1', { category: 'reading', name: 'a.pdf', file_key: 'courses/a.pdf' });
    expect(insertVals.position).toBe(3);
    expect(insertVals.lesson_id).toBe('l1');
    expect(insertVals.category).toBe('reading');
  });

  it('throws 404 when the lesson is not in the course', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: 'other' }, error: null };
      return { data: null, error: null };
    };
    await expect(
      svc.addLessonFile(COURSE, 'l1', { category: 'misc', name: 'a', file_key: 'k' }),
    ).rejects.toThrow('Lesson not found');
  });
});

describe('getCourse (nested modules)', () => {
  it('nests lessons under their module and files under their lesson', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C', status: 'draft' }, error: null };
      if (q.table === 'course_modules') return { data: [{ id: MODULE, title: 'Module 1', position: 0 }], error: null };
      if (q.table === 'course_lessons') return { data: [{ id: 'l1', module_id: MODULE, title: 'Intro', position: 0 }], error: null };
      if (q.table === 'lesson_files') return { data: [{ id: 'f1', lesson_id: 'l1', category: 'reading', name: 'g.pdf' }], error: null };
      if (q.table === 'course_resources') return { data: [], error: null };
      return { data: null, error: null };
    };
    const out = await svc.getCourse(COURSE);
    expect(out.modules).toHaveLength(1);
    expect(out.modules[0].lessons).toHaveLength(1);
    expect(out.modules[0].lessons[0].files[0].name).toBe('g.pdf');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
cd backend && npx vitest run test/courses.service.test.mjs -t "module-scoped"
```
Expected: FAIL — `addLesson` still takes the old 2-arg signature; `addLessonFile` undefined.

- [ ] **Step 3: Replace `addLesson`, `reorderLessons`, and `getCourse`; add file methods**

In `backend/src/services/course.service.js`:

Replace the existing `getCourse` (line ~28) with:
```js
    async getCourse(id) {
        const course = await courseRepository.getCourse(id);
        if (!course) throw new AppError('Course not found', 404);
        const [modules, lessons, resources] = await Promise.all([
            courseRepository.listModules(id),
            courseRepository.listLessons(id),
            courseRepository.listResources(id),
        ]);
        const files = await courseRepository.listLessonFilesForLessons(lessons.map((l) => l.id));
        const filesByLesson = groupBy(files, 'lesson_id');
        const lessonsByModule = groupBy(
            lessons.map((l) => ({ ...l, files: filesByLesson[l.id] || [] })),
            'module_id',
        );
        const nestedModules = modules.map((m) => ({
            ...m,
            lessons: (lessonsByModule[m.id] || []).sort((a, b) => a.position - b.position),
        }));
        return { ...course, modules: nestedModules, resources };
    },
```

Replace the existing `addLesson` (line ~66) with:
```js
    async addLesson(courseId, moduleId, body) {
        const course = await courseRepository.getCourse(courseId);
        if (!course) throw new AppError('Course not found', 404);
        const mod = await courseRepository.getModuleById(moduleId);
        if (!mod || mod.course_id !== courseId) throw new AppError('Module not found', 404);
        let position = body.position;
        if (position === undefined) {
            position = (await courseRepository.maxLessonPosition(moduleId)) + 1;
        }
        return courseRepository.createLesson(courseId, { ...body, module_id: moduleId, position });
    },
```

Replace the existing `reorderLessons` (line ~89) with:
```js
    async reorderLessons(courseId, moduleId, ids) {
        const mod = await courseRepository.getModuleById(moduleId);
        if (!mod || mod.course_id !== courseId) throw new AppError('Module not found', 404);
        await Promise.all(
            ids.map((lessonId, i) =>
                courseRepository.setLessonPosition(moduleId, lessonId, i),
            ),
        );
        return courseRepository.listLessons(courseId);
    },
```

After `deleteResource` (line ~109, last method) add the file methods:
```js
    async addLessonFile(courseId, lessonId, body) {
        const lesson = await courseRepository.getLessonById(lessonId);
        if (!lesson || lesson.course_id !== courseId) throw new AppError('Lesson not found', 404);
        let position = body.position;
        if (position === undefined) {
            position = (await courseRepository.maxLessonFilePosition(lessonId)) + 1;
        }
        return courseRepository.createLessonFile(lessonId, { ...body, position });
    },

    async deleteLessonFile(courseId, lessonId, fileId) {
        const lesson = await courseRepository.getLessonById(lessonId);
        if (!lesson || lesson.course_id !== courseId) throw new AppError('Lesson not found', 404);
        await courseRepository.deleteLessonFile(lessonId, fileId);
        return { deleted: true };
    },
```

Add the `groupBy` helper at the top of the file, immediately after the imports (line ~9):
```js
function groupBy(rows, key) {
    const out = {};
    for (const r of rows) (out[r[key]] ||= []).push(r);
    return out;
}
```

- [ ] **Step 4: Run all course-service tests, verify they pass**

Run:
```bash
cd backend && npx vitest run test/courses.service.test.mjs
```
Expected: PASS. Note: the pre-existing `addLesson` and `reorderLessons` tests (Task baseline) call the old signatures — update them in the next step.

- [ ] **Step 5: Fix the two pre-existing tests for the new signatures**

In `backend/test/courses.service.test.mjs`, the original `describe('addLesson', ...)` block (the flat one) and `describe('reorderLessons', ...)` block call `svc.addLesson(COURSE, {...})` and `svc.reorderLessons(COURSE, [...])`. Update them:

- In the original `addLesson` "appends at maxPosition + 1" test, change the call to `svc.addLesson(COURSE, MODULE, { title: 'Lesson 3', access: 'free' })` and add a `course_modules` branch returning `{ id: MODULE, course_id: COURSE }` to its `resultProvider`.
- In the original `addLesson` 404 test, change the call to `svc.addLesson(COURSE, MODULE, { title: 'x' })`.
- In the original `reorderLessons` 404 test, change the call to `svc.reorderLessons(COURSE, MODULE, ['l1', 'l2'])` and have `resultProvider` return `null` for `course_modules` so it throws `Module not found` (update the `.toThrow` to `'Module not found'`).

Run:
```bash
cd backend && npx vitest run test/courses.service.test.mjs
```
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add backend/test/courses.service.test.mjs backend/src/services/course.service.js
git commit -m "feat(lms): service — module-scoped lessons, lesson files, nested getCourse"
```

---

### Task 7: Controller + routes

**Files:**
- Modify: `backend/src/controllers/course.controller.js`
- Modify: `backend/src/routes/platform-courses.routes.js`

- [ ] **Step 1: Add controller imports**

In `backend/src/controllers/course.controller.js`, extend the import from `../models/course.model.js` (line ~7) to also import:
```js
    moduleCreateSchema,
    moduleUpdateSchema,
    lessonFileCreateSchema,
    moduleIdParamSchema,
    lessonFileIdParamSchema,
```

- [ ] **Step 2: Add module handlers**

After the `publish` handler (line ~63) add:
```js
    async addModule(req, res) {
        const { id } = courseIdParamSchema.parse(req.params);
        const body = moduleCreateSchema.parse(req.body);
        const out = await courseService.addModule(id, body);
        res.status(201).json(out);
    },

    async updateModule(req, res) {
        const { id, moduleId } = moduleIdParamSchema.parse(req.params);
        const body = moduleUpdateSchema.parse(req.body);
        const out = await courseService.updateModule(id, moduleId, body);
        res.json(out);
    },

    async removeModule(req, res) {
        const { id, moduleId } = moduleIdParamSchema.parse(req.params);
        const out = await courseService.deleteModule(id, moduleId);
        res.json(out);
    },

    async reorderModules(req, res) {
        const { id } = courseIdParamSchema.parse(req.params);
        const { ids } = reorderSchema.parse(req.body);
        const out = await courseService.reorderModules(id, ids);
        res.json({ modules: out });
    },
```

- [ ] **Step 3: Update the lesson handlers for module scope**

Replace `addLesson` (line ~65) and `reorderLessons` (line ~85):
```js
    async addLesson(req, res) {
        const { id, moduleId } = moduleIdParamSchema.parse(req.params);
        const body = lessonCreateSchema.parse(req.body);
        const out = await courseService.addLesson(id, moduleId, body);
        res.status(201).json(out);
    },
```
```js
    async reorderLessons(req, res) {
        const { id, moduleId } = moduleIdParamSchema.parse(req.params);
        const { ids } = reorderSchema.parse(req.body);
        const out = await courseService.reorderLessons(id, moduleId, ids);
        res.json({ lessons: out });
    },
```

- [ ] **Step 4: Add lesson-file handlers**

After `removeResource` (line ~99) add:
```js
    async addLessonFile(req, res) {
        const { id, lessonId } = lessonIdParamSchema.parse(req.params);
        const body = lessonFileCreateSchema.parse(req.body);
        const out = await courseService.addLessonFile(id, lessonId, body);
        res.status(201).json(out);
    },

    async removeLessonFile(req, res) {
        const { id, lessonId, fileId } = lessonFileIdParamSchema.parse(req.params);
        const out = await courseService.deleteLessonFile(id, lessonId, fileId);
        res.json(out);
    },
```

- [ ] **Step 5: Wire routes**

In `backend/src/routes/platform-courses.routes.js`, replace the `// ---- Lessons ----` block (lines ~34-38) with:
```js
// ---- Modules (reorder before :moduleId so it isn't shadowed) ----
router.post('/:id/modules/reorder', asyncHandler(courseController.reorderModules));
router.post('/:id/modules', asyncHandler(courseController.addModule));
router.patch('/:id/modules/:moduleId', asyncHandler(courseController.updateModule));
router.delete('/:id/modules/:moduleId', asyncHandler(courseController.removeModule));

// ---- Lessons (nested under a module for create + reorder) ----
router.post('/:id/modules/:moduleId/lessons/reorder', asyncHandler(courseController.reorderLessons));
router.post('/:id/modules/:moduleId/lessons', asyncHandler(courseController.addLesson));
router.patch('/:id/lessons/:lessonId', asyncHandler(courseController.updateLesson));
router.delete('/:id/lessons/:lessonId', asyncHandler(courseController.removeLesson));

// ---- Lesson files ----
router.post('/:id/lessons/:lessonId/files', asyncHandler(courseController.addLessonFile));
router.delete('/:id/lessons/:lessonId/files/:fileId', asyncHandler(courseController.removeLessonFile));
```

- [ ] **Step 6: Syntax-check both files + run full backend test suite**

Run:
```bash
cd backend && node --check src/controllers/course.controller.js && node --check src/routes/platform-courses.routes.js && npx vitest run
```
Expected: no syntax errors; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/course.controller.js backend/src/routes/platform-courses.routes.js
git commit -m "feat(lms): controller + routes for modules and lesson files"
```

---

### Task 8: Frontend client types + API

**Files:**
- Modify: `frontend/lib/course-admin.ts`

- [ ] **Step 1: Add `Category`, `Module`, `LessonFile` types and update `Lesson`/`CourseDetail`**

In `frontend/lib/course-admin.ts`, after the `Status` type (line ~15) add:
```ts
export type Category = 'presentations' | 'reading' | 'assignments' | 'clinical' | 'misc';
```

Add `module_id` to the `Lesson` interface (line ~35) and a `files` array:
```ts
export interface Lesson {
  id: string;
  course_id: string;
  module_id: string;
  title: string;
  position: number;
  access: Access;
  body: string | null;
  teaser: string | null;
  attachment_file_key: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size_bytes: number | null;
  files: LessonFile[];
}

export interface LessonFile {
  id: string;
  lesson_id: string;
  category: Category;
  name: string;
  file_key: string;
  file_type: string | null;
  size_bytes: number | null;
  position: number;
  access: Access;
}

export interface Module {
  id: string;
  course_id: string;
  title: string;
  position: number;
  access: Access;
  lessons: Lesson[];
}
```

Replace the `CourseDetail` interface (line ~60) with:
```ts
export interface CourseDetail extends Course {
  modules: Module[];
  resources: Resource[];
}
```

Add the categories constant after `ACCESS` (line ~74):
```ts
export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'presentations', label: 'Presentations' },
  { key: 'reading', label: 'Reading Materials' },
  { key: 'assignments', label: 'Assignment Details' },
  { key: 'clinical', label: 'Clinical Cases' },
  { key: 'misc', label: 'Miscellaneous' },
];
```

- [ ] **Step 2: Update `coursesApi` — module + lesson-file methods, module-scoped lesson calls**

In the `coursesApi` object, replace `addLesson` and `reorderLessons` and add module + file methods:
```ts
  addModule: (id: string, body: Partial<Module>) =>
    platformApi<Module>(`/courses/${id}/modules`, { method: 'POST', body: JSON.stringify(body) }),
  updateModule: (id: string, moduleId: string, body: Partial<Module>) =>
    platformApi<Module>(`/courses/${id}/modules/${moduleId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeModule: (id: string, moduleId: string) =>
    platformApi<{ deleted: boolean }>(`/courses/${id}/modules/${moduleId}`, { method: 'DELETE' }),
  reorderModules: (id: string, ids: string[]) =>
    platformApi<{ modules: Module[] }>(`/courses/${id}/modules/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  addLesson: (id: string, moduleId: string, body: Partial<Lesson>) =>
    platformApi<Lesson>(`/courses/${id}/modules/${moduleId}/lessons`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateLesson: (id: string, lessonId: string, body: Partial<Lesson>) =>
    platformApi<Lesson>(`/courses/${id}/lessons/${lessonId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  removeLesson: (id: string, lessonId: string) =>
    platformApi<{ deleted: boolean }>(`/courses/${id}/lessons/${lessonId}`, { method: 'DELETE' }),
  reorderLessons: (id: string, moduleId: string, ids: string[]) =>
    platformApi<{ lessons: Lesson[] }>(`/courses/${id}/modules/${moduleId}/lessons/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  addLessonFile: (id: string, lessonId: string, body: Partial<LessonFile>) =>
    platformApi<LessonFile>(`/courses/${id}/lessons/${lessonId}/files`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeLessonFile: (id: string, lessonId: string, fileId: string) =>
    platformApi<{ deleted: boolean }>(`/courses/${id}/lessons/${lessonId}/files/${fileId}`, {
      method: 'DELETE',
    }),
```
Keep the existing `addResource` / `removeResource` methods unchanged.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd frontend && npm run typecheck
```
Expected: errors only in `app/(platform)/platform/courses/[id]/page.tsx` and `features/training/components/CourseDetailScreen.tsx` (they still use the old flat shape — fixed in Tasks 10–11). No errors in `lib/course-admin.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/course-admin.ts
git commit -m "feat(lms): frontend client types + API for modules and lesson files"
```

---

### Task 9: Add react-markdown dependency

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install**

Run:
```bash
cd frontend && npm install react-markdown@9
```
Expected: `react-markdown` added to `dependencies` in `frontend/package.json`; `package-lock.json` updated.

- [ ] **Step 2: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(lms): add react-markdown for lesson body rendering"
```

---

### Task 10: Admin editor — module accordion + categorised uploader + markdown preview

**Files:**
- Modify: `frontend/app/(platform)/platform/courses/[id]/page.tsx`

- [ ] **Step 1: Replace the `LessonsSection` with a `ModulesSection`**

Replace the `{/* ---- Lessons ---- */}` line and `<LessonsSection .../>` (line ~229-230) with:
```tsx
      {/* ---- Modules ---- */}
      <ModulesSection course={course} onChange={load} setError={setError} />
```

Replace the entire `LessonsSection` + `LessonRow` block (lines ~258-542) with the module-aware components below. Keep `Field`, `fmtSize`, and `ResourcesSection` as they are.

```tsx
// ---------------------------------------------------------------------------
// Modules → Lessons
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
          <button onClick={() => onMove(-1)} disabled={isFirst} className="text-xs text-ink-muted disabled:opacity-30 leading-none" aria-label="Move module up">▲</button>
          <button onClick={() => onMove(1)} disabled={isLast} className="text-xs text-ink-muted disabled:opacity-30 leading-none" aria-label="Move module down">▼</button>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          className="flex-1 px-2 py-1 rounded border border-transparent hover:border-border text-sm font-semibold text-ink bg-transparent"
        />
        <span className="text-xs text-ink-muted">{module.lessons.length} lessons</span>
        <button onClick={() => setOpen((o) => !o)} className="px-2 py-1 text-xs font-semibold border border-border rounded text-ink hover:bg-white">
          {open ? 'Collapse' : 'Expand'}
        </button>
        <button onClick={remove} className="px-2 py-1 text-xs font-semibold border border-danger rounded text-danger">Delete</button>
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
              <input value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)} className="px-3 py-2 rounded border border-border text-sm w-72" />
            </label>
            <button type="submit" disabled={busy || !lessonTitle.trim()} className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50">
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
          <button onClick={() => onMove(-1)} disabled={isFirst} className="text-xs text-ink-muted disabled:opacity-30 leading-none" aria-label="Move up">▲</button>
          <button onClick={() => onMove(1)} disabled={isLast} className="text-xs text-ink-muted disabled:opacity-30 leading-none" aria-label="Move down">▼</button>
        </div>
        <div className="flex-1">
          <span className="text-sm font-medium text-ink">{lesson.title}</span>
          <span className="ml-2 text-xs text-ink-muted">
            {lesson.access === 'free' ? 'Free' : 'Mentorship'} · {lesson.files.length} files
          </span>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="px-2 py-1 text-xs font-semibold border border-border rounded text-ink hover:bg-bg">
          {open ? 'Close' : 'Edit'}
        </button>
        <button onClick={remove} className="px-2 py-1 text-xs font-semibold border border-danger rounded text-danger">Delete</button>
      </div>
      {open && (
        <div className="p-3 border-t border-border space-y-3 bg-bg/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-muted">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="px-3 py-2 rounded border border-border text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-muted">Access</span>
              <select value={access} onChange={(e) => setAccess(e.target.value as Access)} className="px-3 py-2 rounded border border-border text-sm capitalize">
                {ACCESS.map((a) => (
                  <option key={a} value={a}>{a === 'free' ? 'Free' : 'Mentorship'}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-muted">Content (markdown)</span>
              <button type="button" onClick={() => setShowPreview((p) => !p)} className="text-xs text-brand font-semibold">
                {showPreview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {showPreview ? (
              <div className="px-3 py-2 rounded border border-border bg-white prose prose-sm max-w-none min-h-[8rem]">
                <ReactMarkdown>{body || '_Nothing to preview_'}</ReactMarkdown>
              </div>
            ) : (
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="px-3 py-2 rounded border border-border text-sm font-mono" />
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-muted">Teaser (shown when locked)</span>
            <input value={teaser} onChange={(e) => setTeaser(e.target.value)} className="px-3 py-2 rounded border border-border text-sm" />
          </label>

          <LessonFiles courseId={courseId} lesson={lesson} onChange={onChange} setError={setError} />

          <button onClick={save} disabled={saving} className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50">
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
        {inCategory.length === 0 && <p className="text-xs text-ink-muted">No files in this category.</p>}
        {inCategory.map((f) => (
          <div key={f.id} className="flex items-center justify-between p-2 rounded border border-border text-sm">
            <span className="text-ink">{f.name} <span className="text-ink-muted text-xs">{fmtSize(f.size_bytes)}</span></span>
            <button onClick={() => removeFile(f)} className="px-2 py-1 text-xs font-semibold border border-danger rounded text-danger">Remove</button>
          </div>
        ))}
        <label className="text-sm text-ink block pt-1">
          <span className="text-xs font-semibold text-ink-muted mr-2">Upload to {CATEGORIES.find((c) => c.key === active)?.label}:</span>
          <input type="file" onChange={onFile} disabled={uploading} />
        </label>
        {uploading && <span className="text-xs text-ink-muted">Uploading…</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update imports**

At the top of the file, extend the import from `@/lib/course-admin` (line ~10) to add `CATEGORIES`, `type Module`, `type LessonFile`, `type Category`. Add a `react-markdown` import:
```tsx
import ReactMarkdown from 'react-markdown';
```

- [ ] **Step 3: Typecheck + lint + build**

Run:
```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```
Expected: no errors in `app/(platform)/platform/courses/[id]/page.tsx`. (CourseDetailScreen may still error — fixed next task.)

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(platform)/platform/courses/[id]/page.tsx"
git commit -m "feat(lms): admin editor — module accordion, categorised uploader, markdown preview"
```

---

### Task 11: Tenant view — render modules → lessons + markdown + files by category

**Files:**
- Modify: `frontend/features/training/components/CourseDetailScreen.tsx`

- [ ] **Step 1: Read the current file**

Run:
```bash
sed -n '1,80p' frontend/features/training/components/CourseDetailScreen.tsx
```
Identify where lessons and resources are currently rendered (the component consumes the `CourseDetail` shape that changed in Task 8).

- [ ] **Step 2: Update the render to the nested shape**

Replace any flat `course.lessons.map(...)` with a nested render that iterates `course.modules`, then `module.lessons`, rendering each lesson's markdown body via `react-markdown` and grouping `lesson.files` by category. Use the `CATEGORIES` constant from `@/lib/course-admin` for category labels and ordering. Concretely, the lessons region becomes:
```tsx
{course.modules.map((m) => (
  <section key={m.id} className="space-y-3">
    <h2 className="font-semibold text-ink">{m.title}</h2>
    {m.lessons.map((lesson) => (
      <article key={lesson.id} className="p-4 rounded-lg border border-border bg-white space-y-2">
        <h3 className="font-medium text-ink">{lesson.title}</h3>
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown>{lesson.body ?? ''}</ReactMarkdown>
        </div>
        {CATEGORIES.map((c) => {
          const files = lesson.files.filter((f) => f.category === c.key);
          if (files.length === 0) return null;
          return (
            <div key={c.key} className="pt-2">
              <p className="text-xs font-semibold text-ink-muted">{c.label}</p>
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f.id}>
                    <DownloadLink file={f} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </article>
    ))}
  </section>
))}
```
If the file already has a download mechanism for the old single attachment (a presign-on-click handler), reuse it as `DownloadLink`; otherwise render `f.name` with the existing tenant file-download call. Do NOT invent a new endpoint — match whatever the current file uses to fetch a presigned URL. If the current screen is mock-only (no live download), render `f.name` as plain text and leave a `// TODO: wire tenant download` is NOT acceptable — instead render the filename inside a `<span>` and note in the commit message that tenant download wiring is unchanged from before.

- [ ] **Step 3: Add imports**

Add at the top of the file:
```tsx
import ReactMarkdown from 'react-markdown';
import { CATEGORIES } from '@/lib/course-admin';
```
(If the file imports its course type locally rather than from `course-admin`, align it to the updated `CourseDetail`/`Module`/`Lesson` shape from `@/lib/course-admin`.)

- [ ] **Step 4: Typecheck + lint + build**

Run:
```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```
Expected: all pass, no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/training/components/CourseDetailScreen.tsx
git commit -m "feat(lms): tenant course view — modules, markdown bodies, files by category"
```

---

### Task 12: Docs + hosted migration

**Files:**
- Modify: `CLAUDE.md` (migration ledger note), `docs/API.md` (new endpoints)

- [ ] **Step 1: Document the new endpoints in `docs/API.md`**

Add the module + lesson-file routes (from Task 7 Step 5) under the platform courses section, matching the existing entry format in `docs/API.md`.

- [ ] **Step 2: Note the new migration in `CLAUDE.md`**

In the "Local DB" paragraph and "Next TODOs", update the ledger range to include `000047` (course_modules + lesson_files) and note it must be applied on hosted + `NOTIFY pgrst, 'reload schema';`.

- [ ] **Step 3: Apply on hosted (human-gated)**

This step touches the live `Dental Os` project. Apply via the Supabase MCP `apply_migration` with the contents of `20260101000047_course_modules.sql`, then run `NOTIFY pgrst, 'reload schema';`. CONFIRM with the user before running — this is a production DDL change. If the user defers, leave this step unchecked.

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md docs/API.md
git commit -m "docs(lms): document module/lesson-file endpoints + 000047 migration"
```

---

## Self-review notes

- **Spec coverage:** modules table (T1), module_id (T1), lesson_files categorised (T1), backfill (T1), markdown render (T9–11), per-lesson categorised uploader (T10), nested getCourse (T6), routes (T7), kept course_resources (untouched), env reuse (no task needed — existing). Tracking deferred (out of scope, no task). ✓
- **Placeholder scan:** T11 Step 2 explicitly forbids leaving a TODO; reuses existing download mechanism. No "TBD"/"handle edge cases". ✓
- **Type consistency:** `addLesson(id, moduleId, body)`, `reorderLessons(id, moduleId, ids)` consistent across model/service/controller/route/client. `maxLessonPosition(moduleId)` / `setLessonPosition(moduleId, lessonId, position)` consistent T3↔T6. `LessonFile.category` enum matches DB CHECK and `Category` TS type. ✓
- **Note:** the migration cannot be unit-tested in the vitest harness (no DB); T1 verification is `supabase db reset` + idempotency-by-inspection, consistent with how this repo manages migrations.
