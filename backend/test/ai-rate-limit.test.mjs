// backend/test/ai-rate-limit.test.mjs
import { describe, it, expect } from 'vitest';
import router from '../src/routes/p4g-ai.routes.js';

describe('p4g-ai router', () => {
  it('mounts POST /chat with two handlers (limiter + controller)', () => {
    const layer = router.stack.find((l) => l.route && l.route.path === '/chat');
    expect(layer).toBeTruthy();
    expect(layer.route.stack.length).toBeGreaterThanOrEqual(2); // limiter + asyncHandler
  });
});
