const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const backendRoot = __dirname;
const workspaceRoot = path.resolve(backendRoot, '..');
const artifactsDir = path.join(backendRoot, 'artifacts');
const jsonPath = path.join(artifactsDir, 'api_test_report.json');
const htmlPath = path.join(artifactsDir, 'api_test_report.html');
const pdfPath = path.join(artifactsDir, 'api_test_report.pdf');

const FRONTEND_DIRS = [
  path.join(workspaceRoot, 'zaffabit', 'src'),
  path.join(workspaceRoot, 'zafabit'),
];

function ensureArtifactsDir() {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function walkFiles(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', 'coverage', '.git'].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, results);
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

function normalizePath(routePath) {
  return routePath
    .replace(/\?.*$/, '')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:([A-Za-z0-9_]+)/g, ':param')
    .replace(/\/+/g, '/');
}

function routeToRegex(routePath) {
  const escaped = routePath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\:param/g, '[^/]+')
    .replace(/:param/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

function endpointKey(endpoint) {
  return `${endpoint.method} ${normalizePath(endpoint.path)}`;
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function parseMountedRouteBases() {
  const appPath = path.join(backendRoot, 'src', 'app.js');
  const appSource = readFile(appPath);
  const bases = {};

  for (const match of appSource.matchAll(
    /app\.use\(['"]([^'"]+)['"],\s*require\(['"]\.\/routes\/([^'"]+)['"]\)\)/g,
  )) {
    bases[`${match[2]}.js`] = match[1];
  }

  return bases;
}

function scanBackendRoutes() {
  const routeDir = path.join(backendRoot, 'src', 'routes');
  const mountedBases = parseMountedRouteBases();
  const endpoints = [];

  for (const routeFile of fs
    .readdirSync(routeDir)
    .filter((file) => file.endsWith('Routes.js'))
    .sort()) {
    const source = readFile(path.join(routeDir, routeFile));
    const base = mountedBases[routeFile] || '(unmounted)';

    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g)) {
      const routeSuffix = match[2] === '/' ? '' : match[2];
      const fullPath = `${base}${routeSuffix}`.replace(/\/+/g, '/');
      endpoints.push({
        method: match[1].toUpperCase(),
        path: fullPath,
        normalizedPath: normalizePath(fullPath),
        file: path.relative(workspaceRoot, path.join(routeDir, routeFile)),
        area: fullPath.startsWith('/api/v1/admin') ? 'admin' : 'mobile',
      });
    }
  }

  return endpoints.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function extractApiMethodCalls(source, file) {
  const calls = [];
  const apiCallPattern = /api\.(get|post|put|patch|delete)\b/g;

  for (const match of source.matchAll(apiCallPattern)) {
    const method = match[1].toUpperCase();
    let index = match.index + match[0].length;
    let angleDepth = 0;

    while (index < source.length) {
      const char = source[index];
      if (char === '<' && angleDepth === 0) {
        angleDepth = 1;
        index += 1;
        continue;
      }
      if (angleDepth > 0) {
        if (char === '<') angleDepth += 1;
        if (char === '>') angleDepth -= 1;
        index += 1;
        continue;
      }
      if (char === '(') {
        index += 1;
        break;
      }
      index += 1;
    }

    while (/\s/.test(source[index])) index += 1;
    const quote = source[index];
    if (!['"', "'", '`'].includes(quote)) continue;
    index += 1;

    let rawPath = '';
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        rawPath += char + (source[index + 1] || '');
        index += 2;
        continue;
      }
      if (char === quote) break;
      rawPath += char;
      index += 1;
    }

    if (rawPath.startsWith('/api/')) {
      calls.push({
        method,
        path: rawPath,
        normalizedPath: normalizePath(rawPath),
        file,
      });
    }
  }

  return calls;
}

function scanReactApiCalls() {
  const files = FRONTEND_DIRS.flatMap((dir) =>
    walkFiles(dir, (file) => /\.(ts|tsx|js|jsx)$/.test(file)),
  );
  const calls = [];

  for (const file of files) {
    calls.push(...extractApiMethodCalls(readFile(file), path.relative(workspaceRoot, file)));
  }

  return uniqueBy(calls, (call) => `${call.method} ${call.normalizedPath}`).sort((a, b) =>
    `${a.method} ${a.normalizedPath}`.localeCompare(`${b.method} ${b.normalizedPath}`),
  );
}

