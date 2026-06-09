// backend/src/lib/ai/index.js
// ============================================================================
// AI provider factory. Reads AI_PROVIDER (default 'anthropic') and AI_MODEL
// (default 'claude-sonnet-4-6'). Returns an object honouring provider.interface.
// ============================================================================
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createOpenRouterProvider } from "./providers/openrouter.js";
import { createGeminiProvider } from "./providers/gemini.js";

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function getProvider() {
  const provider = process.env.AI_PROVIDER || 'anthropic';
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  let primary;
  if (provider === 'anthropic') {
    primary = createAnthropicProvider({ model });
  } else if (provider === 'openrouter') {
    primary = createOpenRouterProvider({ model });
  } else if (provider === 'gemini') {
    primary = createGeminiProvider({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
  } else {
    throw new Error(`unknown AI_PROVIDER: ${provider}`);
  }

  // Fallback Wrapper: if primary is not gemini, and GEMINI_API_KEY is defined,
  // return a wrapper that delegates to Gemini if primary fails (or lacks keys).
  if (provider !== 'gemini' && process.env.GEMINI_API_KEY) {
    const fallback = createGeminiProvider({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
    return {
      name: `${primary.name}-with-fallback`,
      model: primary.model,
      async chat(args) {
        // Check if primary key is missing to fail fast
        const primaryKeyEnv = primary.name === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY';
        if (!process.env[primaryKeyEnv]) {
          console.warn(`Primary AI provider (${primary.name}) key ${primaryKeyEnv} is missing, falling back to ${fallback.name}`);
          return await fallback.chat(args);
        }

        try {
          return await primary.chat(args);
        } catch (err) {
          console.warn(`Primary AI provider (${primary.name}) failed, falling back to ${fallback.name}:`, err.message);
          return await fallback.chat(args);
        }
      }
    };
  }

  return primary;
}
