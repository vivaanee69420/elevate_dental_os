/**
 * BullMQ job queue, backed by Redis.
 */
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue('elevate-jobs', { connection });

// Worker bootstrap — register processors here as you build them
function startWorker() {
  return new Worker('elevate-jobs', async job => {
    switch (job.name) {
      case 'dentally-normalize':
        return require('../connectors/dentally/processor')(job.data);
      case 'xero-normalize':
        return require('../connectors/xero/processor')(job.data);
      case 'qbo-normalize':
        return require('../connectors/quickbooks/processor')(job.data);
      case 'ghl-normalize':
        return require('../connectors/ghl/processor')(job.data);
      case 'stripe-normalize':
        return require('../connectors/stripe/processor')(job.data);
      case 'reconciliation-run':
        return require('../reconciliation/runner')(job.data);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }, { connection });
}

module.exports = queue;
module.exports.startWorker = startWorker;
