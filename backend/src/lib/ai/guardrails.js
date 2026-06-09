// backend/src/lib/ai/guardrails.js
// ============================================================================
// AI guardrails: prompt-injection delimiting, budget checks, and usage
// recording. Untrusted content (user messages, lead notes, patient notes) is
// wrapped in a labelled tag the system prompt treats as DATA. Budget is checked
// per-org before each call; usage is recorded (with an audit_log row) after.
// ============================================================================
import { aiUsageRepository } from "../../repositories/ai-usage.repository.js";
import * as supabase_1 from "../supabase.js";
import { AppError } from "../../middleware/errors.js";

// Defang any literal closing tag inside the content so it can't end the block.
export function delimit(tag, content) {
  const safe = String(content ?? '').split(`</${tag}>`).join(`</ ${tag}>`);
  return `<${tag}>\n${safe}\n</${tag}>`;
}

export const DEFAULT_MONTHLY_TOKEN_BUDGET = 2_000_000;

// Blended pence per 1M tokens (input+output averaged, integer pence). Tune per model.
const PENCE_PER_MILLION = { 'claude-sonnet-4-6': 700, 'claude-haiku-4-5': 250, default: 700 };
function costPence(model, totalTokens) {
  const rate = PENCE_PER_MILLION[model] ?? PENCE_PER_MILLION.default;
  return Math.round((totalTokens / 1_000_000) * rate);
}

function firstOfMonthISO() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function checkBudget(orgId) {
  const config = await aiUsageRepository.config(orgId);
  const budget = config?.monthly_token_budget ?? DEFAULT_MONTHLY_TOKEN_BUDGET;
  const used = await aiUsageRepository.monthTokens(orgId, firstOfMonthISO());
  if (used >= budget) throw new AppError('Monthly AI budget reached. Contact your administrator to raise the limit.', 429);
}

export async function recordUsage(orgId, { feature, model, usage, userId }) {
  const total = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  await aiUsageRepository.record({
    organisation_id: orgId, feature, model,
    input_tokens: usage?.inputTokens ?? 0, output_tokens: usage?.outputTokens ?? 0,
    cost_pence: costPence(model, total), call_count: 1,
  });
  // Rule 9 — audit every AI mutation.
  supabase_1.serviceClient.from('audit_log').insert({
    organisation_id: orgId, user_id: userId ?? null, action: 'ai_call',
    entity_type: 'ai', entity_id: null,
  }).then(({ error }) => { if (error) console.error('audit ai_call failed', error); });
}