function extractSupertestCalls(source, file) {
  const calls = [];
  const supertestPattern = /\.(get|post|put|patch|delete)\(['"`]([^'"`]*\/api\/v1[^'"`]*)['"`]/g;

  for (const match of source.matchAll(supertestPattern)) {
    calls.push({
      method: match[1].toUpperCase(),
      path: match[2],
      normalizedPath: normalizePath(match[2]),
      file,
    });
  }

  return calls;
}

function scanTestReferences() {
  const testDir = path.join(backendRoot, 'src', 'tests');
  const frontendTestDir = path.join(workspaceRoot, 'zaffabit', 'src', 'tests');
  const files = [
    ...walkFiles(testDir, (file) => /\.(test|spec)\.(js|ts|tsx)$/.test(file)),
    ...walkFiles(frontendTestDir, (file) => /\.(test|spec)\.(js|ts|tsx)$/.test(file)),
  ];
  const calls = [];

  for (const file of files) {
    const rel = path.relative(workspaceRoot, file);
    const source = readFile(file);
    calls.push(...extractSupertestCalls(source, rel));
    calls.push(...extractApiMethodCalls(source, rel));
  }

  return uniqueBy(calls, (call) => `${call.method} ${call.normalizedPath} ${call.file}`).sort(
    (a, b) => `${a.method} ${a.normalizedPath}`.localeCompare(`${b.method} ${b.normalizedPath}`),
  );
}

function matchEndpoint(candidate, endpoints) {
  return endpoints.some((endpoint) => {
    if (endpoint.method !== candidate.method) return false;
    return routeToRegex(endpoint.normalizedPath).test(candidate.normalizedPath);
  });
}

function testReferencesForEndpoint(endpoint, testReferences) {
  const endpointRegex = routeToRegex(endpoint.normalizedPath);
  return testReferences.filter(
    (ref) => ref.method === endpoint.method && endpointRegex.test(ref.normalizedPath),
  );
}

function buildReportData() {
  const endpoints = scanBackendRoutes();
  const reactCalls = scanReactApiCalls();
  const testReferences = scanTestReferences();
  const endpointByKey = new Map(endpoints.map((endpoint) => [endpointKey(endpoint), endpoint]));

  const reactCallsMissingBackend = reactCalls.filter((call) => !matchEndpoint(call, endpoints));

  const adminBackendNotCalledByReact = endpoints
    .filter((endpoint) => endpoint.area === 'admin')
    .filter(
      (endpoint) =>
        !reactCalls.some(
          (call) =>
            call.method === endpoint.method &&
            routeToRegex(endpoint.normalizedPath).test(call.normalizedPath),
        ),
    )
    .map((endpoint) => ({
      ...endpoint,
      classification: 'backend-only or UI-not-wired',
    }));

  const coveredEndpoints = endpoints.map((endpoint) => {
    const references = testReferencesForEndpoint(endpoint, testReferences);
    return {
      ...endpoint,
      tested: references.length > 0,
      testFiles: [...new Set(references.map((ref) => ref.file))],
    };
  });

  const adminEndpoints = coveredEndpoints.filter((endpoint) => endpoint.area === 'admin');
  const mobileEndpoints = coveredEndpoints.filter((endpoint) => endpoint.area === 'mobile');
  const testedAdmin = adminEndpoints.filter((endpoint) => endpoint.tested).length;
  const testedMobile = mobileEndpoints.filter((endpoint) => endpoint.tested).length;

  const packageJson = JSON.parse(readFile(path.join(backendRoot, 'package.json')));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalBackendRouteMethods: endpoints.length,
      totalAdminRouteMethods: adminEndpoints.length,
      totalMobileRouteMethods: mobileEndpoints.length,
      uniqueReactApiCalls: reactCalls.length,
      reactCallsMissingBackend: reactCallsMissingBackend.length,
      adminBackendOnlyOrUiNotWired: adminBackendNotCalledByReact.length,
      testedBackendRouteMethods: coveredEndpoints.filter((endpoint) => endpoint.tested).length,
      testedAdminRouteMethods: testedAdmin,
      testedMobileRouteMethods: testedMobile,
      adminTestCoveragePercent: percent(testedAdmin, adminEndpoints.length),
      mobileTestCoveragePercent: percent(testedMobile, mobileEndpoints.length),
      backendTestCoveragePercent: percent(
        coveredEndpoints.filter((endpoint) => endpoint.tested).length,
        coveredEndpoints.length,
      ),
    },
    scripts: {
      test: packageJson.scripts.test,
      testApi: packageJson.scripts['test:api'],
      testE2e: packageJson.scripts['test:e2e'],
      testLive: packageJson.scripts['test:live'],
      reportApi: packageJson.scripts['report:api'],
    },
    backendRouteMethods: endpoints,
    reactApiCalls: reactCalls,
    reactCallsMissingBackend,
    adminBackendOnlyOrUiNotWired: adminBackendNotCalledByReact,
    testCoverage: coveredEndpoints,
    untestedRouteMethods: coveredEndpoints.filter((endpoint) => !endpoint.tested),
    orphanTestReferences: testReferences.filter(
      (ref) =>
        !endpointByKey.has(`${ref.method} ${ref.normalizedPath}`) && !matchEndpoint(ref, endpoints),
    ),
    testReferences,
  };
}

