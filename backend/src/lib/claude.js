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
// AI ANALYST (GM Intelligence OS) — answers a free-text question about the
// group's LIVE numbers for the current scope/period, and returns ranked findings
// in the Insight shape the screen renders ({ sev, t, d, v }). `summary` is a
// compact, already-real data bundle assembled by the service (no fabrication).
// Throws when no API key (caller falls back to deterministic findings).
// ============================================================================
const SEV_MAP = { good: 'good', positive: 'good', warn: 'warn', warning: 'warn', bad: 'bad', critical: 'bad', danger: 'bad', info: 'info' };
function normSev(s) { return SEV_MAP[String(s || '').toLowerCase()] || 'info'; }

export async function askAnalyst(question, summary) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('No ANTHROPIC_API_KEY');
    const prompt = `A UK dental practice group owner asks a question about their LIVE numbers. Answer using ONLY the data provided — reference the actual figures, never invent numbers. Money is shown in pence; talk in £.

SCOPE: ${summary.scopeLabel} · ${summary.periodLabel}
LIVE DATA (real, integer pence unless noted):
${JSON.stringify(summary.data)}

Owner's question: ${question}

Return ONLY valid JSON, no prose/code-fences, of the form:
{"answer": "2-4 sentence direct answer in £, referencing the real figures", "findings": [{"severity":"good|warn|bad|info","title":"short headline with a real number","detail":"1-2 sentences: the data point + the action","value":"the £ impact or metric, e.g. £12,400/mo or 3.1x"}]}
Give 2-4 findings ranked by importance. If the data can't answer the question, say so honestly in "answer" and return findings:[].`;
    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system: 'You are a UK dental business analyst. Return only a single valid JSON object.',
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const obj = JSON.parse(jsonText);
    const findings = Array.isArray(obj.findings)
        ? obj.findings.filter((x) => x && x.title).map((x) => ({
            sev: normSev(x.severity), t: String(x.title),
            d: String(x.detail || ''), v: x.value ? String(x.value) : '',
        }))
        : [];
    return { answer: typeof obj.answer === 'string' ? obj.answer : '', findings, usage: response.usage };
}

// ============================================================================
// BOARD REPORT — Claude writes the executive summary + RAG-coded priorities for
// the monthly/weekly board pack (DentaCFO gap module, Phase 2). `bundle` is an
// already-real data digest assembled by the service from live rollups (group
// totals, leakage, top/weak practice) — never fabricate numbers. Money in the
// bundle is integer pence; the model talks in £. Throws when no API key so the
// caller falls back to a deterministic, data-driven summary.
// ============================================================================
const RAG_MAP = { red: 'red', amber: 'amber', green: 'green', good: 'green', warn: 'amber', warning: 'amber', bad: 'red', critical: 'red' };
function normRag(s) { return RAG_MAP[String(s || '').toLowerCase()] || 'amber'; }

export async function generateBoardReport(bundle) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('No ANTHROPIC_API_KEY');
    const prompt = `Write a board pack for a UK dental practice group from its LIVE numbers. Use ONLY the data provided — reference the actual figures, never invent. Money is integer pence; talk in £ (round sensibly). British English.

SCOPE: ${bundle.scopeLabel} · ${bundle.periodLabel}
LIVE DATA (real, integer pence unless noted):
${JSON.stringify(bundle.data)}

Return ONLY valid JSON, no prose/code-fences, of the form:
{"summary": ["4-6 board-grade sentences, each a standalone bullet citing a real figure — turnover, margin, recoverable leakage, concentration, capacity"], "priorities": [{"rag":"red|amber|green","text":"one prioritised action with the £ value and a named owner role (e.g. COO, Site managers, Reception)"}]}
Give exactly 3 priorities ranked red→green by urgency. Lead with the biggest recoverable lever.`;
    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system: 'You are a UK dental group CFO writing a board pack. Return only a single valid JSON object.',
        messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const obj = JSON.parse(jsonText);
    const summary = Array.isArray(obj.summary)
        ? obj.summary.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
        : [];
    const priorities = Array.isArray(obj.priorities)
        ? obj.priorities.filter((p) => p && p.text).map((p) => ({ rag: normRag(p.rag), text: String(p.text) }))
        : [];
    return { summary, priorities, usage: response.usage };
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
