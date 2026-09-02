const helmet = require('helmet');
const cors = require('cors');

const parseOrigins = () =>
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

// helmet headers + a CORS allowlist (wide-open only when CORS_ORIGINS is unset,
// i.e. local dev). The JSON body cap is applied by each service right after,
// since `express` belongs to the service, not this package.
const applySecurity = (app) => {
  const origins = parseOrigins();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: origins.length ? origins : true, credentials: true }));
};

module.exports = { applySecurity };