function percent(numerator, denominator) {
  if (!denominator) return 100;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function methodClass(method) {
  return `method-${method.toLowerCase()}`;
}

function endpointRows(endpoints, options = {}) {
  const rows = endpoints
    .map((endpoint) => {
      const status = endpoint.tested
        ? '<span class="badge badge-ok">Tested</span>'
        : '<span class="badge badge-gap">No test ref</span>';
      const classification = endpoint.classification
        ? `<span class="badge badge-info">${escapeHtml(endpoint.classification)}</span>`
        : '';
      const testFiles =
        endpoint.testFiles && endpoint.testFiles.length
          ? endpoint.testFiles.map(escapeHtml).join('<br>')
          : '-';

      return `
      <tr>
        <td><span class="method ${methodClass(endpoint.method)}">${endpoint.method}</span></td>
        <td><code>${escapeHtml(endpoint.path)}</code></td>
        <td>${escapeHtml(endpoint.area || '')}</td>
        ${options.showStatus ? `<td>${status}</td>` : ''}
        ${options.showClassification ? `<td>${classification}</td>` : ''}
        ${options.showTests ? `<td>${testFiles}</td>` : ''}
      </tr>`;
    })
    .join('\n');

  const statusHeader = options.showStatus ? '<th>Status</th>' : '';
  const classificationHeader = options.showClassification ? '<th>Classification</th>' : '';
  const testsHeader = options.showTests ? '<th>Test files</th>' : '';

  return `
    <table>
      <thead>
        <tr>
          <th>Method</th>
          <th>Endpoint</th>
          <th>Area</th>
          ${statusHeader}
          ${classificationHeader}
          ${testsHeader}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function reactRows(calls, missingSet) {
  return `
    <table>
      <thead>
        <tr>
          <th>Method</th>
          <th>React API call</th>
          <th>Backend match</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        ${calls
          .map((call) => {
            const missing = missingSet.has(`${call.method} ${call.normalizedPath}`);
            return `
            <tr>
              <td><span class="method ${methodClass(call.method)}">${call.method}</span></td>
              <td><code>${escapeHtml(call.path)}</code></td>
              <td>${missing ? '<span class="badge badge-gap">Missing</span>' : '<span class="badge badge-ok">Matched</span>'}</td>
              <td>${escapeHtml(call.file)}</td>
            </tr>`;
          })
          .join('\n')}
      </tbody>
    </table>`;
}

function htmlReport(data) {
  const missingSet = new Set(
    data.reactCallsMissingBackend.map((call) => `${call.method} ${call.normalizedPath}`),
  );
  const untestedAdmin = data.untestedRouteMethods.filter((endpoint) => endpoint.area === 'admin');
  const untestedMobile = data.untestedRouteMethods.filter((endpoint) => endpoint.area === 'mobile');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zafabit API Test Report</title>
  <style>
    body {
      font-family: Inter, Arial, sans-serif;
      color: #182230;
      margin: 0;
      padding: 36px;
      line-height: 1.55;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
    }
    h1, h2, h3 { color: #101828; margin-bottom: 8px; }
    h1 { font-size: 28px; margin-top: 0; }
    h2 { font-size: 19px; margin-top: 34px; border-bottom: 1px solid #d0d5dd; padding-bottom: 8px; }
    h3 { font-size: 15px; margin-top: 22px; }
    p { color: #475467; font-size: 13px; margin-top: 0; }
    code {
      font-family: Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #344054;
      word-break: break-word;
    }
    .header {
      border-bottom: 3px solid #101828;
      padding-bottom: 18px;
      margin-bottom: 26px;
    }
    .meta {
      color: #667085;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin: 18px 0 26px;
    }
    .card {
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      padding: 14px;
      background: #f9fafb;
      page-break-inside: avoid;
    }
    .card .label {
      color: #667085;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .card .value {
      color: #101828;
      font-size: 24px;
      font-weight: 800;
      margin-top: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin-top: 12px;
      page-break-inside: auto;
    }
    th {
      text-align: left;
      background: #f2f4f7;
      border: 1px solid #d0d5dd;
      padding: 8px;
      color: #344054;
    }
    td {
      border: 1px solid #eaecf0;
      padding: 7px 8px;
      vertical-align: top;
    }
    .badge {
      display: inline-block;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge-ok { background: #dcfae6; color: #067647; }
    .badge-gap { background: #fee4e2; color: #b42318; }
    .badge-info { background: #e0f2fe; color: #026aa2; }
    .method {
      display: inline-block;
      min-width: 42px;
      text-align: center;
      border-radius: 4px;
      padding: 2px 5px;
      color: #ffffff;
      font-size: 10px;
      font-weight: 800;
      font-family: Menlo, Monaco, Consolas, monospace;
    }
    .method-get { background: #12b76a; }
    .method-post { background: #2e90fa; }
    .method-put { background: #f79009; }
    .method-patch { background: #7a5af8; }
    .method-delete { background: #f04438; }
    .callout {
      border-left: 4px solid #2e90fa;
      background: #f0f9ff;
      padding: 12px 14px;
      margin: 14px 0;
      color: #344054;
      font-size: 13px;
    }
    .script-list code { display: inline-block; margin: 2px 0; }
    @media print {
      body { padding: 20px; }
      h2 { page-break-after: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="meta">API Test Report / ATR</div>
    <h1>Zafabit Mobile and Admin API Coverage Report</h1>
    <p>Generated at ${escapeHtml(data.generatedAt)}. This report compares Express route-methods, React admin API usage, and Jest/Supertest test references.</p>
  </div>

  <div class="summary-grid">
    <div class="card"><div class="label">Backend route-methods</div><div class="value">${data.summary.totalBackendRouteMethods}</div></div>
    <div class="card"><div class="label">React calls missing backend</div><div class="value">${data.summary.reactCallsMissingBackend}</div></div>
    <div class="card"><div class="label">Admin coverage</div><div class="value">${data.summary.adminTestCoveragePercent}%</div></div>
    <div class="card"><div class="label">Mobile coverage</div><div class="value">${data.summary.mobileTestCoveragePercent}%</div></div>
  </div>

  <div class="callout">
    React/admin API gap result: <strong>${data.summary.reactCallsMissingBackend}</strong> React API calls are missing backend routes.
    Admin backend routes not currently called by React are classified as <strong>backend-only or UI-not-wired</strong>, not missing backend APIs.
  </div>

  <h2>Configured Test Commands</h2>
  <p class="script-list">
    <code>npm test</code>: ${escapeHtml(data.scripts.test)}<br>
    <code>npm run test:api</code>: ${escapeHtml(data.scripts.testApi)}<br>
    <code>npm run test:e2e</code>: ${escapeHtml(data.scripts.testE2e)}<br>
    <code>npm run test:live</code>: ${escapeHtml(data.scripts.testLive)}<br>
    <code>npm run report:api</code>: ${escapeHtml(data.scripts.reportApi)}
  </p>

  <h2>React Admin API Alignment</h2>
  <p>Unique React API calls: ${data.summary.uniqueReactApiCalls}. Missing backend matches: ${data.summary.reactCallsMissingBackend}.</p>
  ${reactRows(data.reactApiCalls, missingSet)}

  <h2>Backend-Only Or UI-Not-Wired Admin Routes</h2>
  <p>These admin routes exist in the backend but are not currently called by the React admin panel.</p>
  ${endpointRows(data.adminBackendOnlyOrUiNotWired, { showClassification: true })}

  <h2>Test Coverage By Route</h2>
  <p>Coverage is measured by route-method references in Jest/Supertest and frontend API tests. Backend total: ${data.summary.backendTestCoveragePercent}%.</p>
  ${endpointRows(data.testCoverage, { showStatus: true, showTests: true })}

  <h2>Untested Route-Methods</h2>
  <h3>Admin</h3>
  ${untestedAdmin.length ? endpointRows(untestedAdmin, { showStatus: true }) : '<p><span class="badge badge-ok">No untested admin route-methods detected.</span></p>'}
  <h3>Mobile / Shared</h3>
  ${untestedMobile.length ? endpointRows(untestedMobile, { showStatus: true }) : '<p><span class="badge badge-ok">No untested mobile/shared route-methods detected.</span></p>'}
</body>
</html>`;
}

async function writePdf(html) {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (fs.existsSync(chromePath)) {
    launchOptions.executablePath = chromePath;
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    await page.setContent(html, { waitUntil: 'load', timeout: 120000 });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '14mm',
        bottom: '14mm',
        left: '12mm',
        right: '12mm',
      },
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  ensureArtifactsDir();
  const data = buildReportData();
  const html = htmlReport(data);

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  fs.writeFileSync(htmlPath, html);
  await writePdf(html);

  console.log(`API test report JSON: ${jsonPath}`);
  console.log(`API test report HTML: ${htmlPath}`);
  console.log(`API test report PDF: ${pdfPath}`);
  console.log(`React API calls missing backend routes: ${data.summary.reactCallsMissingBackend}`);
  console.log(
    `Admin backend-only/UI-not-wired routes: ${data.summary.adminBackendOnlyOrUiNotWired}`,
  );
}

main().catch((error) => {
  console.error('Failed to generate API test report:', error);
  process.exit(1);
});
