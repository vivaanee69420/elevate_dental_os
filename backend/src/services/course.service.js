// ============================================================================
// Course service — Module Library (LMS) authoring business logic. Orchestrates
// the course repository for the platform/superadmin authoring API. Catalog is
// global content; no org scoping here. Tenant read/enrol/progress is a separate
// (later) slice on the tenant path.
// ============================================================================
import { courseRepository } from '../repositories/course.repository.js';
import { fileRepository } from '../repositories/file.repository.js';
import { AppError } from '../middleware/errors.js';

function groupBy(rows, key) {
    const out = {};
    for (const r of rows) (out[r[key]] ||= []).push(r);
    return out;
}

export const courseService = {
    // Presign an S3 PUT for a course attachment. Reuses the S3 helpers but, unlike
    // the tenant files domain, writes NO `files` row — course content is global,
    // not org-scoped, and the key is stored on the lesson/resource itself. Keys
    // are namespaced under 'courses/' instead of an org id.
    async presignAttachment(filename, contentType) {
        const key = fileRepository.buildKey('courses', filename);
        const uploadUrl = await fileRepository.presignUpload(key, contentType);
        return { uploadUrl, key };
    },

    async listCourses() {
        const courses = await courseRepository.listCourses();
        return { courses };
    },

    // Full course with nested modules → lessons → files + resources. 404 when missing.
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

    async createCourse(body, admin) {
        const course = await courseRepository.createCourse(body, admin?.id);
        return course;
    },

    async updateCourse(id, body) {
        const course = await courseRepository.updateCourse(id, body);
        if (!course) throw new AppError('Course not found', 404);
        return course;
    },

    async deleteCourse(id) {
        const existing = await courseRepository.getCourse(id);
        if (!existing) throw new AppError('Course not found', 404);
        await courseRepository.deleteCourse(id);
        return { deleted: true };
    },

    // status is 'draft' | 'published' — gated to a known set, not free text.
    async setStatus(id, status) {
        if (!['draft', 'published'].includes(status)) {
            throw new AppError('status must be draft or published', 400);
        }
        const course = await courseRepository.updateCourse(id, { status });
        if (!course) throw new AppError('Course not found', 404);
        return course;
    },

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

    async updateLesson(courseId, lessonId, body) {
        const lesson = await courseRepository.updateLesson(courseId, lessonId, body);
        if (!lesson) throw new AppError('Lesson not found', 404);
        return lesson;
    },

    async deleteLesson(courseId, lessonId) {
        await courseRepository.deleteLesson(courseId, lessonId);
        return { deleted: true };
    },

    // Reorder lessons: assign position = array index, scoped to the module.
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

    async addResource(courseId, body) {
        const course = await courseRepository.getCourse(courseId);
        if (!course) throw new AppError('Course not found', 404);
        return courseRepository.createResource(courseId, body);
    },

    async deleteResource(courseId, resId) {
        await courseRepository.deleteResource(courseId, resId);
        return { deleted: true };
    },

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
};
