// ============================================================================
// Course model — Zod schemas for the Module Library (LMS) authoring API.
// Validates platform/superadmin authoring payloads before they reach the
// service. The catalog (courses/lessons/resources) is GLOBAL content — no
// organisation_id (see migration 000045_courses.sql).
// ============================================================================
import * as zod_1 from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = zod_1.z.string().regex(UUID_RE, 'must be a UUID');

const TRACKS = ['foundations', 'business-health', 'marketing', 'implants', 'business', 'sales'];
const LEVELS = ['all', 'beginner', 'intermediate', 'advanced'];
const ACCESS = ['free', 'mentorship'];
const FILE_CATEGORIES = ['presentations', 'reading', 'assignments', 'clinical', 'misc'];
const RESOURCE_CATEGORIES = ['marking-rubrics', 'additional-resources'];

export const courseCreateSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200),
    slug: zod_1.z.string().trim().max(200).optional(),
    track: zod_1.z.enum(TRACKS).default('foundations'),
    level: zod_1.z.enum(LEVELS).default('all'),
    access: zod_1.z.enum(ACCESS).default('free'),
    featured: zod_1.z.boolean().default(false),
    description: zod_1.z.string().trim().max(2000).default(''),
    instructor: zod_1.z.string().trim().max(200).default(''),
    instructor_title: zod_1.z.string().trim().max(200).default(''),
    outcome: zod_1.z.string().trim().max(1000).default(''),
    position: zod_1.z.number().int().min(0).default(0),
});

// All fields optional on update; at least one must be present.
export const courseUpdateSchema = courseCreateSchema.partial().refine(
    (o) => Object.keys(o).length > 0,
    { message: 'no fields to update' },
);

export const moduleCreateSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200),
    position: zod_1.z.number().int().min(0).optional(),
    access: zod_1.z.enum(ACCESS).default('free'),
});

export const moduleUpdateSchema = moduleCreateSchema.partial().refine(
    (o) => Object.keys(o).length > 0,
    { message: 'no fields to update' },
);

export const lessonCreateSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200),
    position: zod_1.z.number().int().min(0).optional(),
    module_id: uuid.optional(),
    access: zod_1.z.enum(ACCESS).default('free'),
    body: zod_1.z.string().max(100000).optional(),
    teaser: zod_1.z.string().max(2000).optional(),
    attachment_file_key: zod_1.z.string().max(1024).optional(),
    attachment_name: zod_1.z.string().max(400).optional(),
    attachment_type: zod_1.z.string().max(100).optional(),
    attachment_size_bytes: zod_1.z.number().int().min(0).optional(),
});

export const lessonUpdateSchema = lessonCreateSchema.partial().refine(
    (o) => Object.keys(o).length > 0,
    { message: 'no fields to update' },
);

export const resourceCreateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(400),
    file_key: zod_1.z.string().trim().min(1).max(1024),
    file_type: zod_1.z.string().max(100).optional(),
    size_bytes: zod_1.z.number().int().min(0).optional(),
    access: zod_1.z.enum(ACCESS).default('free'),
    position: zod_1.z.number().int().min(0).default(0),
    category: zod_1.z.enum(RESOURCE_CATEGORIES).default('additional-resources'),
});

export const lessonFileCreateSchema = zod_1.z.object({
    category: zod_1.z.enum(FILE_CATEGORIES).default('misc'),
    name: zod_1.z.string().trim().min(1).max(400),
    file_key: zod_1.z.string().trim().min(1).max(1024),
    file_type: zod_1.z.string().max(100).optional(),
    size_bytes: zod_1.z.number().int().min(0).optional(),
    access: zod_1.z.enum(ACCESS).default('free'),
});

// Reorder lessons: ordered array of lesson ids.
export const reorderSchema = zod_1.z.object({
    ids: zod_1.z.array(uuid).min(1).max(500),
});

// Attachment presign (platform path): admin uploads PPT/PDF/doc straight to S3.
export const presignSchema = zod_1.z.object({
    filename: zod_1.z.string().trim().min(1).max(400),
    content_type: zod_1.z.string().trim().min(1).max(200),
});

export const courseIdParamSchema = zod_1.z.object({ id: uuid });
export const lessonIdParamSchema = zod_1.z.object({ id: uuid, lessonId: uuid });
export const resourceIdParamSchema = zod_1.z.object({ id: uuid, resId: uuid });
export const moduleIdParamSchema = zod_1.z.object({ id: uuid, moduleId: uuid });
export const lessonFileIdParamSchema = zod_1.z.object({ id: uuid, lessonId: uuid, fileId: uuid });
