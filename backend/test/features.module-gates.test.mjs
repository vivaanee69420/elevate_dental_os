// Phase A3 — module keys enforced at the route mount, not just hidden in nav.
//
// Only mounts consumed by EXACTLY ONE nav section are gated. Anything an
// always-on Overview page also reads (/analytics, /growth, /wealth, /health,
// /leads, /treatments, /tasks, /integrations, /practices, /finance/quickbooks,
// /ad-attribution) must stay ungated: gating it would break the Overview
// section, which has no module key by design.
import { describe, it, expect } from 'vitest';

const { buildApp } = await import('../src/app.js');
const { requireFeature } = await import('../src/middleware/features.js');

// Mount path -> module key expected on that mount.
const GATED = {
  contacts: 'crm',
  comms: 'crm',
  workflows: 'crm',
  templates: 'crm',       // /crm/templates
  settings: 'crm',        // /crm/settings
  appointments: 'operations',
  'chair-utilisation': 'operations',
  associates: 'operations',
  staff: 'operations',
  'pay-runs': 'operations',
  payments: 'finance',
  'monthly-financials': 'finance',
  training: 'training',
  imports: 'system',
  marketing: 'marketing',
};

// Mounts that MUST NOT carry a module gate (shared with Overview or infra).
const UNGATED = ['analytics', 'growth', 'wealth', 'health', 'leads', 'treatments',
  'tasks', 'integrations', 'practices', 'cockpit', 'debt', 'notifications'];

// Collect { mountRegexpSource -> [featureKey…] } from the built app.
function gatesByMount() {
  const app = buildApp();
  const out = [];
  for (const layer of app._router.stack) {
    const inner = layer.handle?.stack;
    if (!Array.isArray(inner)) continue;
    for (const l of inner) {
      const key = l.handle?.featureKey;
      if (key) out.push({ path: l.regexp?.toString() ?? '', key });
    }
  }
  return out;
}

describe('module route gates', () => {
  const gates = gatesByMount();

  for (const [mount, key] of Object.entries(GATED)) {
    it(`/${mount} is gated on ${key}`, () => {
      const hit = gates.find((g) => g.path.includes(mount) && g.key === key);
      expect(hit, `expected a requireFeature('${key}') on /${mount}`).toBeTruthy();
    });
  }

  for (const mount of UNGATED) {
    it(`/${mount} carries NO module gate (shared with Overview or infra)`, () => {
      const hit = gates.find((g) => g.path.includes(mount));
      expect(hit, `/${mount} must not be module-gated: ${hit?.key}`).toBeFalsy();
    });
  }

  it('every gate key is a real catalog key', () => {
    for (const g of gates) expect(() => requireFeature(g.key)).not.toThrow();
  });
});
