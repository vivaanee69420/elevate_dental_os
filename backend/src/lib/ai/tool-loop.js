// backend/src/lib/ai/tool-loop.js
// ============================================================================
// Provider-agnostic tool loop. Sends `tools`, executes the model's tool calls
// via org-bound `executors`, appends normalized tool_result turns, and repeats
// up to `maxRounds`. JSON-output callers pass a `schema`; the loop runs
// schema-less (tools and forced JSON do not combine cleanly), then does one
// final no-tools formatting turn to emit the schema-valid JSON. Usage is summed
// across every turn and reported via `onUsage` for budget accounting.
// Tenant isolation: executors are bound to an orgId by the caller; orgId is
// never a tool parameter, so the model cannot reach another org's data.
// ============================================================================

export async function runToolLoop({ provider, system, messages, tools, executors = {}, schema, maxRounds = 5, onUsage } = {}) {
  const convo = messages.map((m) => ({ ...m }));
  let totalIn = 0;
  let totalOut = 0;
  const add = (usage) => { totalIn += usage?.inputTokens || 0; totalOut += usage?.outputTokens || 0; };

  // Tool-calling rounds: always send tools. Stop as soon as the model answers
  // without calling a tool, or when we reach the round cap (maxRounds tool rounds).
  let reply;
  for (let round = 0; round < maxRounds; round++) {
    reply = await provider.chat({ system, messages: convo, ...(tools && tools.length ? { tools } : {}) });
    add(reply.usage);
    if (!reply.toolCalls || !reply.toolCalls.length) break; // model answered

    convo.push({
      role: 'assistant',
      content: [
        ...(reply.text ? [{ type: 'text', text: reply.text }] : []),
        ...reply.toolCalls.map((tc) => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })),
      ],
    });
    const results = [];
    for (const tc of reply.toolCalls) {
      let output;
      try {
        const fn = executors[tc.name];
        output = fn ? await fn(tc.input || {}) : { tool_error: `unknown tool: ${tc.name}` };
      } catch (err) {
        output = { tool_error: String(err?.message || err) };
      }
      results.push({ type: 'tool_result', toolUseId: tc.id, name: tc.name, content: JSON.stringify(output) });
    }
    convo.push({ role: 'user', content: results });
  }

  // Final turn. JSON callers force the schema shape here (no tools). Otherwise, if
  // the cap was hit while the model still wanted tools, force a plain no-tools
  // answer so a dangling tool call is never returned as the reply.
  if (schema) {
    reply = await provider.chat({ system, messages: convo, schema });
    add(reply.usage);
  } else if (reply && reply.toolCalls && reply.toolCalls.length) {
    reply = await provider.chat({ system, messages: convo });
    add(reply.usage);
  }

  const usage = { inputTokens: totalIn, outputTokens: totalOut };
  if (onUsage) onUsage(usage);
  return { text: reply?.text ?? '', usage };
}
