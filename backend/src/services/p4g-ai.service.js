"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.p4gAiService = void 0;
// ============================================================================
// Plan4Growth AI service — loads business context (business_health + latest
// snapshot), calls askPlan4GrowthAI, and surfaces a 500 'AI service
// unavailable' on failure (preserved exactly from the original).
// ============================================================================
const p4g_ai_repository_1 = require("../repositories/p4g-ai.repository");
const errors_1 = require("../middleware/errors");
const claude_1 = require("../lib/claude");
exports.p4gAiService = {
    async chat(orgId, body) {
        // Load context
        const health = await p4g_ai_repository_1.p4gAiRepository.health(orgId);
        const snapshots = await p4g_ai_repository_1.p4gAiRepository.latestSnapshot(orgId);
        try {
            const result = await (0, claude_1.askPlan4GrowthAI)(body.message, {
                baseline: health?.baseline,
                targets: health?.targets,
                recentSnapshot: snapshots?.[0],
            }, body.history);
            return result;
        }
        catch (err) {
            throw new errors_1.AppError('AI service unavailable', 500);
        }
    },
};
