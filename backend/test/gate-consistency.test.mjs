// Every route gate must name a key its own MOUNT admits.
//
// The permission model has two layers that have to agree: sectionLock decides
// whether a request may reach a mount at all, and the route's own gate decides
// the specific endpoint. When they name different keys the result is not a
// louder refusal, it is a gate NOBODY CAN PASS — the route reads as if it
// works and the mount refuses everyone the route was written for. Two of those
// existed when this test was written:
//
//   /leads/export.csv required data.export while the /leads mount admitted
//     only crm.view and finance.view — so the ANALYST, the entire reason
//     data.export exists, was refused before the route could allow them.
//   /analytics routes required finance.edit / valuation.edit while the mount
//     admitted only the matching .view keys — so anyone granted the edit
//     right without the view right was locked out of it.
//
// Neither showed up as a failing test, because each half was correct on its
// own. This checks the JOIN, which is where the mistake lives.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SECTIONS, OPEN, UNLISTED_BY_DESIGN,
} from '../src/middleware/section-lock.js';
import { PERMISSION_CATALOG } from '../src/lib/permissions.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const app = readFileSync(join(SRC, 'app.js'), 'utf8');

// Mount prefix -> route file, read from app.js so a new mount is picked up
// without anyone remembering to add it here.
function mounts() {
  const byId = new Map();
  for (const m of app.matchAll(/import \* as ([A-Za-z0-9_]+)_1 from "\.\/routes\/([^"]+)"/g)) {
    byId.set(m[1], m[2]);
  }
  for (const m of app.matchAll(/import ([A-Za-z0-9_]+) from ['"]\.\/routes\/([^'"]+)['"]/g)) {
    byId.set(m[1], m[2]);
  }
  const out = [];
  for (const m of app.matchAll(/api\.use\(\s*['"]([^'"]+)['"]\s*,([^;]*?)\);/gs)) {
    const ids = [...m[2].matchAll(/([A-Za-z0-9_]+)_1\.default|\b([A-Za-z0-9_]+)\.default/g)];
    const last = ids.at(-1);
    const file = last && byId.get(last[1] ?? last[2]);
    if (file) out.push({ prefix: m[1], file });
  }
  return out;
}

function keysUsedIn(file) {
  const src = readFileSync(join(SRC, 'routes', file), 'utf8');
  const used = new Set();
  for (const m of src.matchAll(/requirePermission\)?\(\s*'([^']+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/requireAnyPermission\)?\(([^)]*)\)/g)) {
    for (const k of m[1].matchAll(/'([^']+)'/g)) used.add(k[1]);
  }
  return [...used];
}

const admitsFor = (prefix) => SECTIONS
  .filter((r) => prefix === r.prefix || prefix.startsWith(r.prefix + '/'))
  .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.keys ?? null;

const isUnlisted = (prefix) => Object.keys(UNLISTED_BY_DESIGN)
  .some((u) => prefix === u || prefix.startsWith(u + '/'));

describe('route gates and section locks agree', () => {
  it('finds the mounts (guards against the parser silently matching nothing)', () => {
    expect(mounts().length).toBeGreaterThan(20);
  });

  it('no route requires a key its own mount refuses', () => {
    const dead = [];
    for (const { prefix, file } of mounts()) {
      const admits = admitsFor(prefix);
      if (!admits) continue;
      for (const key of keysUsedIn(file)) {
        if (!admits.includes(key)) dead.push(`${prefix} (${file}) needs ${key}; mount admits ${admits.join(', ')}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('every key a route names is a real catalog key', () => {
    const unknown = [];
    for (const { prefix, file } of mounts()) {
      for (const key of keysUsedIn(file)) {
        if (!(key in PERMISSION_CATALOG)) unknown.push(`${prefix} (${file}): ${key}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('every key a section lock names is a real catalog key', () => {
    const unknown = [];
    for (const rule of SECTIONS) {
      for (const key of rule.keys) {
        if (!(key in PERMISSION_CATALOG)) unknown.push(`${rule.prefix}: ${key}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  // A role list cannot express what the matrix grants, so a mount that is
  // locked must not also be answering by role underneath — that combination is
  // what produced "the nav says yes and the API says Insufficient permissions".
  // Three routers keep a role gate on purpose and are named here.
  const ROLE_GATE_BY_DESIGN = {
    'permissions.routes.js':
      'Editing the matrix must not be delegable — granting permissions.manage to yourself would be the escalation the ceiling exists to stop.',
    'logs.routes.js':
      'Agency-actor only; process-wide log files carry every tenant\'s data.',
  };

  it('no locked mount answers by role underneath', () => {
    const offenders = [];
    for (const { prefix, file } of mounts()) {
      if (ROLE_GATE_BY_DESIGN[file] || isUnlisted(prefix)) continue;
      const src = readFileSync(join(SRC, 'routes', file), 'utf8');
      const gates = [...src.matchAll(/requireRole\)?\(\s*'/g)];
      if (gates.length) offenders.push(`${prefix} (${file}): ${gates.length}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the role-gate exemptions are real files, so the list cannot rot', () => {
    const files = new Set(mounts().map((m) => m.file));
    for (const f of Object.keys(ROLE_GATE_BY_DESIGN)) expect(files.has(f), f).toBe(true);
  });
});
