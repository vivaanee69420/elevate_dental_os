// ============================================================================
// Plan4Growth AI service — loads business context (business_health + latest
// snapshot), calls askPlan4GrowthAI, and surfaces a 500 'AI service
// unavailable' on failure (preserved exactly from the original).
// ============================================================================
import * as p4g_ai_repository_1 from "../repositories/p4g-ai.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as claude_1 from "../lib/claude.js";
export const p4gAiService = {
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
