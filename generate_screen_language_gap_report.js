const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const backendRoot = __dirname;
const workspaceRoot = path.resolve(backendRoot, '..');
const artifactsDir = path.join(backendRoot, 'artifacts');
const customerRoot = path.join(workspaceRoot, 'zaffabit app reactnative', 'ZaffabitApp');
const maidRoot = path.join(workspaceRoot, 'zaffabit new maid app');
const jsonPath = path.join(artifactsDir, 'screen_language_gap_report.json');
const htmlPath = path.join(artifactsDir, 'screen_language_gap_report.html');
const pdfPath = path.join(artifactsDir, 'screen_language_gap_report.pdf');

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function rel(filePath) {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function walkFiles(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      ['node_modules', 'ios', 'android', 'build', 'dist', 'coverage', '.git'].includes(entry.name)
    )
      continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, predicate, results);
    else if (predicate(fullPath)) results.push(fullPath);
  }
  return results;
}

function parseObjectBlocks(arraySource) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < arraySource.length; index += 1) {
    const char = arraySource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push(arraySource.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return blocks;
}

function arraySourceFrom(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex < 0) return '';
  const equalsIndex = source.indexOf('=', anchorIndex);
  const start = source.indexOf('[', equalsIndex >= 0 ? equalsIndex : anchorIndex);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '[') depth += 1;
    if (source[index] === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return '';
}

function parseCustomerScreens() {
  const contractPath = path.join(customerRoot, 'src', 'api', 'mobileApiContract.ts');
  const source = read(contractPath);
  const blocks = parseObjectBlocks(
    arraySourceFrom(source, 'export const mobileScreenApiRequirements'),
  );
  return blocks
    .map((block) => {
      const screen = (block.match(/screen:\s*'([^']+)'/) || [])[1];
      const status = (block.match(/status:\s*'([^']+)'/) || [])[1];
      const purpose = (block.match(/purpose:\s*'([^']+)'/) || [])[1];
      const missingApis = [
        ...block.matchAll(
          /method:\s*'([^']+)'\s*,\s*path:\s*'([^']+)'\s*,\s*priority:\s*'([^']+)'\s*,\s*reason:\s*'([^']+)'/g,
        ),
      ].map((match) => `${match[3]} ${match[1]} ${match[2]} - ${match[4]}`);
      return { screen, status, purpose, missingApis };
    })
    .filter((item) => item.screen);
}

