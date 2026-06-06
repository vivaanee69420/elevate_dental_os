// ============================================================================
// Course service — Module Library (LMS) authoring business logic. Orchestrates
// the course repository for the platform/superadmin authoring API. Catalog is
// global content; no org scoping here. Tenant read/enrol/progress is a separate
// (later) slice on the tenant path.
// ============================================================================
import { courseRepository } from '../repositories/course.repository.js';
import { fileRepository } from '../repositories/file.repository.js';
import { AppError } from '../middleware/errors.js';

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

    // Full course with ordered lessons + resources. 404 when missing.
    async getCourse(id) {
        const course = await courseRepository.getCourse(id);
        if (!course) throw new AppError('Course not found', 404);
        const [lessons, resources] = await Promise.all([
            courseRepository.listLessons(id),
            courseRepository.listResources(id),
        ]);
        return { ...course, lessons, resources };
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

    async addLesson(courseId, body) {
        const course = await courseRepository.getCourse(courseId);
        if (!course) throw new AppError('Course not found', 404);
        // Append to the end unless an explicit position is supplied.
        let position = body.position;
        if (position === undefined) {
            position = (await courseRepository.maxLessonPosition(courseId)) + 1;
        }
        return courseRepository.createLesson(courseId, { ...body, position });
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

    // Reorder lessons: assign position = array index, scoped to the course.
    async reorderLessons(courseId, ids) {
        const course = await courseRepository.getCourse(courseId);
        if (!course) throw new AppError('Course not found', 404);
        await Promise.all(
            ids.map((lessonId, i) =>
                courseRepository.setLessonPosition(courseId, lessonId, i),
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
};
