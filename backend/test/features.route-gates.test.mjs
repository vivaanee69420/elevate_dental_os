// backend/test/features.route-gates.test.mjs
// Structural wiring tests: the internal route families must carry their
// requireFeature gate (featureKey hook). Walks the live router stacks.
import { describe, it, expect } from 'vitest';

const dataRoomRouter = (await import('../src/routes/data-room.routes.js')).default;
const callReportingRouter = (await import('../src/routes/call-reporting.routes.js')).default;
const integrationsRouter = (await import('../src/routes/integrations.routes.js')).default;

// Router-level gate: a .use() layer (no route) whose handle carries featureKey,
// registered before the first route layer.
function routerLevelGate(router) {
  for (const layer of router.stack) {
    if (layer.route) return null; // hit a route before any gate
    if (layer.handle?.featureKey) return layer.handle.featureKey;
  }
  return null;
}

// Per-route gates: for every route whose path matches `test`, every method
// handler chain must include a handle with the expected featureKey.
function ungatedRoutes(router, test, expectedKey) {
  const bad = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    if (!test(path)) continue;
    const keys = layer.route.stack.map((l) => l.handle?.featureKey).filter(Boolean);
    if (!keys.includes(expectedKey)) bad.push(path);
  }
  return bad;
}

describe('internal route families carry their feature gates', () => {
  it('data-room router is gated on data_room', () => {
    expect(routerLevelGate(dataRoomRouter)).toBe('data_room');
  });
  it('call-reporting router is gated on call_reporting', () => {
    expect(routerLevelGate(callReportingRouter)).toBe('call_reporting');
  });
  it('every /emergent* integrations route is gated on emergent', () => {
    expect(ungatedRoutes(integrationsRouter, (p) => p === '/emergent' || p.startsWith('/emergent/'), 'emergent')).toEqual([]);
  });
  it('every /google-sheets/* route is gated on call_reporting', () => {
    const routes = integrationsRouter.stack.filter((l) => l.route?.path.startsWith('/google-sheets/'));
    expect(routes.length).toBeGreaterThan(0);
    expect(ungatedRoutes(integrationsRouter, (p) => p.startsWith('/google-sheets/'), 'call_reporting')).toEqual([]);
  });
  it('every /google-sheets-writer/* route is gated on sheet_export', () => {
    const routes = integrationsRouter.stack.filter((l) => l.route?.path.startsWith('/google-sheets-writer/'));
    expect(routes.length).toBeGreaterThan(0);
    expect(ungatedRoutes(integrationsRouter, (p) => p.startsWith('/google-sheets-writer/'), 'sheet_export')).toEqual([]);
  });
});
