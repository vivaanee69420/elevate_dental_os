// ============================================================================
// Plan4Growth AI service — budget-gated chat. Loads business context, checks
// the org's monthly AI budget, calls askPlan4GrowthAI, records usage + audit.
// ============================================================================
import * as p4g_ai_repository_1 from "../repositories/p4g-ai.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as claude_1 from "../lib/claude.js";
import { checkBudget, recordUsage } from "../lib/ai/guardrails.js";
import { analyticsService } from "./analytics.service.js";

export const p4gAiService = {
    async chat(orgId, body, userId) {
        await checkBudget(orgId); // throws AppError 429 when over
        const health = await p4g_ai_repository_1.p4gAiRepository.health(orgId);
        const snapshots = await p4g_ai_repository_1.p4gAiRepository.latestSnapshot(orgId);
        const liveData = await analyticsService.getLiveContextData(orgId);
        let result;
        try {
            result = await (0, claude_1.askPlan4GrowthAI)(body.message, {
                baseline: health?.baseline, targets: health?.targets, recentSnapshot: snapshots?.[0],
                liveData,
            }, body.history);
        } catch (err) {
            throw new errors_1.AppError('AI service unavailable', 500);
        }
        await recordUsage(orgId, { feature: 'chat', model: process.env.AI_MODEL || 'claude-sonnet-4-6', usage: result.usage, userId });
        return result;
    },
};
