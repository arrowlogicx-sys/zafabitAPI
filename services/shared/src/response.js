const { randomUUID } = require('crypto');

// The one response envelope, shared by every Zafabit service and the gateway:
//   { success, status, message, data, error?, meta: { requestId, timestamp } }
//
// `requestId` is taken from the request's log id (set by the pino-http logger
// from an inbound `x-request-id` or a fresh uuid) so the value the client sees
// matches every server log line for that request.
const requestIdOf = (res, meta) =>
  meta.requestId || (res && res.req && res.req.id) || randomUUID();

const sendResponse = (res, statusCode, message, data = null, meta = {}) => {
  res.status(statusCode).json({
    success: statusCode < 400,
    status: statusCode,
    message: message || (statusCode < 400 ? 'Request successful' : 'Request failed'),
    data,
    meta: {
      requestId: requestIdOf(res, meta),
      timestamp: new Date().toISOString(),
      ...meta,
    },
  });
};

const sendError = (res, statusCode, message, errorCode, details = [], meta = {}) => {
  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: message || 'An error occurred',
    data: null,
    error: {
      code: errorCode || 'INTERNAL_ERROR',
      message: message || 'Internal Server Error',
      details,
    },
    meta: {
      requestId: requestIdOf(res, meta),
      timestamp: new Date().toISOString(),
      ...meta,
    },
  });
};

module.exports = { sendResponse, sendError };
