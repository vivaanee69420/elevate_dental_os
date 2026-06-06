// ============================================================================
// Platform course-authoring routes — Module Library (LMS) admin API.
// Mounted at /api/platform/courses (see app.js), BEFORE the tenant /api router,
// so it runs on the platform auth path only. A NEW file (not platform-admin.
// routes.js) to keep the LMS slice isolated from the rest of the superadmin
// console. Every endpoint requires a superadmin platform token.
//
// The catalog is global content; tenant read/enrol/progress lives on the
// tenant /api/training path (separate slice). File uploads reuse the tenant
// /api/files/presign endpoint; only the returned S3 key is stored here.
// ============================================================================
import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { platformAuthenticate, requirePlatformRole } from '../middleware/platform-auth.js';
import { courseController } from '../controllers/course.controller.js';

const router = Router();

// All authoring is superadmin-only.
router.use(platformAuthenticate);
router.use(requirePlatformRole('superadmin'));

// ---- Attachment upload (presign) ----
router.post('/presign', asyncHandler(courseController.presign));

// ---- Courses ----
router.get('/', asyncHandler(courseController.list));
router.post('/', asyncHandler(courseController.create));
router.get('/:id', asyncHandler(courseController.get));
router.patch('/:id', asyncHandler(courseController.update));
router.delete('/:id', asyncHandler(courseController.remove));
router.post('/:id/publish', asyncHandler(courseController.publish));

// ---- Modules (reorder before :moduleId so the literal isn't shadowed) ----
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

// ---- Resources ----
router.post('/:id/resources', asyncHandler(courseController.addResource));
router.delete('/:id/resources/:resId', asyncHandler(courseController.removeResource));

export default router;
