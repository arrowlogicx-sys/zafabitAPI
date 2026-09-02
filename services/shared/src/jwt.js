const jwt = require('jsonwebtoken');

const DEVELOPMENT_JWT_SECRET = 'zafabit_dev_jwt_secret';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return DEVELOPMENT_JWT_SECRET;
};

// Maid sessions expire at the next IST midnight — partners re-auth once a day.
const getNextIstMidnight = (now = new Date()) => {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error('A valid date is required to calculate maid token expiry');
  }
  const shifted = new Date(nowMs + IST_OFFSET_MS);
  const nextMidnightMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return new Date(nextMidnightMs - IST_OFFSET_MS);
};

const generateToken = (id, role, options = {}) => {
  const secret = getJwtSecret();
  if (role === 'maid') {
    const expiresAt = getNextIstMidnight(options.now);
    return jwt.sign({ id, role, exp: Math.floor(expiresAt.getTime() / 1000) }, secret);
  }
  const claims = { id, role };
  if (options.phone) claims.phone = options.phone;
  return jwt.sign(claims, secret, { expiresIn: process.env.JWT_EXPIRE || '30d' });
};

const verifyToken = (token) => jwt.verify(token, getJwtSecret());

module.exports = { getJwtSecret, generateToken, verifyToken, getNextIstMidnight };
