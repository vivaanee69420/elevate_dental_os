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
