// ============================================================================
// Auth model — Zod schemas + inferred types for signup / invite input.
// ============================================================================
import * as zod_1 from "zod";
export const signupSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
    full_name: zod_1.z.string(),
    organisation_name: zod_1.z.string(),
});
export const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
export const inviteSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    full_name: zod_1.z.string(),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception']),
});
