// ============================================================================
// PLAN4GROWTH AI — AI Coach powered by Claude Sonnet 4.6
// ============================================================================
import * as sdk_1 from "@anthropic-ai/sdk";
const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5-20250929';
const SYSTEM_PROMPT = `You are Plan4Growth AI, the AI coach inside Elevate Dental OS — a business intelligence platform for UK dental practice groups.

Your role:
- Analyse the user's business data (financial, operational, marketing, patient)
- Give specific, actionable advice — never generic platitudes
- Use UK dental industry benchmarks: net margin 15% (avg), 20%+ (top quartile), conversion 18%, FTA 5-8%, chair util 85%+
- All money in £ (pounds)
- Concise: 2-3 paragraphs maximum unless asked for detail
- Reference the user's actual numbers, not hypotheticals
- If a target seems unrealistic, say so — but help them rebuild it

Tone: Sharp, direct, no fluff. Like a senior partner at a top dental consultancy giving frank advice.

When users ask for next actions, suggest 1-3 specific things with estimated impact.
When users share results, celebrate wins specifically (avoid generic "great job").
When data is missing, ask for it — don't speculate.

Never:
- Make up numbers
- Recommend specific tools/vendors unless asked
- Diagnose individual patient cases
- Give medical advice`;
export async function askPlan4GrowthAI(userMessage, context, conversationHistory = []) {
    const contextString = `
USER'S BUSINESS DATA:
${context.baseline ? `Baseline (when they joined): ${JSON.stringify(context.baseline)}` : 'No baseline set'}
${context.targets ? `Targets: ${JSON.stringify(context.targets)}` : 'No targets set'}
${context.currentMetrics ? `Current metrics: ${JSON.stringify(context.currentMetrics)}` : ''}
${context.recentSnapshot ? `Most recent snapshot: ${JSON.stringify(context.recentSnapshot)}` : ''}
`.trim();
    const messages = [
        ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
        {
            role: 'user',
            content: `${contextString}\n\nUser question: ${userMessage}`,
        },
    ];
    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
    });
    const reply = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    return {
        reply,
        usage: response.usage,
    };
}
// ============================================================================
// PLAN4GROWTH AI INSIGHTS — Generates the initial business health analysis
// ============================================================================
export async function generateHealthInsights(baseline, targets) {
    const prompt = `Analyse this UK dental practice group's baseline data and generate exactly 5 specific, prioritised insights.

For each insight, return:
- title: short headline (e.g. "Conversion below benchmark")
- severity: "positive" | "warning" | "critical"
- finding: one sentence stating the data point
- impact: estimated £ impact if addressed (e.g. "+£35k/month")
- action: one specific next action (e.g. "TCO training + treatment plan presentation script")

Baseline: ${JSON.stringify(baseline)}
Targets: ${JSON.stringify(targets)}

Return ONLY valid JSON array of 5 insights. No other text.`;
    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: 'You are a UK dental business analyst. Return only valid JSON.',
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    try {
        // Strip any code fences
        const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(jsonText);
    }
    catch (err) {
        console.error('Failed to parse Plan4Growth AI insights:', text);
        return [];
    }
}

// ============================================================================
// AI-INSIGHTS — Claude analyses LIVE rollups (baseline + per-practice/source
// conversion + revenue projection) and writes insight cards in the exact
// shape the AI Insights screen renders. Returns [] on any failure so the
// caller can fall back to the deterministic rule-based insights.
// ============================================================================
export async function generateDataInsights(ctx) {
    const prompt = `You are analysing a UK dental practice group's LIVE data. Generate 4-6 specific, prioritised insights a practice owner can act on. Reference the actual numbers — never generic advice.

Baseline (annual, £ pounds; cost_* are % of revenue): ${JSON.stringify(ctx.baseline ?? {})}
12-month revenue projection (pence): ${JSON.stringify(ctx.series ?? [])}
Per-practice last 30 days (conversion %, revenue pence): ${JSON.stringify(ctx.practices ?? [])}
Per-source last 30 days (conversion %, leads, pipeline pence): ${JSON.stringify(ctx.sources ?? [])}

For each insight return an object:
- type: "positive" | "warning" | "info"
- title: short headline referencing a real number
- detail: 1-2 sentences — the data point + why it matters
- action: one specific next step

Return ONLY a valid JSON array (4-6 items). No prose, no code fences.`;
    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: 'You are a UK dental business analyst. Return only a valid JSON array of insight objects.',
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    try {
        const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const arr = JSON.parse(jsonText);
        if (!Array.isArray(arr))
            return [];
        const ALLOWED = new Set(['positive', 'warning', 'info']);
        return arr
            .filter((x) => x && x.title && x.detail)
            .map((x) => ({
                type: ALLOWED.has(x.type) ? x.type : 'info',
                title: String(x.title),
                detail: String(x.detail),
                action: x.action ? String(x.action) : 'Review',
            }));
    }
    catch (err) {
        console.error('Failed to parse data insights:', text);
        return [];
    }
}
