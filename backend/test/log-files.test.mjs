// Tests for lib/log-files.js — the owner-only log-access backing logic.
// Focus: the path-traversal guard (security-critical) + listing/tail behaviour.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveLogFile,
  listLogFiles,
  tailFile,
  logDir,
} from '../src/lib/log-files.js';

let dir;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logtest-'));
  await fs.writeFile(path.join(dir, 'error.2026-06-17.1.log'), 'l1\nl2\nl3\n');
  await fs.writeFile(path.join(dir, 'app.2026-06-17.1.log'), 'a1\n');
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveLogFile path-traversal guard', () => {
  it('resolves a plain basename inside the dir', () => {
    const p = resolveLogFile(dir, 'error.2026-06-17.1.log');
    expect(p).toBe(path.resolve(dir, 'error.2026-06-17.1.log'));
  });

  it('rejects parent-directory traversal', () => {
    expect(() => resolveLogFile(dir, '../../etc/passwd')).toThrow();
    try { resolveLogFile(dir, '../secret.log'); } catch (e) { expect(e.code).toBe('BAD_NAME'); }
  });

  it('rejects absolute paths', () => {
    expect(() => resolveLogFile(dir, '/etc/passwd')).toThrow();
  });

  it('rejects subdirectory and separator forms', () => {
    expect(() => resolveLogFile(dir, 'sub/app.log')).toThrow();
    expect(() => resolveLogFile(dir, 'a\\b.log')).toThrow();
  });

  it('rejects empty / non-string / null-byte names', () => {
    expect(() => resolveLogFile(dir, '')).toThrow();
    expect(() => resolveLogFile(dir, undefined)).toThrow();
    expect(() => resolveLogFile(dir, 'a\0.log')).toThrow();
  });

  it('throws NO_LOG_DIR when dir is unset', () => {
    try { resolveLogFile(null, 'x.log'); } catch (e) { expect(e.code).toBe('NO_LOG_DIR'); }
  });
});

describe('listLogFiles', () => {
  it('lists .log files newest-first with size + mtime', async () => {
    const files = await listLogFiles(dir);
    expect(files.length).toBe(2);
    expect(files.every((f) => f.name.endsWith('.log'))).toBe(true);
    expect(files.every((f) => typeof f.sizeBytes === 'number')).toBe(true);
    expect(files.every((f) => typeof f.modified === 'string')).toBe(true);
  });

  it('returns [] for an unset dir or a missing dir', async () => {
    expect(await listLogFiles(null)).toEqual([]);
    expect(await listLogFiles(path.join(dir, 'does-not-exist'))).toEqual([]);
  });
});

describe('tailFile', () => {
  it('returns the last N lines without trailing blank', async () => {
    const lines = await tailFile(path.resolve(dir, 'error.2026-06-17.1.log'), 2);
    expect(lines).toEqual(['l2', 'l3']);
  });

  it('returns all lines when N exceeds file length', async () => {
    const lines = await tailFile(path.resolve(dir, 'error.2026-06-17.1.log'), 100);
    expect(lines).toEqual(['l1', 'l2', 'l3']);
  });
});

describe('logDir', () => {
  it('reads LOG_DIR from the passed env, null when unset', () => {
    expect(logDir({ LOG_DIR: '/data/logs' })).toBe('/data/logs');
    expect(logDir({})).toBe(null);
  });
});
