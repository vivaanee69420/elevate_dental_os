"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.integrationConnectSchema = void 0;
// ============================================================================
// Integration model — Zod schemas + inferred types.
// ============================================================================
const zod_1 = require("zod");
exports.integrationConnectSchema = zod_1.z.object({
    provider: zod_1.z.string(),
    redirect_url: zod_1.z.string().url().optional(),
});
