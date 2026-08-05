// ============================================================================
// Sheet model — Zod schemas for the Call Reporting (Google Sheets) surface.
// ============================================================================
import * as zod_1 from "zod";
import { uuid } from "./common.model.js";

// Paste-a-URL source registration (full URL or bare spreadsheet id) + the
// practice this sheet belongs to (free-text label — deliberately NOT linked
// to the practices table; Call Reporting is self-contained).
export const sheetSourceCreateSchema = zod_1.z.object({
    url: zod_1.z.string().trim().min(10).max(500),
    practice_label: zod_1.z.string().trim().min(1).max(100),
});

export const sheetSourceIdSchema = zod_1.z.object({ id: uuid });

export const sheetPreviewQuerySchema = zod_1.z.object({
    tab: zod_1.z.string().trim().min(1).max(200),
});

// One-time column mapping: 0-based column indexes for the five stored fields.
// Indexes must be distinct — two fields reading one column is a setup mistake.
const colIdx = zod_1.z.number().int().min(0).max(199);
export const sheetMappingSchema = zod_1.z.object({
    tab_name: zod_1.z.string().trim().min(1).max(200),
    header_row: zod_1.z.number().int().min(1).max(1000).default(1),
    columns: zod_1.z.object({
        date: colIdx,
        created_time: colIdx,
        called_3m: colIdx,
        called_10m: colIdx,
        pipeline_name: colIdx,
    }),
}).refine(
    (v) => new Set(Object.values(v.columns)).size === Object.values(v.columns).length,
    { message: 'each field must map to a different column' },
);

// Dashboard query: ?date=YYYY-MM-DD (default today, London) + optional sheet
// (source id = practice).
export const callReportingQuerySchema = zod_1.z.object({
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
    source: zod_1.z.preprocess(
        (v) => (v === '' || v == null ? undefined : v),
        uuid.optional(),
    ),
});
