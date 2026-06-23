const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendError } = require('../utils/apiResponse');
const { getJwtSecret } = require('../utils/authToken');

const allowDevAuthFallback = () =>
  process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH_FALLBACK === 'true';

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    // Get token from header
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    // Graceful development/local testing fallback so the admin dashboard doesn't get blocked by 401
    if (allowDevAuthFallback()) {
      try {
        const adminUser = await User.findOne({ role: 'admin' });
        if (adminUser) {
          req.user = adminUser;
          return next();
        }
      } catch (e) {
        console.log('Admin find error, using mock...');
      }
      req.user = {
        _id: '507f1f77bcf86cd799439011',
        role: 'admin',
        name: 'Dev Admin',
        email: 'admin@zaffabit.com',
      };
      return next();
    }
    return sendError(res, 401, 'Please log in to access this resource', 'UNAUTHORIZED');
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, getJwtSecret());

    // Attach user to request
    req.user = await User.findById(decoded.id);

    if (!req.user) {
      return sendError(
        res,
        401,
        'User associated with this token no longer exists',
        'UNAUTHORIZED',
      );
    }

    if (req.user.isBlocked) {
      return sendError(
        res,
        403,
        'Your account has been blocked by the administrator',
        'ACCOUNT_BLOCKED',
      );
    }

    next();
  } catch (err) {
    console.error('Auth Error:', err);
    // Graceful invalid token fallback in dev
    if (allowDevAuthFallback()) {
      req.user = {
        _id: '507f1f77bcf86cd799439011',
        role: 'admin',
        name: 'Dev Admin',
        email: 'admin@zaffabit.com',
      };
      return next();
    }
    return sendError(res, 401, 'Invalid or expired token', 'UNAUTHORIZED');
  }
};

module.exports = protect;
