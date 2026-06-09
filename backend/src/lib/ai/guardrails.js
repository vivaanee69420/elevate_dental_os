// backend/src/lib/ai/guardrails.js
// ============================================================================
// AI guardrails: prompt-injection delimiting (this task), plus budget checks
// and usage recording (Task 9). Untrusted content (user messages, lead notes,
// patient notes) is wrapped in a labelled tag the system prompt treats as DATA.
// ============================================================================

// Defang any literal closing tag inside the content so it can't end the block.
export function delimit(tag, content) {
  const safe = String(content ?? '').split(`</${tag}>`).join(`</ ${tag}>`);
  return `<${tag}>\n${safe}\n</${tag}>`;
}
