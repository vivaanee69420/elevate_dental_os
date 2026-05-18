"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewRespondSchema = void 0;
// ============================================================================
// Review model — Zod schemas + inferred types.
// ============================================================================
const zod_1 = require("zod");
exports.reviewRespondSchema = zod_1.z.object({
    response: zod_1.z.string(),
});
