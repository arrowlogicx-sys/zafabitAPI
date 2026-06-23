/**
 * Standard API Response Structure
 * {
 *   "success": true,
 *   "message": "Request successful",
 *   "data": {},
 *   "error": null,
 *   "meta": {
 *     "requestId": "abc-123",
 *     "timestamp": "2026-03-25T10:00:00Z"
 *   }
 * }
 */

const { v4: uuidv4 } = require('uuid');
const { translateMessage } = require('./locales');

const sendResponse = (res, statusCode, message, data = null, meta = {}) => {
  // Extract locale from the incoming request headers
  const locale = res.req && res.req.headers ? res.req.headers.locale : 'en';

  const defaultMessage = statusCode < 400 ? 'Request successful' : 'Request failed';
  const finalMessage = message || defaultMessage;
  const translatedMessage = translateMessage(finalMessage, locale);

  const response = {
    success: statusCode < 400,
    message: translatedMessage,
    data: data,
    error: null,
    meta: {
      requestId: meta.requestId || uuidv4(),
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };

  return res.status(statusCode).json(response);
};

const sendError = (res, statusCode, message, errorCode, details = [], meta = {}) => {
  // Extract locale from the incoming request headers
  const locale = res.req && res.req.headers ? res.req.headers.locale : 'en';

  const defaultMessage = message || 'An error occurred';
  const defaultErrorDesc = message || 'Internal Server Error';

  const translatedMessage = translateMessage(defaultMessage, locale);
  const translatedErrorDesc = translateMessage(defaultErrorDesc, locale);

  const response = {
    success: false,
    message: translatedMessage,
    data: null,
    error: {
      code: errorCode || 'INTERNAL_ERROR',
      message: translatedErrorDesc,
      details: details,
    },
    meta: {
      requestId: meta.requestId || uuidv4(),
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };

  return res.status(statusCode).json(response);
};

module.exports = { sendResponse, sendError };