function parseDictionaryBlocks() {
  const source = read(path.join(customerRoot, 'src', 'utils', 'translations.ts'));
  const blocks = {};
  for (const objectName of ['translations', 'supplementalTranslations']) {
    const anchor = `const ${objectName}`;
    const anchorIndex = source.indexOf(anchor);
    if (anchorIndex < 0) continue;
    const objectStart = source.indexOf('{', anchorIndex);
    let depth = 0;
    let end = -1;
    for (let index = objectStart; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    const objectSource = source.slice(objectStart + 1, end);
    for (const language of ['English', 'Malayalam', 'Hindi', 'Tamil']) {
      const langIndex = objectSource.indexOf(`${language}: {`);
      if (langIndex < 0) continue;
      const langStart = objectSource.indexOf('{', langIndex);
      let langDepth = 0;
      let langEnd = -1;
      for (let index = langStart; index < objectSource.length; index += 1) {
        if (objectSource[index] === '{') langDepth += 1;
        if (objectSource[index] === '}') {
          langDepth -= 1;
          if (langDepth === 0) {
            langEnd = index;
            break;
          }
        }
      }
      const langBlock = objectSource.slice(langStart + 1, langEnd);
      blocks[language] = blocks[language] || new Set();
      for (const match of langBlock.matchAll(/(['"])((?:\\.|(?!\1).)*)\1\s*:/g)) {
        blocks[language].add(match[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
      }
    }
  }
  return blocks;
}

function collectCustomerTKeys() {
  const files = walkFiles(path.join(customerRoot, 'src'), (file) =>
    /\.(ts|tsx|js|jsx)$/.test(file),
  );
  const keys = [];
  for (const file of files) {
    const source = read(file);
    for (const match of source.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g)) {
      keys.push({
        key: match[2].replace(/\\'/g, "'").replace(/\\"/g, '"'),
        file: rel(file),
        line: source.slice(0, match.index).split(/\r?\n/).length,
      });
    }
  }
  return keys;
}

function collectHardcodedText(appRoot) {
  const files = walkFiles(path.join(appRoot, 'src'), (file) => /\.(tsx|jsx)$/.test(file));
  const records = [];
  for (const file of files) {
    const source = read(file);
    for (const match of source.matchAll(/<Text[^>]*>\s*([A-Za-z][^<{}`\n]{2,})\s*<\/Text>/g)) {
      const value = match[1].replace(/\s+/g, ' ').trim();
      if (!value || /^[A-Z0-9_]+$/.test(value) || value.includes('{')) continue;
      records.push({
        text: value,
        file: rel(file),
        line: source.slice(0, match.index).split(/\r?\n/).length,
      });
    }
  }
  return records;
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(read(filePath));
  } catch {
    return fallback;
  }
}

function screenshotInventory() {
  const dirs = [
    path.join(artifactsDir, 'customer_screen_api_mapping'),
    path.join(artifactsDir, 'maid_screen_api_mapping', 'screenshots', 'live'),
    path.join(artifactsDir, 'maid_screen_api_mapping', 'screenshots', 'final'),
  ];
  return dirs.flatMap((dir) =>
    walkFiles(dir, (file) => /\.(png|jpe?g)$/i.test(file)).map((file) => rel(file)),
  );
}

function parseLocaleKeys(localeCode) {
  const source = read(path.join(backendRoot, 'src', 'utils', 'locales.js'));
  const anchorIndex = source.indexOf(`${localeCode}: {`);
  if (anchorIndex < 0) return new Set();
  const start = source.indexOf('{', anchorIndex);
  let depth = 0;
  let end = -1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const block = source.slice(start + 1, end);
  return new Set([...block.matchAll(/(['"])((?:\\.|(?!\1).)*)\1\s*:/g)].map((match) => match[2]));
}

function scanBackendResponseMessages() {
  const files = walkFiles(path.join(backendRoot, 'src'), (file) => /\.js$/.test(file));
  const messages = [];
  for (const file of files) {
    const source = read(file);
    const patterns = [
      /sendResponse\([^,]+,\s*\d+\s*,\s*(['"])((?:\\.|(?!\1).)*)\1/g,
      /sendError\([^,]+,\s*\d+\s*,\s*(['"])((?:\\.|(?!\1).)*)\1/g,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        messages.push({
          message: match[2],
          file: rel(file),
          line: source.slice(0, match.index).split(/\r?\n/).length,
        });
      }
    }
  }
  const unique = [...new Map(messages.map((item) => [item.message, item])).values()];
  const mlKeys = parseLocaleKeys('ml');
  return {
    totalUniqueMessages: unique.length,
    missingMalayalam: unique.filter((item) => !mlKeys.has(item.message)),
  };
}

function buildReport() {
  const customerScreens = parseCustomerScreens();
  const dictionary = parseDictionaryBlocks();
  const tKeys = collectCustomerTKeys();
  const uniqueTKeys = [...new Map(tKeys.map((item) => [item.key, item])).values()];
  const missingTranslations = Object.fromEntries(
    ['English', 'Malayalam', 'Hindi', 'Tamil'].map((language) => [
      language,
      uniqueTKeys.filter((item) => !dictionary[language]?.has(item.key)),
    ]),
  );
  const maidSummary = loadJson(path.join(artifactsDir, 'maid_screen_api_mapping', 'summary.json'), {
    screens: [],
  });
  const customerHardcoded = collectHardcodedText(customerRoot);
  const maidHardcoded = collectHardcodedText(maidRoot);
  const screenshots = screenshotInventory();
  const backendLocale = scanBackendResponseMessages();
  const customerScreenshots = screenshots.filter((shot) =>
    shot.includes('customer_screen_api_mapping'),
  );
  const maidScreenshots = screenshots.filter((shot) => shot.includes('maid_screen_api_mapping'));

  const customerScreenFindings = customerScreens.map((screen) => ({
    surface: 'customer',
    screen: screen.screen,
    status: screen.status,
    missing: [
      ...(screen.missingApis || []),
      ...(screen.status === 'static'
        ? ['Static/legal text should be CMS-driven if it must be centrally translated.']
        : []),
      ...(!screen.missingApis?.length &&
      screen.status !== 'static' &&
      !missingTranslations.Malayalam.length
        ? ['No API/localization gaps detected by static scan.']
        : []),
    ],
    screenshotEvidence:
      customerScreenshots.find((shot) =>
        shot.toLowerCase().includes(screen.screen.toLowerCase().replace(/\s+/g, '-')),
      ) || '',
  }));

  const maidScreenFindings = (maidSummary.screens || []).map((screen) => ({
    surface: 'maid',
    screen: screen.name,
    status: screen.gaps?.length ? 'gap_or_partial' : 'wired_or_static',
    missing: [
      ...(screen.gaps || []),
      'Maid UI text is mostly hardcoded English; add a t()/dictionary layer before Malayalam-only UI can be guaranteed.',
    ],
    screenshotEvidence:
      maidScreenshots.find((shot) =>
        shot.toLowerCase().includes(String(screen.name).toLowerCase().replace(/\s+/g, '-')),
      ) ||
      screen.screenshot ||
      '',
  }));

  return {
    generatedAt: new Date().toISOString(),
    executiveSummary: {
      customerScreens: customerScreens.length,
      customerMissingApiScreens: customerScreens.filter((screen) => screen.missingApis?.length)
        .length,
      customerMalayalamMissingTKeys: missingTranslations.Malayalam.length,
      customerHardcodedTextSamples: customerHardcoded.length,
      maidScreens: (maidSummary.screens || []).length,
      maidApiOrFlowGapScreens: (maidSummary.screens || []).filter((screen) => screen.gaps?.length)
        .length,
      maidHardcodedTextSamples: maidHardcoded.length,
      backendUniqueResponseMessages: backendLocale.totalUniqueMessages,
      backendMalayalamMissingMessages: backendLocale.missingMalayalam.length,
      screenshotFilesFound: screenshots.length,
      localeBehavior: {
        customer:
          'Customer API client sets locale from selected language: English=en, Malayalam=ml, Hindi=hi, Tamil=ta.',
        maid: 'Maid API client now supports dynamic locale; UI strings still need full dictionary conversion.',
      },
    },
    translationAudit: {
      customerTKeys: uniqueTKeys.length,
      missingTranslations,
      customerHardcodedText: customerHardcoded.slice(0, 120),
      maidHardcodedText: maidHardcoded.slice(0, 180),
    },
    backendLocaleAudit: {
      missingMalayalamMessages: backendLocale.missingMalayalam.slice(0, 160),
    },
    screenFindings: [...customerScreenFindings, ...maidScreenFindings],
    screenshots,
  };
}

function renderHtml(report) {
  const rows = report.screenFindings
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(item.surface)}</td>
      <td>${escapeHtml(item.screen)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml((item.missing || []).join('\\n'))}</td>
      <td>${escapeHtml(item.screenshotEvidence || 'No exact per-screen screenshot found')}</td>
    </tr>
  `,
    )
    .join('');
  const missingMl =
    report.translationAudit.missingTranslations.Malayalam.map(
      (item) =>
        `<li><code>${escapeHtml(item.key)}</code> - ${escapeHtml(item.file)}:${escapeHtml(item.line)}</li>`,
    ).join('') || '<li>None. All detected customer t(...) keys have Malayalam coverage.</li>';
  const maidHardcoded = report.translationAudit.maidHardcodedText
    .slice(0, 80)
    .map(
      (item) =>
        `<li><code>${escapeHtml(item.text)}</code> - ${escapeHtml(item.file)}:${escapeHtml(item.line)}</li>`,
    )
    .join('');
  const backendMlMissing = report.backendLocaleAudit.missingMalayalamMessages
    .slice(0, 100)
    .map(
      (item) =>
        `<li><code>${escapeHtml(item.message)}</code> - ${escapeHtml(item.file)}:${escapeHtml(item.line)}</li>`,
    )
    .join('');

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Screen Language Gap Report</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #1f2937; }
      h1, h2 { color: #111827; }
      .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
      .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; background: #f9fafb; }
      .label { color: #6b7280; font-size: 12px; text-transform: uppercase; }
      .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; white-space: pre-line; }
      th { background: #eef2ff; text-align: left; }
      code { background: #eef2ff; padding: 1px 4px; border-radius: 4px; }
      li { margin-bottom: 5px; }
    </style>
  </head>
  <body>
    <h1>Screen Language Gap Report</h1>
    <p>Generated: ${escapeHtml(report.generatedAt)}</p>
    <div class="grid">
      <div class="card"><div class="label">Customer Screens</div><div class="value">${report.executiveSummary.customerScreens}</div></div>
      <div class="card"><div class="label">Customer ML Missing Keys</div><div class="value">${report.executiveSummary.customerMalayalamMissingTKeys}</div></div>
      <div class="card"><div class="label">Maid Screens</div><div class="value">${report.executiveSummary.maidScreens}</div></div>
      <div class="card"><div class="label">Maid Hardcoded Samples</div><div class="value">${report.executiveSummary.maidHardcodedTextSamples}</div></div>
      <div class="card"><div class="label">Backend ML Missing Messages</div><div class="value">${report.executiveSummary.backendMalayalamMissingMessages}</div></div>
    </div>
    <h2>Locale Behavior</h2>
    <p><b>Customer:</b> ${escapeHtml(report.executiveSummary.localeBehavior.customer)}</p>
    <p><b>Maid:</b> ${escapeHtml(report.executiveSummary.localeBehavior.maid)}</p>
    <h2>Customer Malayalam Missing Translation Keys</h2>
    <ul>${missingMl}</ul>
    <h2>Maid Hardcoded English Samples</h2>
    <p>The maid app needs a proper dictionary/t() layer for full Malayalam-only UI.</p>
    <ul>${maidHardcoded}</ul>
    <h2>Backend Malayalam Response Gaps</h2>
    <p>These API response messages still fall back to English when <code>locale: ml</code> is sent.</p>
    <ul>${backendMlMissing}</ul>
    <h2>What Is Missing Per Screen</h2>
    <table>
      <thead><tr><th>App</th><th>Screen</th><th>Status</th><th>Missing / Required Work</th><th>Screenshot Evidence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
  </html>`;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const report = buildReport();
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(htmlPath, renderHtml(report));

  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
  };
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  await page.setContent(read(htmlPath), { waitUntil: 'load', timeout: 120000 });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
  });
  await browser.close();

  console.log(`Generated ${rel(jsonPath)}`);
  console.log(`Generated ${rel(htmlPath)}`);
  console.log(`Generated ${rel(pdfPath)}`);
  console.log(JSON.stringify(report.executiveSummary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
