// ============================================================================
// Logs controller — owner-only access to the on-disk log files (LOG_DIR).
// No business logic; delegates to lib/log-files.js. Mounted owner-gated at
// /api/admin/logs (see app.js).
// ============================================================================
import * as fs_1 from "node:fs";
import {
  logDir,
  listLogFiles,
  resolveLogFile,
  tailFile,
} from "../lib/log-files.js";

const fs = fs_1.default ?? fs_1;

export const logsController = {
  // GET /api/admin/logs — list available log files + whether file logging is on.
  async list(_req, res) {
    const dir = logDir();
    const files = await listLogFiles(dir);
    res.json({
      enabled: Boolean(dir),
      directory: dir,
      files,
    });
  },

  // GET /api/admin/logs/tail?file=error.2026-06-17.1.log&lines=200
  async tail(req, res) {
    const dir = logDir();
    let abs;
    try {
      abs = resolveLogFile(dir, req.query.file);
    } catch (err) {
      const status = err.code === 'NO_LOG_DIR' ? 409 : 400;
      return res.status(status).json({ error: err.message });
    }
    try {
      const lines = await tailFile(abs, req.query.lines);
      res.json({ file: req.query.file, lines });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Log file not found' });
      throw err;
    }
  },

  // GET /api/admin/logs/download?file=error.2026-06-17.1.log — raw file stream.
  async download(req, res) {
    const dir = logDir();
    let abs;
    try {
      abs = resolveLogFile(dir, req.query.file);
    } catch (err) {
      const status = err.code === 'NO_LOG_DIR' ? 409 : 400;
      return res.status(status).json({ error: err.message });
    }
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: 'Log file not found' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.query.file}"`);
    const stream = fs.createReadStream(abs);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  },
};
