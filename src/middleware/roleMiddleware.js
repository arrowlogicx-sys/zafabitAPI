const { sendError } = require('../utils/apiResponse');

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return sendError(
        res,
        403,
        `User role ${req.user ? req.user.role : 'none'} is not authorized to access this resource`,
        'FORBIDDEN',
      );
    }
    next();
  };
};

module.exports = { restrictTo };
