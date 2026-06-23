require('dotenv').config();
const Sentry = require('@sentry/node');

const sentryTraceSampleRate = (() => {
  const configured = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
  if (Number.isFinite(configured) && configured >= 0 && configured <= 1) return configured;
  return process.env.NODE_ENV === 'production' ? 0.1 : 1.0;
})();

// Initialize Sentry before Express app setup, only if DSN is configured
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    integrations: [Sentry.expressIntegration()],
    tracesSampleRate: sentryTraceSampleRate,
  });
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');
const { registerApiModules } = require('./modules');

const app = express();

// Standard Middlewares
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root Route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'zafabit Backend API is running',
    data: { version: '1.0.0' },
    meta: { timestamp: new Date().toISOString() },
  });
});

const path = require('path');

// Serve Static Files
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// API modules
registerApiModules(app);

// Error Handling
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}
app.use(errorHandler);

module.exports = app;
