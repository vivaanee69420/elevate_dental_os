// CSV manual-feed models — Zod schemas for the upload request and per-dataset
// row validation. Three core datasets land in the same tables Dentally syncs to,
// with source='manual', so the manual feed and the API feed share one shape.
//
// Templates: elevate-complete/02-launch-control-handoff/manual-feed-templates/

import { z } from "zod";

export const DATASETS = ['payments', 'appointments', 'patients'];

// Upload request: the frontend reads the file client-side and posts its text.
export const csvUploadSchema = z.object({
    dataset: z.enum(['payments', 'appointments', 'patients']),
    filename: z.string().max(255).optional(),
    content: z.string().min(1, 'empty file'),
});

// ---- per-dataset row schemas (validate the parsed CSV rows) ----------------
// Coercion-light: we validate shape + required fields here; mapping to pence /
// practice ids happens in the service where the practice map is available.

const moneyString = z.string().refine((s) => Number.isFinite(Number(s)), 'amount must be a number');
const dateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date');

export const paymentRowSchema = z.object({
    payment_id: z.string().min(1, 'payment_id required'),
    practice_code: z.string().min(1, 'practice_code required'),
    patient_external_id: z.string().optional().default(''),
    payment_date: dateString,
    amount: moneyString,
    payment_method: z.string().optional().default(''),
    allocated_status: z.string().optional().default(''),
});

export const patientRowSchema = z.object({
    patient_external_id: z.string().min(1, 'patient_external_id required'),
    first_name: z.string().optional().default(''),
    last_name: z.string().optional().default(''),
    email: z.string().optional().default(''),
    phone: z.string().optional().default(''),
    date_of_birth: z.string().optional().default(''),
    practice_code: z.string().optional().default(''),
});

export const appointmentRowSchema = z.object({
    appointment_external_id: z.string().min(1, 'appointment_external_id required'),
    practice_code: z.string().min(1, 'practice_code required'),
    patient_external_id: z.string().optional().default(''),
    starts_at: dateString,
    ends_at: dateString,
    status: z.string().optional().default('scheduled'),
});

export const ROW_SCHEMA = {
    payments: paymentRowSchema,
    patients: patientRowSchema,
    appointments: appointmentRowSchema,
};

// Maps each dataset to its live target table + idempotent conflict target.
export const TARGET = {
    payments: { table: 'payments', onConflict: 'organisation_id,source,external_id' },
    patients: { table: 'contacts', onConflict: 'organisation_id,source,pms_external_id' },
    appointments: { table: 'appointments', onConflict: 'organisation_id,source,pms_external_id' },
};
