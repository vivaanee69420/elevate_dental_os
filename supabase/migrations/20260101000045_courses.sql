-- ============================================================================
-- courses / course_lessons / course_resources — the Module Library (LMS).
--
-- DESIGN DECISION (2026-06-06): the COURSE CATALOG is GLOBAL, not tenant-scoped.
-- The SaaS owner (Plan4Growth) authors courses ONCE via the platform/superadmin
-- console and every tenant sees the same catalog. So `courses`, `course_lessons`
-- and `course_resources` deliberately carry NO organisation_id (a conscious
-- exception to project rule 3 — they sit ABOVE the tenant boundary). Writes to
-- these tables happen only on the platform auth path via serviceClient.
--
-- Per-tenant state DOES carry organisation_id: `course_enrolments` and
-- `lesson_progress` are org+user scoped (manual .eq filter on the serviceClient
-- path AND RLS, same convention as pl_sheets). Paid/"mentorship" gating is a
-- per-org flag (`organisations.mentorship_active`) the superadmin toggles; each
-- course/lesson keeps its own free|mentorship access flag.
--
-- Content is TEXT/HTML lesson bodies + PPT/PDF/doc attachments (S3 keys via the
-- existing /api/files/presign). No video.
--
-- Idempotent + additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

-- ---- Per-org paid-tier flag (additive) ------------------------------------
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS mentorship_active BOOLEAN NOT NULL DEFAULT FALSE;

-- ---- Global catalog --------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  track TEXT NOT NULL DEFAULT 'foundations',  -- foundations|business-health|marketing|implants|business|sales
  level TEXT NOT NULL DEFAULT 'all',          -- all|beginner|intermediate|advanced
  access TEXT NOT NULL DEFAULT 'free' CHECK (access IN ('free','mentorship')),
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL DEFAULT '',
  instructor TEXT NOT NULL DEFAULT '',
  instructor_title TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID,  -- platform_admins.id (no FK: cross-auth table, kept loose)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  access TEXT NOT NULL DEFAULT 'free' CHECK (access IN ('free','mentorship')),
  body TEXT,                          -- markdown/HTML lesson content
  teaser TEXT,                        -- shown when locked
  attachment_file_key TEXT,           -- S3 key (PPT/PDF/doc), nullable
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_key TEXT NOT NULL,             -- S3 key
  file_type TEXT,
  size_bytes BIGINT,
  access TEXT NOT NULL DEFAULT 'free' CHECK (access IN ('free','mentorship')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---- Per-tenant enrolment + progress --------------------------------------
CREATE TABLE IF NOT EXISTS course_enrolments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, user_id, course_id)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, user_id, lesson_id)
);

-- ---- Triggers + indexes ----------------------------------------------------
DROP TRIGGER IF EXISTS courses_updated_at ON courses;
CREATE TRIGGER courses_updated_at BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS course_lessons_updated_at ON course_lessons;
CREATE TRIGGER course_lessons_updated_at BEFORE UPDATE ON course_lessons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_courses_status_pos ON courses(status, position);
CREATE INDEX IF NOT EXISTS idx_course_lessons_course ON course_lessons(course_id, position);
CREATE INDEX IF NOT EXISTS idx_course_resources_course ON course_resources(course_id, position);
CREATE INDEX IF NOT EXISTS idx_course_enrolments_org_user ON course_enrolments(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_org_user ON lesson_progress(organisation_id, user_id);

-- ---- RLS -------------------------------------------------------------------
-- Catalog tables: belt-and-suspenders. Writes only via serviceClient on the
-- platform path; tenants may READ published rows. (Repos use serviceClient so
-- these policies are a safety net, not the primary guard.)
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courses_read_published ON courses;
CREATE POLICY courses_read_published ON courses
  FOR SELECT USING (status = 'published');

ALTER TABLE course_lessons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_lessons_read ON course_lessons;
CREATE POLICY course_lessons_read ON course_lessons
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id AND c.status = 'published')
  );

ALTER TABLE course_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_resources_read ON course_resources;
CREATE POLICY course_resources_read ON course_resources
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id AND c.status = 'published')
  );

-- Enrolment + progress: org-isolated, all staff roles (training is not finance).
ALTER TABLE course_enrolments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_enrolments_org ON course_enrolments;
CREATE POLICY course_enrolments_org ON course_enrolments
  USING (organisation_id = current_org_id())
  WITH CHECK (organisation_id = current_org_id());

ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lesson_progress_org ON lesson_progress;
CREATE POLICY lesson_progress_org ON lesson_progress
  USING (organisation_id = current_org_id())
  WITH CHECK (organisation_id = current_org_id());

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
