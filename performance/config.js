const path = require('path');

const PERFORMANCE_DB_PATTERN = /(perf|performance|load[-_]?test|benchmark)/i;

const integerEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

const getDatabaseName = (uri) => {
  try {
    return decodeURIComponent(new URL(uri).pathname.replace(/^\//, '').split('?')[0]);
  } catch (_error) {
    return '';
  }
};

const assertSafePerformanceDatabase = (uri, action) => {
  if (!uri) {
    throw new Error('PERF_MONGODB_URI is required.');
  }

  const databaseName = getDatabaseName(uri);
  if (!databaseName || !PERFORMANCE_DB_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to ${action}: database name "${databaseName || '<missing>'}" must contain perf, performance, loadtest, or benchmark.`,
    );
  }

  if (process.env.PERF_ALLOW_SEED !== 'true') {
    throw new Error(
      `Refusing to ${action}: set PERF_ALLOW_SEED=true for the dedicated performance database.`,
    );
  }

  return databaseName;
};

const profile = {
  customers: integerEnv('PERF_CUSTOMERS', 200_000),
  maids: integerEnv('PERF_MAIDS', 20_000),
  bookings: integerEnv('PERF_BOOKINGS', 1_000_000),
  payments: integerEnv('PERF_PAYMENTS', 800_000),
  reviews: integerEnv('PERF_REVIEWS', 300_000),
  notifications: integerEnv('PERF_NOTIFICATIONS', 200_000),
  activityLogs: integerEnv('PERF_ACTIVITY_LOGS', 1_000_000),
  batchSize: Math.max(100, integerEnv('PERF_BATCH_SIZE', 5_000)),
};

const artifactsDir = path.resolve(__dirname, '../artifacts/admin-performance');

const resolveChromeExecutable = () => {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((candidate) => require('fs').existsSync(candidate));
};

module.exports = {
  PERFORMANCE_DB_PATTERN,
  artifactsDir,
  assertSafePerformanceDatabase,
  getDatabaseName,
  integerEnv,
  profile,
  resolveChromeExecutable,
};
