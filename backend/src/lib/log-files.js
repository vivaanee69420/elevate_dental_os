// ============================================================================
// Log-file access helpers (native ESM).
//
// Backing logic for the owner-only /api/admin/logs endpoints. Reads the files
// that lib/logger.js writes into LOG_DIR. Kept free of Express so the
// path-traversal guard (the security-critical bit) is unit-testable in
// isolation.
// ============================================================================
import { promises as fs } from "node:fs";
import * as path_1 from "node:path";

const path = path_1.default ?? path_1;

// Default tail window: read at most the last 512 KB of a file, then keep the
// last N lines. Bounds memory regardless of how large a rotated file grew.
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_TAIL_LINES = 200;

export function logDir(env = process.env) {
  return env.LOG_DIR || null;
}

// Resolve a user-supplied file NAME to an absolute path INSIDE dir, or throw.
// Rejects anything that is not a plain basename living directly in dir — this
// is the path-traversal boundary (no '..', no absolute paths, no subdirs).
export function resolveLogFile(dir, name) {
  if (!dir) {
    const err = new Error('Log directory not configured');
    err.code = 'NO_LOG_DIR';
    throw err;
  }
  if (typeof name !== 'string' || name.length === 0) {
    const err = new Error('Invalid log file name');
    err.code = 'BAD_NAME';
    throw err;
  }
  // A safe name equals its own basename and contains no path separators.
  if (name !== path.basename(name) || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    const err = new Error('Invalid log file name');
    err.code = 'BAD_NAME';
    throw err;
  }
  const resolved = path.resolve(dir, name);
  // Belt-and-braces: the resolved path's directory must be exactly dir.
  if (path.dirname(resolved) !== path.resolve(dir)) {
    const err = new Error('Invalid log file name');
    err.code = 'BAD_NAME';
    throw err;
  }
  return resolved;
}

// List every log file currently in dir, newest first. Returns [] if dir is
// unset or does not exist yet (no logs written).
export async function listLogFiles(dir) {
  if (!dir) return [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.log')) continue;
    const stat = await fs.stat(path.resolve(dir, e.name));
    files.push({ name: e.name, sizeBytes: stat.size, modified: stat.mtime.toISOString() });
  }
  files.sort((a, b) => b.modified.localeCompare(a.modified));
  return files;
}

// Read the last `lines` lines of `absPath`, scanning at most `maxBytes` from
// the end of the file.
export async function tailFile(absPath, lines = DEFAULT_TAIL_LINES, maxBytes = DEFAULT_MAX_BYTES) {
  const n = Math.max(1, Math.min(Number(lines) || DEFAULT_TAIL_LINES, 5000));
  const handle = await fs.open(absPath, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);
    let text = buf.toString('utf8');
    // If we started mid-file, drop the first (partial) line.
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl !== -1) text = text.slice(nl + 1);
    }
    const all = text.split('\n');
    if (all.length && all[all.length - 1] === '') all.pop();
    return all.slice(-n);
  } finally {
    await handle.close();
  }
}
