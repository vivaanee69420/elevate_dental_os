"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inviteSchema = exports.signupSchema = void 0;
// ============================================================================
// Auth model — Zod schemas + inferred types for signup / invite input.
// ============================================================================
const zod_1 = require("zod");
exports.signupSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
    full_name: zod_1.z.string(),
    organisation_name: zod_1.z.string(),
});
exports.inviteSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    full_name: zod_1.z.string(),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception']),
});
