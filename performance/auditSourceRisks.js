 
const fs = require('fs');
const path = require('path');
const { artifactsDir } = require('./config');

const root = path.resolve(__dirname, '..');
const adminRoot = path.resolve(root, '../zaffabit');
const read = (file) => fs.readFileSync(file, 'utf8');
const relative = (file) => path.relative(path.resolve(root, '..'), file);

const locate = (file, pattern) => {
  const lines = read(file).split('\n');
  const line = lines.findIndex((value) => pattern.test(value));
  return { file: relative(file), line: line >= 0 ? line + 1 : null };
};

const finding = (id, severity, title, evidence, recommendation) => ({
  id,
  severity,
  title,
  evidence,
  recommendation,
});

const main = () => {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const frontendMain = path.join(adminRoot, 'src/main.tsx');
  const backendApp = path.join(root, 'src/app.js');
  const adminController = path.join(root, 'src/controllers/adminController.js');
  const frontendText = read(frontendMain);
  const backendText = read(backendApp);
  const controllerText = read(adminController);
  const findings = [];

  if (/VITE_SENTRY_DSN\s*\|\|\s*["']https:\/\//.test(frontendText)) {
    findings.push(
      finding(
        'SENTRY_FRONTEND_DSN_FALLBACK',
        'high',
        'Frontend contains a hardcoded Sentry DSN fallback',
        locate(frontendMain, /VITE_SENTRY_DSN/),
        'Require VITE_SENTRY_DSN per environment and disable Sentry when it is absent.',
      ),
    );
  }
  if (/tracesSampleRate:\s*1(?:\.0)?/.test(frontendText)) {
    findings.push(
      finding(
        'SENTRY_FRONTEND_TRACE_100',
        'high',
        'Frontend captures 100% of performance traces',
        locate(frontendMain, /tracesSampleRate/),
        'Use environment-controlled sampling and a lower production default.',
      ),
    );
  }
  if (/tracesSampleRate:\s*1(?:\.0)?/.test(backendText)) {
    findings.push(
      finding(
        'SENTRY_BACKEND_TRACE_100',
        'high',
        'Backend captures 100% of performance traces',
        locate(backendApp, /tracesSampleRate/),
        'Use environment-controlled sampling and verify ingestion cost under load.',
      ),
    );
  }

  const queryRisks = [
    [
      'UNBOUNDED_WALLETS',
      /const users = await User\.find\(\{ role: 'customer' \}\)/,
      'Wallet endpoint loads every customer into one response',
    ],
    [
      'UNBOUNDED_EXPORT_USERS',
      /data = await User\.find\(\)\.select/,
      'User export materializes the complete collection in application memory',
    ],
    [
      'UNBOUNDED_EXPORT_BOOKINGS',
      /data = await Booking\.find\(\)\.populate/,
      'Booking export materializes and populates the complete collection',
    ],
    [
      'UNBOUNDED_PENDING_VERIFICATIONS',
      /const maids = await MaidProfile\.find\(\{ isIdentityVerified: false \}\)/,
      'Pending verifications endpoint has no page limit',
    ],
    [
      'UNBOUNDED_SETTLEMENTS',
      /const settlements = await Booking\.aggregate/,
      'Settlements aggregation has no response pagination',
    ],
  ];
  for (const [id, pattern, title] of queryRisks) {
    if (pattern.test(controllerText)) {
      findings.push(
        finding(
          id,
          'critical',
          title,
          locate(adminController, pattern),
          'Add bounded server-side pagination or an asynchronous export/aggregation workflow after this audit.',
        ),
      );
    }
  }

  const frontendRisks = [
    [
      'UI_BOOKING_KPI_1000',
      'src/views/BookingManagementView.tsx',
      /bookings\?limit=1000/,
      'Booking KPI is calculated from only the first 1,000 records',
    ],
    [
      'UI_TRANSACTIONS_1000',
      'src/views/TransactionsView.tsx',
      /payments\?limit=1000/,
      'Transactions screen requests 1,000 payment rows',
    ],
    [
      'UI_REFUNDS_1000',
      'src/views/RefundsView.tsx',
      /refunds\?limit=1000/,
      'Refunds screen requests 1,000 rows',
    ],
    [
      'UI_WALLETS_ALL',
      'src/views/WalletCreditsView.tsx',
      /admin\/wallets["']/,
      'Wallet screen depends on the unbounded wallet endpoint',
    ],
    [
      'UI_OPERATIONS_ALL_BOOKINGS',
      'src/views/OperationsCenterView.tsx',
      /api\/v1\/bookings["']/,
      'Operations screen requests bookings without explicit pagination',
    ],
  ];
  for (const [id, fileName, pattern, title] of frontendRisks) {
    const file = path.join(adminRoot, fileName);
    if (fs.existsSync(file) && pattern.test(read(file))) {
      findings.push(
        finding(
          id,
          id === 'UI_BOOKING_KPI_1000' ? 'high' : 'critical',
          title,
          locate(file, pattern),
          'Use server-calculated totals and bounded page requests; avoid client-side aggregation over large lists.',
        ),
      );
    }
  }

  const indexFiles = ['Booking.js', 'User.js', 'Payment.js'].map((name) =>
    path.join(root, 'src/models', name),
  );
  const declaredIndexes = indexFiles.flatMap((file) =>
    read(file)
      .split('\n')
      .map((line, index) => ({ file: relative(file), line: index + 1, definition: line.trim() }))
      .filter((entry) => /Schema\.index\(/.test(entry.definition)),
  );

  const result = {
    generatedAt: new Date().toISOString(),
    scope: 'Static admin performance and Sentry risk scan',
    counts: findings.reduce(
      (acc, item) => ({ ...acc, [item.severity]: (acc[item.severity] || 0) + 1 }),
      {},
    ),
    findings,
    declaredIndexes,
  };
  fs.writeFileSync(
    path.join(artifactsDir, 'source-risk-audit.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(`Source audit complete: ${findings.length} findings.`);
  return result;
};

if (require.main === module) main();
module.exports = { main };
