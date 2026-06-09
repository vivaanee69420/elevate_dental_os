// backend/src/lib/ai/index.js
// ============================================================================
// AI provider factory. Reads AI_PROVIDER (default 'anthropic') and AI_MODEL
// (default 'claude-sonnet-4-6'). Returns an object honouring provider.interface.
// ============================================================================
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createOpenRouterProvider } from "./providers/openrouter.js";

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function getProvider() {
  const provider = process.env.AI_PROVIDER || 'anthropic';
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  if (provider === 'anthropic') return createAnthropicProvider({ model });
  if (provider === 'openrouter') return createOpenRouterProvider({ model });
  throw new Error(`unknown AI_PROVIDER: ${provider}`);
}
