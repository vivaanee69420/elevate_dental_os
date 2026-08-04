// ============================================================================
// Sheet model — Zod schemas for the Call Reporting (Google Sheets) surface.
// ============================================================================
import * as zod_1 from "zod";
import { uuid } from "./common.model.js";

// Paste-a-URL source registration (full URL or bare spreadsheet id).
export const sheetSourceCreateSchema = zod_1.z.object({
    url: zod_1.z.string().trim().min(10).max(500),
});

export const sheetPreviewQuerySchema = zod_1.z.object({
    tab: zod_1.z.string().trim().min(1).max(200),
});

// One-time column mapping: 0-based column indexes for the five stored fields.
// first_call_at may be blank in the sheet (not yet called) but the COLUMN must
// be mapped. Indexes must be distinct — two fields reading one column is
// always a setup mistake.
const colIdx = zod_1.z.number().int().min(0).max(199);
export const sheetMappingSchema = zod_1.z.object({
    tab_name: zod_1.z.string().trim().min(1).max(200),
    header_row: zod_1.z.number().int().min(1).max(1000).default(1),
    columns: zod_1.z.object({
        practice: colIdx,
        created_at: colIdx,
        first_call_at: colIdx,
        source: colIdx,
        pipeline_status: colIdx,
    }),
}).refine(
    (v) => new Set(Object.values(v.columns)).size === Object.values(v.columns).length,
    { message: 'each field must map to a different column' },
);

export const sheetPracticeMapSetSchema = zod_1.z.object({
    sheet_value: zod_1.z.string().trim().min(1).max(200),
    practice_id: uuid.nullable(),
});

// Dashboard query: ?date=YYYY-MM-DD (default today, London) + optional practice.
export const callReportingQuerySchema = zod_1.z.object({
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
    practice_id: zod_1.z.preprocess(
        (v) => (v === '' || v == null ? undefined : v),
        uuid.optional(),
    ),
});
