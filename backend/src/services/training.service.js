// ============================================================================
// Training service — tenant read/enrol/progress path for the Module Library
// (LMS). Reads the GLOBAL published catalog (courseRepository) and shapes it for
// the tenant Academy screens, applying mentorship gating from the org's
// mentorship_active flag, plus the per-(org,user) enrolment + lesson_progress
// state. Catalog is global; the org+user-scoped inputs are the mentorship flag,
// enrolments and completed lessons.
// ============================================================================
import { courseRepository } from '../repositories/course.repository.js';
import { fileRepository } from '../repositories/file.repository.js';
import * as supabase_1 from "../lib/supabase.js";
import { AppError } from '../middleware/errors.js';

async function orgMentorshipActive(orgId) {
    const { data, error } = await supabase_1.serviceClient
        .from('organisations')
        .select('mentorship_active')
        .eq('id', orgId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return !!data?.mentorship_active;
}

// DB course row -> the shape the tenant Academy screens consume. `progress`
// carries enrolment + completed-lesson counts for the card UI.
function toModule(course, lessons, progress) {
    const total = lessons.length;
    const completed = progress?.completed ?? 0;
    return {
        id: course.id,
        track: course.track,
        title: course.title,
        level: course.level,
        access: course.access,
        featured: course.featured,
        desc: course.description,
        instructor: course.instructor,
        instructorTitle: course.instructor_title,
        outcome: course.outcome,
        duration: '',
        lessons: lessons.map((l) => ({ id: l.id, title: l.title, access: l.access })),
        resources: [],
        enrolled: progress?.enrolled ?? false,
        total_lessons: total,
        completed_lessons: completed,
        progress_pct: total ? Math.round((completed / total) * 100) : 0,
    };
}

export const trainingService = {
    // Published catalog + the org's mentorship flag + this user's progress
    // (enrolment + completed-lesson counts per course, drives card state).
    async library(orgId, userId) {
        const [courses, mentorshipActive, enrolments, completed] = await Promise.all([
            courseRepository.listPublished(),
            orgMentorshipActive(orgId),
            courseRepository.listEnrolments(orgId, userId),
            courseRepository.listCompletedLessons(orgId, userId),
        ]);
        const lessons = await courseRepository.listLessonsForCourses(
            courses.map((c) => c.id),
        );
        const byCourse = new Map();
        for (const l of lessons) {
            if (!byCourse.has(l.course_id)) byCourse.set(l.course_id, []);
            byCourse.get(l.course_id).push(l);
        }
        const enrolledSet = new Set(enrolments.map((e) => e.course_id));
        const completedSet = new Set(completed.map((c) => c.lesson_id));
        return {
            modules: courses.map((c) => {
                const cl = byCourse.get(c.id) || [];
                const done = cl.filter((l) => completedSet.has(l.id)).length;
                return toModule(c, cl, {
                    enrolled: enrolledSet.has(c.id),
                    completed: done,
                });
            }),
            mentorship_active: mentorshipActive,
        };
    },

    // One published course with full lessons + resources, gated per access:
    // a mentorship lesson/resource hides its body/file_key unless the org's
    // mentorship is active (the teaser still shows). Per-lesson `completed`
    // reflects this user's lesson_progress. Returns modules with nested lessons
    // (each with files grouped by category) AND a flat lessons array for
    // progress tracking (same lesson objects, same gating).
    async courseDetail(orgId, userId, id) {
        const course = await courseRepository.getPublished(id);
        if (!course) throw new AppError('Course not found', 404);
        const [lessons, modules, resources, mentorshipActive, enrolments, completed] = await Promise.all([
            courseRepository.listLessons(id),
            courseRepository.listModules(id),
            courseRepository.listResources(id),
            orgMentorshipActive(orgId),
            courseRepository.listEnrolments(orgId, userId),
            courseRepository.listCompletedLessons(orgId, userId),
        ]);

        // Fetch lesson files for all lessons in one batch query.
        const lessonFiles = await courseRepository.listLessonFilesForLessons(
            lessons.map((l) => l.id),
        );
        const filesByLesson = new Map();
        for (const f of lessonFiles) {
            if (!filesByLesson.has(f.lesson_id)) filesByLesson.set(f.lesson_id, []);
            filesByLesson.get(f.lesson_id).push(f);
        }

        const gate = (access) => access === 'mentorship' && !mentorshipActive;
        const enrolled = enrolments.some((e) => e.course_id === id);
        const completedSet = new Set(completed.map((c) => c.lesson_id));

        const shapedLessons = lessons.map((l) => {
            const locked = gate(l.access);
            const rawFiles = filesByLesson.get(l.id) || [];
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
            // Suppress legacy attachment fields when a backfilled lesson_files row
            // already carries the same file (migration 000047). Avoids double-render.
            const backfilled = !locked && l.attachment_file_key &&
                shapedFiles.some((f) => f.file_key === l.attachment_file_key);
            return {
                id: l.id,
                module_id: l.module_id,
                title: l.title,
                access: l.access,
                locked,
                completed: completedSet.has(l.id),
                teaser: l.teaser,
                body: locked ? null : l.body,
                attachment_name: (locked || backfilled) ? null : l.attachment_name,
                attachment_file_key: (locked || backfilled) ? null : l.attachment_file_key,
                attachment_type: (locked || backfilled) ? null : l.attachment_type,
                attachment_size_bytes: (locked || backfilled) ? null : l.attachment_size_bytes,
                files: shapedFiles,
            };
        });

        // Group shaped lessons by module_id for the nested modules response.
        const lessonsByModule = new Map();
        for (const l of shapedLessons) {
            const mid = l.module_id ?? '__unassigned__';
            if (!lessonsByModule.has(mid)) lessonsByModule.set(mid, []);
            lessonsByModule.get(mid).push(l);
        }

        const shapedModules = modules.map((m) => ({
            id: m.id,
            title: m.title,
            position: m.position,
            access: m.access,
            lessons: lessonsByModule.get(m.id) || [],
        }));

        // Lessons not assigned to any module go into a synthetic fallback module.
        const unassigned = lessonsByModule.get('__unassigned__') || [];
        if (unassigned.length > 0) {
            shapedModules.push({
                id: '__unassigned__',
                title: 'Lessons',
                position: shapedModules.length,
                access: course.access,
                lessons: unassigned,
            });
        }

        return {
            id: course.id,
            track: course.track,
            title: course.title,
            level: course.level,
            access: course.access,
            featured: course.featured,
            desc: course.description,
            instructor: course.instructor,
            instructorTitle: course.instructor_title,
            outcome: course.outcome,
            mentorship_active: mentorshipActive,
            enrolled,
            // Flat lessons list — kept for progress tracking (total/done counts).
            lessons: shapedLessons,
            // Nested modules → lessons (with files) for the course detail view.
            modules: shapedModules,
            resources: resources.map((r) => {
                const locked = gate(r.access);
                return {
                    id: r.id,
                    name: r.name,
                    access: r.access,
                    locked,
                    file_type: r.file_type,
                    size_bytes: r.size_bytes,
                    file_key: locked ? null : r.file_key,
                    category: r.category,
                    created_at: r.created_at,
                };
            }),
        };
    },

    // Enrol the user in a published course (idempotent). 404 if not published.
    async enrol(orgId, userId, courseId) {
        const course = await courseRepository.getPublished(courseId);
        if (!course) throw new AppError('Course not found', 404);
        await courseRepository.enrol(orgId, userId, courseId);
        return { enrolled: true, course_id: courseId };
    },

    // Mark a lesson complete / incomplete for this user. Validates the lesson
    // exists and belongs to a published course.
    async setLessonComplete(orgId, userId, lessonId, completed) {
        const lesson = await courseRepository.getLessonById(lessonId);
        if (!lesson) throw new AppError('Lesson not found', 404);
        const course = await courseRepository.getPublished(lesson.course_id);
        if (!course) throw new AppError('Lesson not found', 404);
        if (completed) {
            await courseRepository.completeLesson(orgId, userId, lessonId);
        } else {
            await courseRepository.uncompleteLesson(orgId, userId, lessonId);
        }
        return { lesson_id: lessonId, completed };
    },

    // "My training" feed: enrolled published courses with per-course progress.
    async myTraining(orgId, userId) {
        const [enrolments, completed, courses] = await Promise.all([
            courseRepository.listEnrolments(orgId, userId),
            courseRepository.listCompletedLessons(orgId, userId),
            courseRepository.listPublished(),
        ]);
        const enrolledIds = new Set(enrolments.map((e) => e.course_id));
        const enrolledCourses = courses.filter((c) => enrolledIds.has(c.id));
        const lessons = await courseRepository.listLessonsForCourses(
            enrolledCourses.map((c) => c.id),
        );
        const completedSet = new Set(completed.map((c) => c.lesson_id));
        const totalByCourse = new Map();
        const doneByCourse = new Map();
        for (const l of lessons) {
            totalByCourse.set(l.course_id, (totalByCourse.get(l.course_id) || 0) + 1);
            if (completedSet.has(l.id)) {
                doneByCourse.set(l.course_id, (doneByCourse.get(l.course_id) || 0) + 1);
            }
        }
        const enrolledAt = new Map(enrolments.map((e) => [e.course_id, e.enrolled_at]));
        return {
            enrolments: enrolledCourses.map((c) => {
                const total = totalByCourse.get(c.id) || 0;
                const done = doneByCourse.get(c.id) || 0;
                return {
                    course_id: c.id,
                    title: c.title,
                    track: c.track,
                    level: c.level,
                    access: c.access,
                    enrolled_at: enrolledAt.get(c.id) || null,
                    total_lessons: total,
                    completed_lessons: done,
                    progress_pct: total ? Math.round((done / total) * 100) : 0,
                };
            }),
        };
    },

    // Signed S3 GET for a lesson file (from lesson_files table). Gated the
    // same way as the lesson itself — mentorship lock = 403.
    async lessonFileUrl(orgId, fileId) {
        const file = await courseRepository.getLessonFileById(fileId);
        if (!file || !file.file_key) throw new AppError('File not found', 404);
        const lesson = await courseRepository.getLessonById(file.lesson_id);
        if (!lesson) throw new AppError('File not found', 404);
        const course = await courseRepository.getPublished(lesson.course_id);
        if (!course) throw new AppError('File not found', 404);
        if ((lesson.access === 'mentorship' || file.access === 'mentorship') && !(await orgMentorshipActive(orgId))) {
            throw new AppError('Locked — mentorship required', 403);
        }
        const url = await fileRepository.presignDownload(file.file_key, file.name);
        return { url, name: file.name };
    },

    // Signed S3 GET for a lesson attachment. Resolves the owning published
    // course and enforces the same mentorship gate as the detail view.
    async lessonAttachmentUrl(orgId, lessonId) {
        const lesson = await courseRepository.getLessonById(lessonId);
        if (!lesson || !lesson.attachment_file_key) {
            throw new AppError('Attachment not found', 404);
        }
        const course = await courseRepository.getPublished(lesson.course_id);
        if (!course) throw new AppError('Attachment not found', 404);
        if (lesson.access === 'mentorship' && !(await orgMentorshipActive(orgId))) {
            throw new AppError('Locked — mentorship required', 403);
        }
        const url = await fileRepository.presignDownload(
            lesson.attachment_file_key,
            lesson.attachment_name,
        );
        return { url, name: lesson.attachment_name };
    },

    // Signed S3 GET for a course resource, gated the same way.
    async resourceDownloadUrl(orgId, resourceId) {
        const resource = await courseRepository.getResourceById(resourceId);
        if (!resource || !resource.file_key) {
            throw new AppError('Resource not found', 404);
        }
        const course = await courseRepository.getPublished(resource.course_id);
        if (!course) throw new AppError('Resource not found', 404);
        if (resource.access === 'mentorship' && !(await orgMentorshipActive(orgId))) {
            throw new AppError('Locked — mentorship required', 403);
        }
        const url = await fileRepository.presignDownload(
            resource.file_key,
            resource.name,
        );
        return { url, name: resource.name };
    },
};
