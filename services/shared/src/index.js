const { sendResponse, sendError } = require('./response');
const { getJwtSecret, generateToken, verifyToken, getNextIstMidnight } = require('./jwt');
const { createLogger, httpLogger } = require('./logger');
const { applySecurity } = require('./security');
const { notFound, makeErrorHandler } = require('./error-handler');
const { protect } = require('./auth');
const { canonicalizePhone } = require('./phone');
const { validate, z, phone, otpCode, uuid, oneOf, shortText, PHONE_RE } = require('./validate');
const { loadEnv, port, bool, optionalString } = require('./env');
const { runPendingMigrations } = require('./db');

module.exports = {
  // response envelope
  sendResponse,
  sendError,
  // jwt
  getJwtSecret,
  generateToken,
  verifyToken,
  getNextIstMidnight,
  // logging
  createLogger,
  httpLogger,
  // http middleware
  applySecurity,
  notFound,
  makeErrorHandler,
  protect,
  // validation
  validate,
  z,
  schemas: { phone, otpCode, uuid, oneOf, shortText },
  PHONE_RE,
  canonicalizePhone,
  // env
  loadEnv,
  port,
  bool,
  optionalString,
  // db
  runPendingMigrations,
};
