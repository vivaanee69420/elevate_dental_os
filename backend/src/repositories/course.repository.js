// ============================================================================
// Course repository — Supabase data access for the Module Library (LMS).
// The catalog (courses/course_lessons/course_resources) is GLOBAL content
// authored on the platform path, so — unlike tenant repos — there is NO
// organisation_id filter here (see migration 000045_courses.sql). Writes run
// via serviceClient on the superadmin-gated platform route only.
// Queries in, rows out.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const COURSE_COLS =
    'id, slug, title, track, level, access, featured, description, instructor, instructor_title, outcome, status, position, created_at, updated_at';
const LESSON_COLS =
    'id, course_id, module_id, title, position, access, body, teaser, attachment_file_key, attachment_name, attachment_type, attachment_size_bytes, created_at, updated_at';
const MODULE_COLS =
    'id, course_id, title, position, access, created_at, updated_at';
const LESSON_FILE_COLS =
    'id, lesson_id, category, name, file_key, file_type, size_bytes, position, access, created_at';
const RESOURCE_COLS =
    'id, course_id, name, file_key, file_type, size_bytes, access, position, category, created_at';

export const courseRepository = {
    // Full catalog incl. drafts (authoring list). Ordered by position then title.
    async listCourses() {
        const { data, error } = await supabase_1.serviceClient
            .from('courses')
            .select(COURSE_COLS)
            .order('position', { ascending: true })
            .order('title', { ascending: true })
            .limit(1000);
        if (error) throw new Error(error.message);
        return data || [];
    },

    async getCourse(id) {
        const { data, error } = await supabase_1.serviceClient
            .from('courses')
            .select(COURSE_COLS)
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    // ---- Tenant read path: published catalog only ----
    async listPublished() {
        const { data, error } = await supabase_1.serviceClient
            .from('courses')
            .select(COURSE_COLS)
            .eq('status', 'published')
            .order('position', { ascending: true })
            .order('title', { ascending: true })
            .limit(1000);
        if (error) throw new Error(error.message);
        return data || [];
    },

    async getPublished(id) {
        const { data, error } = await supabase_1.serviceClient
            .from('courses')
            .select(COURSE_COLS)
            .eq('id', id)
            .eq('status', 'published')
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    // Batched lesson fetch for many courses (avoids N+1 on the library list).
    async listLessonsForCourses(courseIds) {
        if (!courseIds.length) return [];
        const { data, error } = await supabase_1.serviceClient
            .from('course_lessons')
            .select('id, course_id, title, position, access')
            .in('course_id', courseIds)
            .order('position', { ascending: true })
            .limit(5000);
        if (error) throw new Error(error.message);
        return data || [];
    },

    async listLessons(courseId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_lessons')
            .select(LESSON_COLS)
            .eq('course_id', courseId)
            .order('position', { ascending: true })
            .limit(1000);
        if (error) throw new Error(error.message);
        return data || [];
    },

    async listResources(courseId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_resources')
            .select(RESOURCE_COLS)
            .eq('course_id', courseId)
            .order('position', { ascending: true })
            .limit(1000);
        if (error) throw new Error(error.message);
        return data || [];
    },

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

    // Single lesson by id (used by the tenant download endpoint to resolve the
    // owning course + access flag before presigning).
    async getLessonById(lessonId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_lessons')
            .select(LESSON_COLS)
            .eq('id', lessonId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    async getResourceById(resId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_resources')
            .select(RESOURCE_COLS)
            .eq('id', resId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    // ---- Tenant per-org state: enrolments + lesson progress -----------------
    // Org+user scoped (manual filter on the serviceClient path, mirrored by RLS
    // in migration 000045). enrol/complete are idempotent upserts on the
    // UNIQUE(org,user,course|lesson) constraints.
    async enrol(orgId, userId, courseId) {
        const { error } = await supabase_1.serviceClient
            .from('course_enrolments')
            .upsert(
                { organisation_id: orgId, user_id: userId, course_id: courseId },
                { onConflict: 'organisation_id,user_id,course_id', ignoreDuplicates: true },
            );
        if (error) throw new Error(error.message);
    },

    async listEnrolments(orgId, userId) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_enrolments')
            .select('course_id, enrolled_at')
            .eq('organisation_id', orgId)
            .eq('user_id', userId)
            .limit(1000);
        if (error) throw new Error(error.message);
        return data || [];
    },

    async completeLesson(orgId, userId, lessonId) {
        const { error } = await supabase_1.serviceClient
            .from('lesson_progress')
            .upsert(
                { organisation_id: orgId, user_id: userId, lesson_id: lessonId },
                { onConflict: 'organisation_id,user_id,lesson_id', ignoreDuplicates: true },
            );
        if (error) throw new Error(error.message);
    },

    async uncompleteLesson(orgId, userId, lessonId) {
        const { error } = await supabase_1.serviceClient
            .from('lesson_progress')
            .delete()
            .eq('organisation_id', orgId)
            .eq('user_id', userId)
            .eq('lesson_id', lessonId);
        if (error) throw new Error(error.message);
    },

    // All lesson ids this user has completed (org-scoped). Used to compute
    // per-course progress on the library + course detail.
    async listCompletedLessons(orgId, userId) {
        const { data, error } = await supabase_1.serviceClient
            .from('lesson_progress')
            .select('lesson_id')
            .eq('organisation_id', orgId)
            .eq('user_id', userId)
            .limit(5000);
        if (error) throw new Error(error.message);
        return data || [];
    },

    async createCourse(fields, adminId) {
        const { data, error } = await supabase_1.serviceClient
            .from('courses')
            .insert({ ...fields, created_by: adminId ?? null })
            .select(COURSE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async updateCourse(id, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('courses')
            .update(fields)
            .eq('id', id)
            .select(COURSE_COLS)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    async deleteCourse(id) {
        const { error } = await supabase_1.serviceClient
            .from('courses')
            .delete()
            .eq('id', id);
        if (error) throw new Error(error.message);
    },

    // Highest existing lesson position within a module (-1 when none), so the
    // service can append at position+1 without a race-free sequence.
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

    async createLesson(courseId, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_lessons')
            .insert({ ...fields, course_id: courseId })
            .select(LESSON_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async updateLesson(courseId, lessonId, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_lessons')
            .update(fields)
            .eq('course_id', courseId)
            .eq('id', lessonId)
            .select(LESSON_COLS)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },

    async deleteLesson(courseId, lessonId) {
        const { error } = await supabase_1.serviceClient
            .from('course_lessons')
            .delete()
            .eq('course_id', courseId)
            .eq('id', lessonId);
        if (error) throw new Error(error.message);
    },

    // Persist a new lesson order. Sets position = index for each id, scoped to
    // the module so a stray id from another module can't be repositioned here.
    async setLessonPosition(moduleId, lessonId, position) {
        const { error } = await supabase_1.serviceClient
            .from('course_lessons')
            .update({ position })
            .eq('module_id', moduleId)
            .eq('id', lessonId);
        if (error) throw new Error(error.message);
    },

    async createResource(courseId, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('course_resources')
            .insert({ ...fields, course_id: courseId })
            .select(RESOURCE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async deleteResource(courseId, resId) {
        const { error } = await supabase_1.serviceClient
            .from('course_resources')
            .delete()
            .eq('course_id', courseId)
            .eq('id', resId);
        if (error) throw new Error(error.message);
    },
};
