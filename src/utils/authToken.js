const jwt = require('jsonwebtoken');

const DEVELOPMENT_JWT_SECRET = 'zaffabit_jwt_secret';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }

  return DEVELOPMENT_JWT_SECRET;
};

const getNextIstMidnight = (now = new Date()) => {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error('A valid date is required to calculate maid token expiry');
  }

  const shiftedNow = new Date(nowMs + IST_OFFSET_MS);
  const nextMidnightShiftedMs = Date.UTC(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth(),
    shiftedNow.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );

  return new Date(nextMidnightShiftedMs - IST_OFFSET_MS);
};

const generateToken = (id, role, options = {}) => {
  const secret = getJwtSecret();

  if (role === 'maid') {
    const expiresAt = getNextIstMidnight(options.now);
    return jwt.sign(
      {
        id,
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      secret,
    );
  }

  return jwt.sign({ id }, secret, {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

module.exports = {
  generateToken,
  getJwtSecret,
  getNextIstMidnight,
};
