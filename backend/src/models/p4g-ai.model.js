"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.p4gChatSchema = void 0;
// ============================================================================
// Plan4Growth AI model — Zod schema + inferred type for chat input.
// ============================================================================
const zod_1 = require("zod");
exports.p4gChatSchema = zod_1.z.object({
    message: zod_1.z.string().min(1),
    history: zod_1.z.array(zod_1.z.object({
        role: zod_1.z.enum(['user', 'assistant']),
        content: zod_1.z.string(),
    })).optional().default([]),
});
