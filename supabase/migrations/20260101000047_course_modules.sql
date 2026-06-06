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
