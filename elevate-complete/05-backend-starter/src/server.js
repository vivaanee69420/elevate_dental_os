/**
 * Elevate Dental OS · API entrypoint
 *
 * Boots Express, wires middleware, mounts routes, starts background jobs.
 */
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const { validateEnv } = require('./config/env');
const { pool } = require('./config/db');
const { redis } = require('./config/redis');
const logger = require('./lib/logger');
const routes = require('./routes');
const startSchedulers = require('./jobs/schedulers');

validateEnv();  // throws on missing required vars

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
}));

// CORS
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  credentials: true
}));

// Cookies + structured logging + request IDs
app.use(cookieParser());
app.use(pinoHttp({ logger }));

// Per-user rate limit (600/min)
app.use(rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path.startsWith('/webhooks/')  // webhooks have their own auth
}));

// JSON for everything except webhook routes (those need raw body for signature verify)
app.use((req, res, next) => {
  if (req.path.startsWith('/v1/webhooks/')) return next();
  return express.json({ limit: '2mb' })(req, res, next);
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ ok: true, version: '1.1.0' });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Mount routes
app.use('/v1', routes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
});

// Error handler
app.use((err, req, res, _next) => {
  req.log?.error({ err }, 'unhandled');
  const status = err.status || 500;
  res.status(status).json({
    error: {
      code: err.code || 'internal_error',
      message: status === 500 ? 'Internal server error' : err.message,
      request_id: req.id
    }
  });
});

const port = parseInt(process.env.PORT || '4000', 10);
const server = app.listen(port, () => {
  logger.info({ port }, 'Elevate API listening');
  startSchedulers();
});

// Graceful shutdown
function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    pool.end();
    redis.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
