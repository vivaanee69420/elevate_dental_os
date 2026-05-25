/**
 * Validates required environment variables at boot.
 * Fail fast — don't run with a broken config.
 */
const REQUIRED = [
  'NODE_ENV',
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY'
];

const REQUIRED_PROD = [
  'BASE_URL',
  'ALLOWED_ORIGINS'
];

function validateEnv() {
  const missing = [];
  for (const key of REQUIRED) {
    if (!process.env[key]) missing.push(key);
  }
  if (process.env.NODE_ENV === 'production') {
    for (const key of REQUIRED_PROD) {
      if (!process.env[key]) missing.push(key);
    }
  }
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.JWT_SECRET.length < 32) {
    console.error('JWT_SECRET must be at least 32 characters');
    process.exit(1);
  }
}

module.exports = { validateEnv };
