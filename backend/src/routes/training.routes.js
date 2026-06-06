// ============================================================================
// Training routes — Module Library (LMS) tenant path: read catalogue, enrol,
// lesson progress, "my training" feed, attachment downloads. Mounted at
// /api/training (tenant auth).
//
// /library + /courses/:id read the REAL published catalogue via trainingService
// (global content, gated by the org's mentorship_active flag) and now carry the
// per-(org,user) enrolment + progress state. Mentorship/one-to-one are still
// stubs (separate slices).
// ============================================================================
import * as express_1 from "express";
import * as zod_1 from "zod";
import * as async_handler_1 from "../middleware/async-handler.js";
import { uuid } from "../models/common.model.js";
import { trainingService } from "../services/training.service.js";

const router = (0, express_1.Router)();

// Path-param + body validators for the tenant LMS endpoints. All catalogue ids
// are UUIDs — a malformed id is a 400, not a Postgres 22P02 → 500.
const courseIdParams = zod_1.z.object({ id: uuid });
const lessonIdParams = zod_1.z.object({ lessonId: uuid });
const fileIdParams = zod_1.z.object({ fileId: uuid });
const resourceIdParams = zod_1.z.object({ resourceId: uuid });
const completeBody = zod_1.z.object({ completed: zod_1.z.boolean().optional() });

// Published catalogue + the org's mentorship flag + this user's progress.
router.get('/library', (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json(await trainingService.library(req.user.organisation_id, req.user.id));
}));

// One published course, full content, gated per access, with progress.
router.get('/courses/:id', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { id } = courseIdParams.parse(req.params);
    res.json(await trainingService.courseDetail(req.user.organisation_id, req.user.id, id));
}));

// Enrol the current user in a published course (idempotent).
router.post('/courses/:id/enrol', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { id } = courseIdParams.parse(req.params);
    res.json(await trainingService.enrol(req.user.organisation_id, req.user.id, id));
}));

// Mark a lesson complete (default) or incomplete ({ completed: false }).
router.post('/lessons/:lessonId/complete', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { lessonId } = lessonIdParams.parse(req.params);
    const { completed } = completeBody.parse(req.body ?? {});
    res.json(await trainingService.setLessonComplete(
        req.user.organisation_id, req.user.id, lessonId, completed !== false,
    ));
}));

// Signed S3 GET for a lesson attachment (gated like the detail view).
router.get('/lessons/:lessonId/attachment', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { lessonId } = lessonIdParams.parse(req.params);
    res.json(await trainingService.lessonAttachmentUrl(req.user.organisation_id, lessonId));
}));

// Signed S3 GET for a lesson file (lesson_files table, gated like the lesson).
router.get('/lesson-files/:fileId/download', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { fileId } = fileIdParams.parse(req.params);
    res.json(await trainingService.lessonFileUrl(req.user.organisation_id, fileId));
}));

// Signed S3 GET for a course resource (gated like the detail view).
router.get('/resources/:resourceId/download', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { resourceId } = resourceIdParams.parse(req.params);
    res.json(await trainingService.resourceDownloadUrl(req.user.organisation_id, resourceId));
}));

// "My training": enrolled published courses + per-course progress.
router.get('/my', (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json(await trainingService.myTraining(req.user.organisation_id, req.user.id));
}));

// ---- Still stubbed (separate mentorship / one-to-one slices) ----
router.get('/mentorship', (0, async_handler_1.asyncHandler)(async (_req, res) => {
    res.json({ programmes: [] });
}));

router.get('/one-to-one', (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json({ user_id: req.user.id, sessions: [] });
}));

export default router;
