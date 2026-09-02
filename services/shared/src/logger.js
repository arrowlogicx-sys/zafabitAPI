const { randomUUID } = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');

const isProd = () => process.env.NODE_ENV === 'production';

// Fields that must never reach the logs.
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-key"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.otp',
  'req.body.pushToken',
  'res.headers["set-cookie"]',
];

const createLogger = (name) =>
  pino({
    name,
    level: process.env.LOG_LEVEL || (isProd() ? 'info' : 'debug'),
    redact: { paths: REDACT, censor: '[redacted]' },
    ...(isProd()
      ? {}
      : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
  });

// Express middleware: one child logger per request on `req.log`, carrying a
// stable `req.id` (from an inbound x-request-id, else a fresh uuid) that is
// echoed back on the response header and used as the envelope's requestId.
// Slim request/response in the log line — method/url/status/duration, not the
// full header dump pino-http emits by default.
const serializers = {
  req: (req) => ({ id: req.id, method: req.method, url: req.url }),
  res: (res) => ({ statusCode: res.statusCode }),
};

const httpLogger = (name) =>
  pinoHttp({
    logger: createLogger(name),
    serializers,
    genReqId: (req, res) => {
      const inbound = req.headers['x-request-id'];
      const id = (typeof inbound === 'string' && inbound.trim()) || randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.originalUrl} ${res.statusCode}`,
    customErrorMessage: (req, res, err) => `${req.method} ${req.originalUrl} ${res.statusCode} ${err.message}`,
  });

module.exports = { createLogger, httpLogger };
