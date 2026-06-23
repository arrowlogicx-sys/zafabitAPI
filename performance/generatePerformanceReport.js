 
const fs = require('fs');
const path = require('path');
const { artifactsDir, profile, resolveChromeExecutable } = require('./config');

const load = (name) => {
  const file = path.join(artifactsDir, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return null;
  }
};
const formatMs = (value) =>
  Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : 'Not measured';
const metric = (report, name) =>
  report?.aggregate?.summaries?.[name] ||
  report?.aggregate?.summaries?.[`plugins.metrics-by-endpoint.${name}`];
const counter = (report, name) => Number(report?.aggregate?.counters?.[name] || 0);

const assessLoad = (report) => {
  if (!report)
    return { executed: false, passed: false, reason: 'Full 50-admin load test was not executed.' };
  const response = metric(report, 'http.response_time') || {};
  const requests = counter(report, 'http.requests');
  const errors = Object.entries(report.aggregate?.counters || {})
    .filter(([key]) => /errors\.|failed|codes\.5/i.test(key))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const errorRate = requests ? errors / requests : 1;
  return {
    executed: true,
    passed: errorRate < 0.01 && Number(response.p95) < 2000 && Number(response.p99) < 4000,
    requests,
    errors,
    errorRate,
    p50: response.median || response.p50,
    p95: response.p95,
    p99: response.p99,
    reason:
      errorRate >= 0.01
        ? 'Error rate exceeded 1%.'
        : Number(response.p95) >= 2000
          ? 'Overall p95 exceeded 2 seconds.'
          : Number(response.p99) >= 4000
            ? 'Overall p99 exceeded 4 seconds.'
            : 'Load thresholds passed.',
  };
};

