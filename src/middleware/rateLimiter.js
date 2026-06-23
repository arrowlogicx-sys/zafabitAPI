const { sendError } = require('../utils/apiResponse');

const buckets = new Map();

const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getClientKey = (req) =>
  req.ip ||
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  req.socket?.remoteAddress ||
  'unknown';

const createRateLimiter = ({
  windowMs,
  max,
  keyPrefix = 'global',
  message = 'Too many requests. Please try again later.',
}) => {
  const resolvedWindowMs = toPositiveInteger(windowMs, 15 * 60 * 1000);
  const resolvedMax = toPositiveInteger(max, 300);

  return (req, res, next) => {
    if (process.env.RATE_LIMIT_ENABLED === 'false') {
      return next();
    }

    const now = Date.now();
    const key = `${keyPrefix}:${getClientKey(req)}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + resolvedWindowMs });
      res.setHeader('X-RateLimit-Limit', resolvedMax);
      res.setHeader('X-RateLimit-Remaining', resolvedMax - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + resolvedWindowMs) / 1000));
      return next();
    }

    current.count += 1;
    const remaining = Math.max(resolvedMax - current.count, 0);
    res.setHeader('X-RateLimit-Limit', resolvedMax);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(current.resetAt / 1000));

    if (current.count > resolvedMax) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      return sendError(res, 429, message, 'RATE_LIMIT_EXCEEDED');
    }

    return next();
  };
};

const apiRateLimiter = createRateLimiter({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS,
  max: process.env.RATE_LIMIT_MAX_REQUESTS,
  keyPrefix: 'api',
});

const authRateLimiter = createRateLimiter({
  windowMs: process.env.AUTH_RATE_LIMIT_WINDOW_MS || process.env.RATE_LIMIT_WINDOW_MS,
  max: process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || 20,
  keyPrefix: 'auth',
  message: 'Too many authentication attempts. Please try again later.',
});

module.exports = {
  apiRateLimiter,
  authRateLimiter,
  createRateLimiter,
};
