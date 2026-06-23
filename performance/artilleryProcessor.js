const ensureEnvironment = (context, _ee, next) => {
  const missing = ['PERF_ADMIN_EMAIL', 'PERF_ADMIN_PASSWORD'].filter((name) => !process.env[name]);
  if (missing.length) {
    return next(new Error(`Missing required performance variables: ${missing.join(', ')}`));
  }
  context.vars.adminEmail = process.env.PERF_ADMIN_EMAIL;
  context.vars.adminPassword = process.env.PERF_ADMIN_PASSWORD;
  return next();
};

const validateLogin = (requestParams, response, context, ee, next) => {
  if (response.statusCode !== 200 || !context.vars.token) {
    ee.emit('counter', 'audit.login_failed', 1);
    return next(new Error(`Admin login failed with HTTP ${response.statusCode}`));
  }
  return next();
};

module.exports = { ensureEnvironment, validateLogin };
