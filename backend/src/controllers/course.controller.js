// ============================================================================
// Course controller — parses/validates authoring payloads with the course Zod
// schemas, calls the course service, shapes the HTTP response. No business
// logic. Mounted on the platform/superadmin path (req.platformAdmin is set by
// platformAuthenticate).
// ============================================================================
import {
    courseCreateSchema,
    courseUpdateSchema,
    moduleCreateSchema,
    moduleUpdateSchema,
    lessonCreateSchema,
    lessonUpdateSchema,
    lessonFileCreateSchema,
    resourceCreateSchema,
    reorderSchema,
    presignSchema,
    courseIdParamSchema,
    lessonIdParamSchema,
    moduleIdParamSchema,
    lessonFileIdParamSchema,
    resourceIdParamSchema,
} from '../models/course.model.js';
import { courseService } from '../services/course.service.js';

export const courseController = {
    async list(_req, res) {
        const out = await courseService.listCourses();
        res.json(out);
    },

    async presign(req, res) {
        const { filename, content_type } = presignSchema.parse(req.body);
        const out = await courseService.presignAttachment(filename, content_type);
        res.json(out);
    },

    async get(req, res) {
        const { id } = courseIdParamSchema.parse(req.params);
        const out = await courseService.getCourse(id);
        res.json(out);
    },

    async create(req, res) {
        const body = courseCreateSchema.parse(req.body);
        const out = await courseService.createCourse(body, req.platformAdmin);
        res.status(201).json(out);
    },

    async update(req, res) {
        const { id } = courseIdParamSchema.parse(req.params);
        const body = courseUpdateSchema.parse(req.body);
        const out = await courseService.updateCourse(id, body);
        res.json(out);
    },

    async remove(req, res) {
        const { id } = courseIdParamSchema.parse(req.params);
        const out = await courseService.deleteCourse(id);
        res.json(out);
    },

    async publish(req, res) {
        const { id } = courseIdParamSchema.parse(req.params);
        const status = req.body?.status === 'draft' ? 'draft' : 'published';
        const out = await courseService.setStatus(id, status);
        res.json(out);
    },

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

    async addLesson(req, res) {
        const { id, moduleId } = moduleIdParamSchema.parse(req.params);
        const body = lessonCreateSchema.parse(req.body);
        const out = await courseService.addLesson(id, moduleId, body);
        res.status(201).json(out);
    },

    async updateLesson(req, res) {
        const { id, lessonId } = lessonIdParamSchema.parse(req.params);
        const body = lessonUpdateSchema.parse(req.body);
        const out = await courseService.updateLesson(id, lessonId, body);
        res.json(out);
    },

    async removeLesson(req, res) {
        const { id, lessonId } = lessonIdParamSchema.parse(req.params);
        const out = await courseService.deleteLesson(id, lessonId);
        res.json(out);
    },

    async reorderLessons(req, res) {
        const { id, moduleId } = moduleIdParamSchema.parse(req.params);
        const { ids } = reorderSchema.parse(req.body);
        const out = await courseService.reorderLessons(id, moduleId, ids);
        res.json({ lessons: out });
    },

    async addResource(req, res) {
        const { id } = courseIdParamSchema.parse(req.params);
        const body = resourceCreateSchema.parse(req.body);
        const out = await courseService.addResource(id, body);
        res.status(201).json(out);
    },

    async removeResource(req, res) {
        const { id, resId } = resourceIdParamSchema.parse(req.params);
        const out = await courseService.deleteResource(id, resId);
        res.json(out);
    },

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
};
