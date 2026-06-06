# Module Library (Courses LMS) — Change Tracker

SaaS-owner-authored courses (Plan4Growth Academy). Owner posts courses centrally
(platform/superadmin); tenants browse + enrol in the "Module Library" section.
Content = text/HTML + PPT/PDF/doc attachments (S3). No video.

Design doc: `~/.gstack/projects/vivaanee69420-elevate_dental_os/ruhithpasha-feat-intelligence-os-phase0-design-20260606-152654.md`
Memory: `module-library-lms`

## Architecture (locked)
- Catalog (`courses`, `course_lessons`, `course_resources`) is GLOBAL — NO
  `organisation_id` (deliberate rule-3 exception; authored once for all tenants).
- Per-tenant: `course_enrolments`, `lesson_progress` (org-scoped, RLS).
- Paid gating: `organisations.mentorship_active` (superadmin-toggled) + per
  course/lesson `free | mentorship` flag.
- Authoring: superadmin-only, platform auth path, isolated new files.
- Migration `20260101000045_courses.sql` claimed. Concurrent super-admin session
  must use `000046`+.

---

## Phase A — Admin authoring  ✅ DONE
DB:
- [x] `supabase/migrations/20260101000045_courses.sql` (applied to hosted `mkfhpzjbijbachoonytt`, PostgREST reloaded)

Backend (all new, no collision):
- [x] `backend/src/models/course.model.js` (Zod)
- [x] `backend/src/repositories/course.repository.js`
- [x] `backend/src/services/course.service.js`
- [x] `backend/src/controllers/course.controller.js`
- [x] `backend/src/routes/platform-courses.routes.js` → `/api/platform/courses`
- [x] `backend/src/app.js` (+2 lines: import + mount before `/api/platform`)
- [x] S3 attachment presign (reuses `fileRepository`, `courses/` key prefix, no tenant `files` row)
- [x] `backend/test/courses.service.test.mjs` (8 tests)

Frontend (all new, no collision):
- [x] `frontend/lib/course-admin.ts` (client + upload helper)
- [x] `frontend/app/(platform)/platform/courses/page.tsx` (list + create)
- [x] `frontend/app/(platform)/platform/courses/[id]/page.tsx` (editor: metadata, lessons CRUD + reorder + attachment, resources, publish/delete)
- [x] `frontend/components/platform/PlatformSidebar.tsx` (+1 nav line "Courses")

Verify:
- [x] backend 477/477 tests pass, typecheck clean
- [x] frontend tsc clean on course files

---

## Phase B — Tenant Module Library (read/UI)  ✅ DONE
Backend (tenant read path — `training.routes.js`, my lane):
- [x] `GET /api/training/library` → published courses (mapped) + `mentorship_active`
- [x] `GET /api/training/courses/:id` → course + lessons + resources, gated per access
- [x] `backend/src/services/training.service.js` (maps catalog → tenant shape, gates locked content)
- [x] `courseRepository` published-read methods (`listPublished`, `getPublished`, `listLessonsForCourses` batched)

Frontend:
- [x] `features/training/useLibrary.ts` (useLibrary + useCourse hooks)
- [x] Wired `features/training/components/ModuleLibraryScreen.tsx` to real `/training/library`
- [x] `features/training/components/CourseDetailScreen.tsx` (lessons + text content + resource list, locked teasers)
- [x] Route `app/(dashboard)/training-library/[id]/page.tsx`
- [x] frontend tsc clean on training/course files

---

## Phase C — Enrolment, progress, downloads  ✅ DONE
Backend (tenant path — `training.routes.js` / `training.service.js`):
- [x] `POST /training/courses/:id/enrol` → idempotent upsert into `course_enrolments` (404 if course not published)
- [x] `POST /training/lessons/:lessonId/complete` (body `{completed?}`, default true) → upsert/delete `lesson_progress`; validates lesson belongs to a published course
- [x] `GET /training/my` → real enrolled-course feed + per-course progress (was an empty stub)
- [x] `GET /training/lessons/:lessonId/attachment` + `GET /training/resources/:resourceId/download` → signed S3 GET, gated by the same mentorship rule as the detail view (403 locked, 404 missing)
- [x] `library` + `courseDetail` now carry per-(org,user) progress: `enrolled`, `total_lessons`, `completed_lessons`, `progress_pct`; lessons carry `completed`
- [x] `course.repository.js`: enrol / completeLesson / uncompleteLesson / listEnrolments / listCompletedLessons / getLessonById / getResourceById
- [x] `file.repository.js`: `presignDownload(key, filename)` (GetObjectCommand, Content-Disposition)
- [x] `backend/test/training.service.test.mjs` (10 tests: progress rollup, enrol 404/upsert, lesson complete/uncomplete, myTraining, download gate 403/404)

Frontend:
- [x] `useLibrary.ts`: progress fields on types; `useEnrol`, `useSetLessonComplete`, `useMyTraining` hooks; `downloadLessonAttachment` / `downloadResource` helpers (fetch signed URL → trigger browser download)
- [x] `CourseDetailScreen.tsx`: Enrol button + progress bar, per-lesson Mark complete / Mark not done, real attachment + resource downloads (replaced "download coming soon")
- [x] `ModuleLibraryScreen.tsx`: per-card progress bar + Start / Continue / Review button states
- [x] `MyModulesScreen.tsx`: rewired off mock `../data` to `/training/my` + `/training/library` (in-progress / completed / recommended buckets, cards navigate)

Verify:
- [x] backend 487/487 tests pass (+10), syntax clean
- [x] frontend tsc clean

---

## PENDING (not built yet)
Tenant:
- [ ] **Mentorship banner** real tier/renews data (currently org bool only)
- [ ] Mentorship calls / one-to-one / booking screens still mock (separate features)
- [ ] `course_enrolments` write only happens on explicit Enrol; "Start module" on a free course does not auto-enrol (deliberate — enrol is the gate)

Admin:
- [ ] Rich-text editor for lesson body (currently plain textarea / markdown)
- [ ] Course reorder at catalog level (lesson reorder done; course `position` editable via API but no UI drag)
- [ ] Bulk file/PPT preview in editor

Infra / housekeeping:
- [ ] Sync `backend/db/01_schema.sql` source copy with migration 000045 (unmanaged copy; not read by `supabase db reset`)
- [ ] N+1: `/training/library` lesson counts batched (done if batched; revisit if catalog grows)
- [ ] Nothing committed yet — all changes in working tree

---

## Coordination note (concurrent super-admin session)
- Migrations: this feature owns `000045`; other session starts at `000046`+.
- Shared files touched: `app.js` (+2), `PlatformSidebar.tsx` (+1). NOT touched:
  `platform-admin.routes.js`, orgs/signups/users/audit/integrations pages.
