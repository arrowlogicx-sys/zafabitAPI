const { sendError } = require('./response');

const notFound = (req, res) =>
  sendError(res, 404, "We couldn't find what you were looking for.", 'NOT_FOUND');

// Final error handler. Nothing internal (stack, driver text, error message on a
// 500) ever reaches the client — it is logged via req.log instead. Known
// client-side failures (body parse, oversized, and anything a caller threw with
// `expose: true`) get their own friendly message.
//
// `opts.isMulterError(err)` lets a service fold its upload-library errors in
// without this package depending on multer.
const makeErrorHandler = (opts = {}) =>
  // eslint-disable-next-line no-unused-vars
  (err, req, res, next) => {
    const status = Number(err && err.status) || 500;

    if (opts.isMulterError && opts.isMulterError(err)) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return sendError(
        res,
        400,
        tooBig
          ? 'That file is too large. Please choose a smaller one.'
          : 'We could not process that file. Please try a different one.',
        'INVALID_UPLOAD',
      );
    }
    if (err && err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'The information sent was not in a format we could read.', 'INVALID_BODY');
    }
    if (err && (err.type === 'entity.too.large' || status === 413)) {
      return sendError(res, 413, 'That request is too large. Please reduce it and try again.', 'PAYLOAD_TOO_LARGE');
    }

    if (req && req.log) req.log.error({ err }, 'unhandled error');
    else console.error('unhandled error:', err);

    if (status >= 500) {
      return sendError(res, 500, 'Something went wrong on our end. Please try again in a moment.', 'INTERNAL_ERROR');
    }
    return sendError(
      res,
      status,
      err && err.expose && err.message ? err.message : 'We were unable to complete your request.',
      (err && err.code) || 'REQUEST_ERROR',
    );
  };

module.exports = { notFound, makeErrorHandler };
