 
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { artifactsDir, resolveChromeExecutable } = require('./config');

const waitForQuiet = async (page, timeout = 15_000) => {
  try {
    await page.waitForNetworkIdle({ idleTime: 500, timeout });
  } catch (_error) {
    /* record page state even when polling continues */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
};

const main = async () => {
  const puppeteer = (await import('puppeteer')).default;
  fs.mkdirSync(artifactsDir, { recursive: true });
  const adminUrl = process.env.PERF_ADMIN_URL;
  const email = process.env.PERF_ADMIN_EMAIL;
  const password = process.env.PERF_ADMIN_PASSWORD;
  const output = {
    generatedAt: new Date().toISOString(),
    status: 'not_configured',
    screens: [],
    failedRequests: [],
    consoleErrors: [],
  };
  if (!adminUrl || !email || !password) {
    output.reason = 'PERF_ADMIN_URL, PERF_ADMIN_EMAIL, and PERF_ADMIN_PASSWORD are required.';
    fs.writeFileSync(
      path.join(artifactsDir, 'browser-metrics.json'),
      JSON.stringify(output, null, 2),
    );
    return output;
  }

  const executablePath = resolveChromeExecutable();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false);
  page.on('requestfailed', (request) =>
    output.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error') output.consoleErrors.push(message.text());
  });

  try {
    const navigationStarted = Date.now();
    await page.goto(adminUrl, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
    await page.type('input[type="email"]', email);
    await page.type('input[type="password"]', password);
    const loginStarted = Date.now();
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.body.innerText.includes('Admin Sign In'), {
        timeout: 30_000,
      }),
    ]);
    await waitForQuiet(page);
    output.status = 'measured';
    output.initialNavigationMs = loginStarted - navigationStarted;
    output.loginToUsableMs = Date.now() - loginStarted;

    const measureScreen = async (label) => {
      const started = Date.now();
      const clicked = await page.evaluate((target) => {
        const elements = [...document.querySelectorAll('button')];
        const button = elements.find((element) => element.textContent?.trim().includes(target));
        if (!button) return false;
        button.click();
        return true;
      }, label);
      if (!clicked) return { label, status: 'not_found' };
      await waitForQuiet(page);
      const metrics = await page.metrics();
      const dom = await page.evaluate(() => ({
        rows: document.querySelectorAll('tbody tr').length,
        buttons: document.querySelectorAll('button').length,
        textLength: document.body.innerText.length,
        loadingVisible: /loading/i.test(document.body.innerText),
      }));
      return {
        label,
        status: 'measured',
        usableMs: Date.now() - started,
        dom,
        jsHeapUsedBytes: metrics.JSHeapUsedSize,
        nodes: metrics.Nodes,
        layoutDurationMs: Math.round(metrics.LayoutDuration * 1000),
        scriptDurationMs: Math.round(metrics.ScriptDuration * 1000),
      };
    };

    output.screens.push({
      label: 'Dashboard',
      status: 'measured',
      usableMs: output.loginToUsableMs,
    });
    for (const label of [
      'Users',
      'Bookings',
      'Instant Operations',
      'Transactions',
      'Refunds',
      'Earnings & Payouts',
      'Analytics',
      'Booking Analytics',
      'Activity Logs',
    ]) {
      output.screens.push(await measureScreen(label));
    }
    await page.screenshot({
      path: path.join(artifactsDir, 'admin-performance-final-screen.png'),
      fullPage: true,
    });
  } catch (error) {
    output.status = 'failed';
    output.error = error.message;
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(artifactsDir, 'browser-metrics.json'),
      JSON.stringify(output, null, 2),
    );
  }
  console.log(`Browser measurement status: ${output.status}.`);
  return output;
};

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main };
