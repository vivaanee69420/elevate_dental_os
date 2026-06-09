// ============================================================================
// AI provider contract. Every adapter (anthropic, openrouter) implements this
// one normalised call. The tool_use <-> tool_calls translation lives ONLY in
// the adapter files — nothing above lib/ai/ knows which provider is active.
//
// chat({ system, messages, tools, maxTokens, schema }) -> {
//   text:       string,                         // concatenated assistant text
//   toolCalls:  [{ id, name, input }],          // [] when none
//   usage:      { inputTokens, outputTokens },
//   stopReason: string,                         // 'end_turn' | 'tool_use' | ...
// }
//
// messages: [{ role: 'user'|'assistant', content: string }]   (Phase 1)
//           Phase 2 extends content to block arrays (tool_result).
// tools:    [{ name, description, inputSchema }]  inputSchema = JSON Schema obj
// schema:   JSON Schema object — when set, the reply text is schema-valid JSON.
// ============================================================================
export const PROVIDER_CONTRACT = 'chat({system,messages,tools,maxTokens,schema}) -> {text,toolCalls,usage,stopReason}';
