describe('Sentry Express wiring', () => {
  const originalSentryDsn = process.env.SENTRY_DSN;
  const originalTraceRate = process.env.SENTRY_TRACES_SAMPLE_RATE;
  const originalSentryEnvironment = process.env.SENTRY_ENVIRONMENT;
  const originalSentryRelease = process.env.SENTRY_RELEASE;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    if (originalSentryDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalSentryDsn;
    }
    for (const [name, value] of [
      ['SENTRY_TRACES_SAMPLE_RATE', originalTraceRate],
      ['SENTRY_ENVIRONMENT', originalSentryEnvironment],
      ['SENTRY_RELEASE', originalSentryRelease],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const loadAppWithSentryDsn = (dsn) => {
    jest.resetModules();

    if (dsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = dsn;
    }

    const sentryMock = {
      init: jest.fn(),
      expressIntegration: jest.fn(() => 'expressIntegration'),
      setupExpressErrorHandler: jest.fn(),
    };

    jest.doMock('@sentry/node', () => sentryMock);

    const app = require('../app');

    return { app, sentryMock };
  };

  it('initializes Sentry and installs the Express error handler when SENTRY_DSN is set', () => {
    const { app, sentryMock } = loadAppWithSentryDsn('https://public@example.com/1');

    expect(sentryMock.expressIntegration).toHaveBeenCalledTimes(1);
    expect(sentryMock.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.com/1',
      environment: process.env.NODE_ENV || 'development',
      release: undefined,
      integrations: ['expressIntegration'],
      tracesSampleRate: 1.0,
    });
    expect(sentryMock.setupExpressErrorHandler).toHaveBeenCalledWith(app);
  });

  it('does not initialize Sentry when SENTRY_DSN is not set', () => {
    const { sentryMock } = loadAppWithSentryDsn(undefined);

    expect(sentryMock.expressIntegration).not.toHaveBeenCalled();
    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(sentryMock.setupExpressErrorHandler).not.toHaveBeenCalled();
  });

  it('uses configured environment, release, and trace sampling', () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.05';
    process.env.SENTRY_ENVIRONMENT = 'staging';
    process.env.SENTRY_RELEASE = 'api@test-release';
    const { sentryMock } = loadAppWithSentryDsn('https://public@example.com/1');

    expect(sentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'staging',
        release: 'api@test-release',
        tracesSampleRate: 0.05,
      }),
    );
  });
});
