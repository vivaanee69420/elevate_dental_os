// ============================================================================
// Logger factory (native ESM).
//
// Single source for the pino logger used by pino-http (see app.js) and the
// crash handlers (server.js). Three modes, chosen by env:
//
//   LOG_DIR set            -> multistream: stdout + app.<date>.<n>.log (all
//                             levels) + error.<date>.<n>.log (level>=error).
//                             Files rotate daily and auto-prune to a retention
//                             window. Point LOG_DIR at a Railway Volume mount
//                             (e.g. /data/logs) so the files survive restarts.
//   NODE_ENV=development    -> pretty stdout (pino-pretty).
//   otherwise (prod, no     -> plain JSON to stdout (Railway captures it). No
//   LOG_DIR)                   data-loss surprise on an ephemeral filesystem.
//
// Retention is controlled by LOG_RETAIN_APP_DAYS (default 14) and
// LOG_RETAIN_ERROR_DAYS (default 30). pino-roll's limit.count keeps N rotated
// files IN ADDITION to the active one.
// ============================================================================
import * as pino_1 from "pino";

const pino = pino_1.default;

// Redaction paths preserved from the original pino-http config. Applied on the
// base logger so every stream (stdout + files) gets scrubbed secrets.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
];

function rollStream(file, level, retainDays) {
  return {
    level,
    stream: pino.transport({
      target: 'pino-roll',
      options: {
        file,
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        extension: '.log',
        mkdir: true,
        limit: { count: retainDays },
      },
    }),
  };
}

export function createLogger(env = process.env) {
  const level = env.LOG_LEVEL || 'info';
  const redact = { paths: REDACT_PATHS, remove: false };
  const logDir = env.LOG_DIR;

  if (logDir) {
    const appDays = Number(env.LOG_RETAIN_APP_DAYS) || 14;
    const errDays = Number(env.LOG_RETAIN_ERROR_DAYS) || 30;
    const streams = [
      { level, stream: process.stdout },
      rollStream(`${logDir}/app`, level, appDays),
      rollStream(`${logDir}/error`, 'error', errDays),
    ];
    return pino({ level, redact }, pino.multistream(streams));
  }

  if (env.NODE_ENV === 'development') {
    return pino({ level, redact }, pino.transport({ target: 'pino-pretty' }));
  }

  return pino({ level, redact });
}

export const logger = createLogger();
