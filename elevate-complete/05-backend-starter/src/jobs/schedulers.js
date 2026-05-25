/**
 * Cron schedulers — kick off recurring sync + reconciliation jobs.
 * See QUICKSTART_FOR_DEVELOPER.md for cadence rationale.
 */
const cron = require('node-cron');
const queue = require('./queue');
const logger = require('../lib/logger');

function startSchedulers() {
  if (process.env.NODE_ENV === 'test') return;

  // Every 15 minutes: Dentally today + GHL delta
  cron.schedule('*/15 * * * *', () => {
    queue.add('dentally-sync-today', {});
    queue.add('ghl-sync-delta', {});
  });

  // Every hour: bank balances + reconciliation triggers
  cron.schedule('0 * * * *', () => {
    queue.add('xero-bank-refresh', {});
  });

  // Nightly 02:00: full delta sync + daily reconciliation
  cron.schedule('0 2 * * *', () => {
    queue.add('dentally-sync-rolling-90d', {});
    queue.add('xero-sync-delta', {});
    queue.add('qbo-sync-delta', {});
    queue.add('reconciliation-run', { control: 'cash_received' });
    queue.add('reconciliation-run', { control: 'treatment_starts' });
  });

  // Weekly Sunday 02:30: revenue + aged debt reconciliation
  cron.schedule('30 2 * * 0', () => {
    queue.add('reconciliation-run', { control: 'revenue_by_practice' });
    queue.add('reconciliation-run', { control: 'aged_debt' });
  });

  // Monthly on 1st at 05:00: close-prior-month
  cron.schedule('0 5 1 * *', () => {
    queue.add('xero-monthly-reports', {});
    queue.add('reconciliation-run', { control: 'entity_totals' });
  });

  // Daily 04:00: token rotation
  cron.schedule('0 4 * * *', () => {
    queue.add('rotate-expiring-tokens', {});
  });

  logger.info('Schedulers started');

  // Boot the worker process (in-process for dev; separate container in prod)
  if (process.env.NODE_ENV !== 'production' || process.env.RUN_WORKER === 'true') {
    queue.startWorker();
    logger.info('Worker started');
  }
}

module.exports = startSchedulers;
