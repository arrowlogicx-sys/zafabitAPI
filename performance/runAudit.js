 
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { artifactsDir } = require('./config');
const sourceAudit = require('./auditSourceRisks');
const functionalAudit = require('./runFunctionalAudit');
const sentryAudit = require('./collectSentryMetrics');
const browserAudit = require('./measureAdminBrowser');
const report = require('./generatePerformanceReport');

const root = path.resolve(__dirname, '..');
const runArtillery = (config, output) => {
  const args = ['artillery', 'run', '--output', path.join(artifactsDir, output)];
  if (process.env.PERF_BASE_URL) args.push('--target', process.env.PERF_BASE_URL);
  args.push(path.join(__dirname, config));
  const result = spawnSync('npx', args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) console.warn(`${config} exited with status ${result.status}.`);
  return result.status === 0;
};

const main = async () => {
  fs.mkdirSync(artifactsDir, { recursive: true });
  sourceAudit.main();
  if (process.env.PERF_SKIP_FUNCTIONAL !== 'true') functionalAudit.main();
  await sentryAudit.main();

  const credentialsReady =
    process.env.PERF_BASE_URL && process.env.PERF_ADMIN_EMAIL && process.env.PERF_ADMIN_PASSWORD;
  if (credentialsReady) {
    runArtillery('artillery.smoke.yml', 'artillery-warmup.json');
    if (process.env.PERF_RUN_FULL === 'true') {
      runArtillery('artillery.full.yml', 'artillery-full.json');
      console.log('Waiting five minutes before the recovery probe.');
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
      runArtillery('artillery.recovery.yml', 'artillery-recovery.json');
    } else {
      console.log('Full load skipped. Set PERF_RUN_FULL=true to run the 50-admin sustained audit.');
    }
  } else {
    console.log('Load test skipped because staging URL or admin credentials are not configured.');
  }

  await browserAudit.main();
  await report.main();
};

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
