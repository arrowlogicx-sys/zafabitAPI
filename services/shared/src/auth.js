const { verifyToken } = require('./jwt');
const { sendError } = require('./response');

// Stateless bearer-token guard — verifies the signature only, no DB round-trip.
// Tokens are minted by the auth service and carry `id`, `role` and (for
// customers/agents/admins) `phone`.
const protect = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return sendError(res, 401, 'Please sign in to continue.', 'NOT_AUTHENTICATED');
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.id, role: payload.role, phone: payload.phone || null };
    return next();
  } catch (err) {
    const expired = err && err.name === 'TokenExpiredError';
    return sendError(
      res,
      401,
      expired
        ? 'Your session has expired. Please sign in again.'
        : 'Your session is no longer valid. Please sign in again.',
      expired ? 'SESSION_EXPIRED' : 'INVALID_SESSION',
    );
  }
};

module.exports = { protect };
