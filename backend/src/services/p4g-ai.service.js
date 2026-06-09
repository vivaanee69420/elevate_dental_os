// ============================================================================
// Plan4Growth AI service — budget-gated chat. Loads business context, checks
// the org's monthly AI budget, calls askPlan4GrowthAI, records usage + audit.
// ============================================================================
import * as p4g_ai_repository_1 from "../repositories/p4g-ai.repository.js";
import * as errors_1 from "../middleware/errors.js";
import * as claude_1 from "../lib/gemini.js";
import { checkBudget, recordUsage } from "../lib/ai/guardrails.js";
import { analyticsService } from "./analytics.service.js";

export const p4gAiService = {
    async chat(orgId, body, userId) {
        await checkBudget(orgId); // throws AppError 429 when over
        const health = await p4g_ai_repository_1.p4gAiRepository.health(orgId);
        const snapshots = await p4g_ai_repository_1.p4gAiRepository.latestSnapshot(orgId);
        const liveData = await analyticsService.getLiveContextData(orgId);
        const { isContextEmpty, missingSources } = await import("./ai-context.service.js");
        if (isContextEmpty(liveData)) {
            const missing = missingSources(liveData);
            return {
                reply: `I don't have your live numbers yet. Connect your data to unlock AI insights — missing: ${missing.join(', ')}.`,
                missing, usage: { inputTokens: 0, outputTokens: 0 },
            };
        }
        let result;
        try {
            result = await (0, claude_1.askPlan4GrowthAI)(orgId, body.message, {
                baseline: health?.baseline, targets: health?.targets, recentSnapshot: snapshots?.[0],
                liveData,
            }, body.history);
        } catch (err) {
            // Don't swallow the real cause — log it and surface a diagnosable
            // error. A Gemini 429 (RESOURCE_EXHAUSTED / quota / rate limit) is a
            // transient "busy", not a 500; keep the two distinct so Sentry and
            // the operator can tell quota exhaustion from an actual code fault.
            console.error('[p4g-ai] askPlan4GrowthAI failed:', err?.message || err);
            if (err instanceof errors_1.AppError) throw err;
            const msg = String(err?.message || err || '');
            const quota = /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg);
            throw quota
                ? new errors_1.AppError('AI is busy (rate limit) — try again in a moment.', 429)
                : new errors_1.AppError(`AI service unavailable: ${msg.slice(0, 300)}`, 500);
        }
        await recordUsage(orgId, { feature: 'chat', model: process.env.AI_MODEL || 'claude-sonnet-4-6', usage: result.usage, userId });
        return result;
    },
};