const main = async () => {
  const { marked } = await import('marked');
  const puppeteer = (await import('puppeteer')).default;
  fs.mkdirSync(artifactsDir, { recursive: true });
  const functional = load('functional-results.json');
  const source = load('source-risk-audit.json');
  const seed = load('seed-manifest.json');
  const full = load('artillery-full.json');
  const warmup = load('artillery-warmup.json');
  const recovery = load('artillery-recovery.json');
  const browser = load('browser-metrics.json');
  const sentry = load('sentry-audit.json');
  const loadAssessment = assessLoad(full);
  const seedMatchesTarget = Boolean(
    seed &&
    seed.profile?.bookings === profile.bookings &&
    seed.profile?.customers === profile.customers &&
    seed.profile?.maids === profile.maids,
  );
  const measuredScreens = browser?.screens?.filter((screen) => screen.status === 'measured') || [];
  const browserPassed =
    browser?.status === 'measured' &&
    measuredScreens.every((screen) => Number(screen.usableMs) < 3000);
  const criticalFindings = source?.findings?.filter((item) => item.severity === 'critical') || [];
  const passed = Boolean(
    functional?.passed &&
    seedMatchesTarget &&
    loadAssessment.passed &&
    browserPassed &&
    sentry?.status === 'collected' &&
    criticalFindings.length === 0,
  );
  const verdict = passed ? 'PRODUCTION PERFORMANCE READY' : 'NOT PRODUCTION PERFORMANCE READY';
  const blockers = [];
  if (!functional?.passed) blockers.push('Functional tests or production build did not pass.');
  if (!seedMatchesTarget)
    blockers.push('The 10-lakh synthetic dataset was not seeded and verified.');
  if (!loadAssessment.executed)
    blockers.push('The required 50-admin, 30-minute sustained load test has not run.');
  else if (!loadAssessment.passed) blockers.push(loadAssessment.reason);
  if (!browserPassed)
    blockers.push(
      'Authenticated admin screens were not all measured below the 3-second usability threshold.',
    );
  if (sentry?.status !== 'collected')
    blockers.push('Live Sentry project validation was not completed.');
  for (const finding of criticalFindings) blockers.push(finding.title);

  const screenRows = measuredScreens.length
    ? measuredScreens
        .map(
          (screen) =>
            `| ${screen.label} | ${formatMs(screen.usableMs)} | ${screen.dom?.rows ?? '-'} | ${screen.jsHeapUsedBytes ? Math.round(screen.jsHeapUsedBytes / 1024 / 1024) + ' MB' : '-'} |`,
        )
        .join('\n')
    : '| Not executed | - | - | - |';
  const functionalRows =
    functional?.checks
      ?.map(
        (check) =>
          `| ${check.name} | ${check.passed ? 'PASS' : 'FAIL'} | ${formatMs(check.durationMs)} |`,
      )
      .join('\n') || '| Not executed | FAIL | - |';
  const findingRows =
    source?.findings
      ?.map(
        (item) =>
          `| ${item.severity.toUpperCase()} | ${item.title} | ${item.evidence.file}:${item.evidence.line || '-'} | ${item.recommendation} |`,
      )
      .join('\n') || '| - | No static findings recorded | - | - |';
  const blockerRows = blockers.length
    ? blockers.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : 'None.';
  const generatedAt = new Date().toISOString();

  const markdown =
    `# Zaffabit Admin Panel Production Performance Audit\n\n` +
    `**Verdict: ${verdict}**\n\nGenerated: ${generatedAt}\n\n` +
    `## Executive Summary\n\nThe admin panel is certified only when functional checks, the dedicated 10-lakh dataset, the 50-admin sustained load test, browser measurements, Sentry validation, and static scalability checks all pass. Missing evidence is treated as a failed production gate.\n\n` +
    `### Blocking Items\n\n${blockerRows}\n\n` +
    `## Audit Target and Evidence\n\n- Target profile: ${profile.bookings.toLocaleString('en-IN')} bookings, ${profile.customers.toLocaleString('en-IN')} customers, and ${profile.maids.toLocaleString('en-IN')} maids.\n- Seed evidence: ${seedMatchesTarget ? `completed for dedicated database ${seed.databaseName}` : seed ? 'only a reduced harness dataset was recorded; certification dataset is not available' : 'not available'}.\n- Warm-up: ${warmup ? 'executed' : 'not executed'}.\n- Sustained load: ${loadAssessment.executed ? `${loadAssessment.requests} requests, ${(loadAssessment.errorRate * 100).toFixed(2)}% errors` : 'not executed'}.\n- Recovery probe: ${recovery ? 'executed' : 'not executed'}.\n- Sentry collection: ${sentry?.status || 'not executed'}.\n\n` +
    `## Functional Verification\n\n| Check | Result | Duration |\n|---|---:|---:|\n${functionalRows}\n\n` +
    `## Load Results\n\n| Metric | Result | Gate |\n|---|---:|---:|\n| Requests | ${loadAssessment.requests || 0} | Sustained 50-admin run |\n| Error rate | ${loadAssessment.executed ? (loadAssessment.errorRate * 100).toFixed(2) + '%' : 'Not measured'} | < 1% |\n| p50 | ${formatMs(loadAssessment.p50)} | Informational |\n| p95 | ${formatMs(loadAssessment.p95)} | < 2,000 ms overall; list APIs require endpoint review below 800 ms |\n| p99 | ${formatMs(loadAssessment.p99)} | < 4,000 ms overall; list APIs require endpoint review below 1,500 ms |\n\n` +
    `## Browser Screen Measurements\n\n| Screen | Usable Time | Table Rows | JS Heap |\n|---|---:|---:|---:|\n${screenRows}\n\n` +
    `Browser failed requests: ${browser?.status === 'measured' ? browser.failedRequests.length : 'not measured'}. Console errors: ${browser?.status === 'measured' ? browser.consoleErrors.length : 'not measured'}.\n\n` +
    `## Static Scalability and Sentry Findings\n\n| Severity | Finding | Evidence | Recommendation |\n|---|---|---|---|\n${findingRows}\n\n` +
    `## Production Decision\n\n${passed ? 'All required gates passed for the tested staging profile.' : 'Do not approve the admin panel for production-scale use until every blocking item is resolved and the complete audit is rerun.'}\n`;

  const summary = {
    generatedAt,
    verdict,
    passed,
    blockers,
    targetProfile: profile,
    loadAssessment,
    browserPassed,
    functionalPassed: Boolean(functional?.passed),
    criticalFindings,
  };
  fs.writeFileSync(
    path.join(artifactsDir, 'admin-performance-audit.json'),
    JSON.stringify({ ...summary, functional, source, seed, browser, sentry }, null, 2),
  );
  fs.writeFileSync(path.join(artifactsDir, 'admin-performance-audit.md'), markdown);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Admin Performance Audit</title><style>body{font-family:Inter,Arial,sans-serif;color:#172033;max-width:1100px;margin:40px auto;padding:0 24px;line-height:1.5}h1,h2,h3{color:#10162f}h1{border-bottom:4px solid #6c5ce7;padding-bottom:14px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #dbe1ea;padding:8px;text-align:left;vertical-align:top}th{background:#f3f5fa}code{font-size:11px}strong{color:${passed ? '#087f5b' : '#c92a2a'}}@media print{body{margin:16px;max-width:none}h2{break-after:avoid}tr{break-inside:avoid;page-break-inside:avoid}}</style></head><body>${marked.parse(markdown)}</body></html>`;
  fs.writeFileSync(path.join(artifactsDir, 'admin-performance-audit.html'), html);

  try {
    const browserInstance = await puppeteer.launch({
      headless: true,
      executablePath: resolveChromeExecutable(),
      args: ['--no-sandbox'],
    });
    const page = await browserInstance.newPage();
    await page.goto(`file://${path.join(artifactsDir, 'admin-performance-audit.html')}`, {
      waitUntil: 'load',
      timeout: 120_000,
    });
    await page.pdf({
      path: path.join(artifactsDir, 'admin-performance-audit.pdf'),
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
    await browserInstance.close();
  } catch (error) {
    summary.pdfError = error.message;
    fs.writeFileSync(
      path.join(artifactsDir, 'admin-performance-audit.json'),
      JSON.stringify({ ...summary, functional, source, seed, browser, sentry }, null, 2),
    );
    console.warn(`PDF generation skipped: ${error.message}`);
  }
  console.log(`${verdict}. Report written to ${artifactsDir}.`);
  return summary;
};

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main, assessLoad };
