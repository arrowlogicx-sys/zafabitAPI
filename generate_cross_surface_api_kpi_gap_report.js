const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const backendRoot = __dirname;
const workspaceRoot = path.resolve(backendRoot, '..');
const artifactsDir = path.join(backendRoot, 'artifacts');
const jsonPath = path.join(artifactsDir, 'cross_surface_api_kpi_gap_report.json');
const htmlPath = path.join(artifactsDir, 'cross_surface_api_kpi_gap_report.html');
const pdfPath = path.join(artifactsDir, 'cross_surface_api_kpi_gap_report.pdf');

const customerAppRoot = path.join(workspaceRoot, 'zaffabit app reactnative', 'ZaffabitApp');
const maidAppARoot = path.join(workspaceRoot, 'zaffabit new maid app');
const adminAppRoot = path.join(workspaceRoot, 'zaffabit');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readIfExists(filePath) {
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

function normalizeRoute(routePath) {
  return String(routePath || '')
    .replace(/\?.*$/, '')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:([A-Za-z0-9_]+)/g, ':param')
    .replace(/\/+/g, '/');
}

function routeToRegex(routePath) {
  const escaped = normalizeRoute(routePath)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:param/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

function withApiPrefix(routePath) {
  return routePath.startsWith('/api/v1') ? routePath : `/api/v1${routePath}`;
}

function lineNumberOf(source, needle) {
  const index = source.indexOf(needle);
  if (index < 0) return undefined;
  return source.slice(0, index).split(/\r?\n/).length;
}

function lineRefs(filePath, patterns) {
  const source = readIfExists(filePath);
  if (!source) return [];

  const refs = [];
  source.split(/\r?\n/).forEach((line, index) => {
    patterns.forEach((pattern) => {
      const matched = pattern instanceof RegExp ? pattern.test(line) : line.includes(pattern);
      if (matched) {
        refs.push(`${rel(filePath)}:${index + 1}`);
      }
    });
  });

  return [...new Set(refs)];
}

function firstLineRef(filePath, patterns) {
  return lineRefs(filePath, patterns)[0] || rel(filePath);
}

function walkFiles(dirPath, predicate, results = []) {
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', 'coverage', '.git'].includes(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, results);
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

function parseMountedRouteBases() {
  const appSource = read(path.join(backendRoot, 'src', 'app.js'));
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
  const routes = [];

  for (const routeFile of fs
    .readdirSync(routeDir)
    .filter((file) => file.endsWith('Routes.js'))
    .sort()) {
    const filePath = path.join(routeDir, routeFile);
    const source = read(filePath);
    const lines = source.split(/\r?\n/);
    const base = mountedBases[routeFile] || '';
    const protectLines = [];

    lines.forEach((line, index) => {
      if (/router\.use\(protect\)/.test(line)) protectLines.push(index + 1);
    });

    lines.forEach((line, index) => {
      const match = line.match(/router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/);
      if (!match) return;

      const method = match[1].toUpperCase();
      const suffix = match[2] === '/' ? '' : match[2];
      const routePath = `${base}${suffix}`.replace(/\/+/g, '/');
      const lineNo = index + 1;
      const protectedByUse = protectLines.some((protectLine) => protectLine < lineNo);
      const protectedInline = /\bprotect\b/.test(line);

      routes.push({
        method,
        path: routePath,
        normalizedPath: normalizeRoute(routePath),
        sourceRef: `${rel(filePath)}:${lineNo}`,
        auth: protectedByUse || protectedInline ? 'Bearer JWT required' : 'Public endpoint',
        area: routePath.startsWith('/api/v1/admin')
          ? 'admin'
          : routePath.startsWith('/api/v1/maids')
            ? 'maid'
            : routePath.startsWith('/api/v1/agents')
              ? 'agent'
              : 'customer/mobile',
      });
    });
  }

  return routes;
}

function findRoute(routes, method, routePath) {
  const candidatePath = normalizeRoute(withApiPrefix(routePath));
  return routes.find(
    (route) => route.method === method && routeToRegex(route.normalizedPath).test(candidatePath),
  );
}

function hasExactRoute(routes, method, routePath) {
  const candidatePath = normalizeRoute(withApiPrefix(routePath));
  return routes.some((route) => route.method === method && route.normalizedPath === candidatePath);
}

function getArraySource(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex < 0) return '';

  const equalsIndex = source.indexOf('=', anchorIndex);
  const searchStart = equalsIndex >= 0 ? equalsIndex : anchorIndex;
  const bracketStart = source.indexOf('[', searchStart);
  if (bracketStart < 0) return '';

  let depth = 0;
  for (let index = bracketStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bracketStart + 1, index);
      }
    }
  }

  return '';
}

function extractTopLevelObjects(arraySource) {
  const blocks = [];
  let braceDepth = 0;
  let startIndex = -1;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < arraySource.length; index += 1) {
    const char = arraySource[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      quote = char;
      continue;
    }

    if (char === '{') {
      if (braceDepth === 0) startIndex = index;
      braceDepth += 1;
      continue;
    }

    if (char === '}') {
      braceDepth -= 1;
      if (braceDepth === 0 && startIndex >= 0) {
        blocks.push(arraySource.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return blocks;
}

function parseEndpointDefinitions(filePath) {
  const source = read(filePath);
  const endpoints = new Map();
  const endpointPattern =
    /\{\s*key:\s*'([^']+)',\s*method:\s*'([^']+)',\s*path:\s*'([^']+)',\s*screens:\s*\[([^\]]*)\],\s*purpose:\s*'([^']+)'\s*\}/g;

  for (const match of source.matchAll(endpointPattern)) {
    const key = match[1];
    endpoints.set(key, {
      key,
      method: match[2].toUpperCase(),
      path: match[3],
      screens: [...match[4].matchAll(/'([^']+)'/g)].map((item) => item[1]),
      purpose: match[5],
      sourceRef: `${rel(filePath)}:${lineNumberOf(source, `key: '${key}'`)}`,
    });
  }

  return endpoints;
}

function parseContractScreenRequirements(filePath, endpointDefinitions) {
  const source = read(filePath);
  const arraySource = getArraySource(source, 'export const mobileScreenApiRequirements');
  const blocks = extractTopLevelObjects(arraySource);

  return blocks
    .map((block) => {
      const screen = (block.match(/screen:\s*'([^']+)'/) || [])[1];
      const status = (block.match(/status:\s*'([^']+)'/) || [])[1];
      const purpose = (block.match(/purpose:\s*'([^']+)'/) || [])[1];
      const notes = (block.match(/notes:\s*'([^']+)'/) || [])[1] || '';
      const endpointKeys = [...block.matchAll(/endpoint\('([^']+)'\)/g)].map((match) => match[1]);
      const missingApis = [
        ...block.matchAll(
          /method:\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*path:\s*'([^']+)'\s*,\s*priority:\s*'(required|recommended)'\s*,\s*reason:\s*'([^']+)'/g,
        ),
      ].map((match) => ({
        method: match[1],
        path: match[2],
        priority: match[3],
        reason: match[4],
      }));

      return {
        screen,
        status,
        purpose,
        notes,
        sourceRef: `${rel(filePath)}:${lineNumberOf(source, `screen: '${screen}'`)}`,
        endpoints: endpointKeys.map((key) => endpointDefinitions.get(key)).filter(Boolean),
        missingApis,
      };
    })
    .filter((item) => item.screen);
}

function deriveSeverityFromMissing(missingApis) {
  if (missingApis.some((item) => item.priority === 'required')) return 'required';
  if (missingApis.some((item) => item.priority === 'recommended')) return 'recommended';
  return 'info';
}

function buildContractAppAudit({
  surface,
  label,
  appRoot,
  legacyNote,
  staleDocPath,
  backendRoutes,
}) {
  const endpointDefinitions = parseEndpointDefinitions(
    path.join(appRoot, 'src', 'api', 'mobileApi.ts'),
  );
  const screens = parseContractScreenRequirements(
    path.join(appRoot, 'src', 'api', 'mobileApiContract.ts'),
    endpointDefinitions,
  );

  const screenRecords = [];
  const gapRecords = [];

  screens.forEach((screen) => {
    const matchedRoutes = screen.endpoints
      .map((endpoint) => findRoute(backendRoutes, endpoint.method, endpoint.path))
      .filter(Boolean);
    const missingSummary = screen.missingApis
      .map((gap) => `${gap.priority.toUpperCase()}: ${gap.method} ${gap.path}`)
      .join('; ');
    screenRecords.push({
      surface,
      screen_or_view: screen.screen,
      status: screen.status,
      gap_type: screen.missingApis.length ? 'screen_gap' : 'screen_audit',
      severity: deriveSeverityFromMissing(screen.missingApis),
      method: '',
      path: '',
      backend_matched: screen.endpoints.length === matchedRoutes.length,
      backend_ref: matchedRoutes.map((route) => route.sourceRef).join(', '),
      source_refs: [screen.sourceRef],
      notes: [screen.purpose, screen.notes, missingSummary].filter(Boolean).join(' | '),
    });

    screen.missingApis.forEach((gap) => {
      gapRecords.push({
        surface,
        screen_or_view: screen.screen,
        status: 'missing',
        gap_type: 'missing_api',
        severity: gap.priority,
        method: gap.method,
        path: gap.path,
        backend_matched: hasExactRoute(backendRoutes, gap.method, gap.path),
        backend_ref: '',
        source_refs: [screen.sourceRef],
        notes: gap.reason,
      });
    });
  });

  const requiredMissing = gapRecords.filter((record) => record.severity === 'required').length;
  const recommendedMissing = gapRecords.filter(
    (record) => record.severity === 'recommended',
  ).length;
  const statusBreakdown = screens.reduce((acc, screen) => {
    acc[screen.status] = (acc[screen.status] || 0) + 1;
    return acc;
  }, {});

  const staleFindings = [];
  if (staleDocPath && fs.existsSync(staleDocPath)) {
    const staleDocSource = read(staleDocPath);
    const requiredRows = [...staleDocSource.matchAll(/\|\s*Required\s*\|/g)].length;
    if (requiredRows > 0 && requiredMissing === 0) {
      staleFindings.push({
        surface: `${surface}_staleness`,
        screen_or_view: rel(staleDocPath),
        status: 'stale_artifact_claim',
        gap_type: 'stale_report',
        severity: 'warning',
        method: '',
        path: '',
        backend_matched: true,
        backend_ref: '',
        source_refs: [rel(staleDocPath)],
        notes: `Artifact still lists ${requiredRows} required missing API row(s), but current contract source has 0 required missing APIs.`,
      });
    }
  }

  return {
    surface,
    label,
    root: rel(appRoot),
    note: legacyNote || '',
    summary: {
      screens: screens.length,
      endpointDefinitions: endpointDefinitions.size,
      requiredMissing,
      recommendedMissing,
      statusBreakdown,
    },
    screens,
    records: [...screenRecords, ...gapRecords],
    staleFindings,
  };
}

function parseLegacyMaidEndpoints(generatorPath) {
  const source = read(generatorPath);
  const arraySource = getArraySource(source, 'const endpoints =');
  const blocks = extractTopLevelObjects(arraySource);

  return blocks
    .map((block) => {
      const key = (block.match(/key:\s*'([^']+)'/) || [])[1];
      const method = (block.match(/method:\s*'([^']+)'/) || [])[1];
      const endpointPath = (block.match(/path:\s*'([^']+)'/) || [])[1];
      const status = (block.match(/status:\s*'([^']+)'/) || [])[1] || 'wired_or_service_available';
      return {
        key,
        method,
        path: endpointPath,
        status,
        sourceRef: `${rel(generatorPath)}:${lineNumberOf(source, `key: '${key}'`)}`,
      };
    })
    .filter((item) => item.key);
}

function parseLegacyMaidScreens(generatorPath) {
  const source = read(generatorPath);
  const arraySource = getArraySource(source, 'const screenData =');
  const blocks = extractTopLevelObjects(arraySource);

  return blocks
    .map((block) => {
      const name = (block.match(/name:\s*'([^']+)'/) || [])[1];
      const route = (block.match(/route:\s*'([^']+)'/) || [])[1] || '';
      const purpose = (block.match(/purpose:\s*'([^']+)'/) || [])[1] || '';
      const apis = [
        ...((block.match(/apis:\s*\[([\s\S]*?)\]/) || [])[1] || '').matchAll(/'([^']+)'/g),
      ].map((match) => match[1]);
      const gaps = [
        ...((block.match(/gaps:\s*\[([\s\S]*?)\]/) || [])[1] || '').matchAll(/'([^']+)'/g),
      ].map((match) => match[1]);
      const sourceField = (block.match(/source:\s*([^,\n]+)/) || [])[1] || '';
      return {
        name,
        route,
        purpose,
        apis,
        gaps,
        sourceRef: `${rel(generatorPath)}:${lineNumberOf(source, `name: '${name}'`)}`,
        sourceField,
      };
    })
    .filter((item) => item.name);
}

function buildLegacyMaidAudit({ backendRoutes }) {
  const generatorPath = path.join(backendRoot, 'generate_maid_screen_api_mapping_pdf.js');
  const summaryPath = path.join(
    backendRoot,
    'artifacts',
    'maid_screen_api_mapping',
    'summary.json',
  );
  const endpoints = parseLegacyMaidEndpoints(generatorPath);
  const screens = parseLegacyMaidScreens(generatorPath);
  const existingSummary = fs.existsSync(summaryPath) ? JSON.parse(read(summaryPath)) : null;
  const summaryByKey = new Map((existingSummary?.endpoints || []).map((item) => [item.key, item]));
  const summaryScreenByName = new Map(
    (existingSummary?.screens || []).map((item) => [item.name, item]),
  );

  const endpointRecords = endpoints.map((endpoint) => {
    const matchedRoute = findRoute(backendRoutes, endpoint.method.toUpperCase(), endpoint.path);
    const summaryEndpoint = summaryByKey.get(endpoint.key);
    const status = matchedRoute ? 'wired_or_service_available' : 'missing_backend_route';
    return {
      key: endpoint.key,
      method: endpoint.method.toUpperCase(),
      path: endpoint.path,
      status,
      backendMatched: Boolean(matchedRoute),
      backendRef: matchedRoute?.sourceRef || summaryEndpoint?.backendRef || '',
      sourceRefs: summaryEndpoint?.sourceRefs || [endpoint.sourceRef],
      notes: matchedRoute
        ? 'Backend route exists for this maid app endpoint.'
        : 'No matching backend route was found for this maid app endpoint.',
    };
  });

  const screenRecords = screens.map((screen) => {
    const summaryScreen = summaryScreenByName.get(screen.name);
    const screenSourceRefs = summaryScreen?.source
      ? [
          `${rel(path.join(maidAppARoot, summaryScreen.source))}:${
            lineNumberOf(
              read(path.join(maidAppARoot, summaryScreen.source)),
              `function ${screen.route}`,
            ) ||
            lineNumberOf(read(path.join(maidAppARoot, summaryScreen.source)), screen.name) ||
            1
          }`,
        ]
      : [screen.sourceRef];
    const referencedEndpoints = screen.apis
      .map((apiKey) => endpointRecords.find((endpoint) => endpoint.key === apiKey))
      .filter(Boolean);
    const gapEndpoints = referencedEndpoints.filter((endpoint) => !endpoint.backendMatched);

    const status = gapEndpoints.length
      ? 'gap_or_partial'
      : screen.apis.length
        ? 'wired_or_service_available'
        : 'static_or_local';

    return {
      surface: 'maid_app',
      screen_or_view: screen.name,
      status,
      gap_type: status === 'gap_or_partial' ? 'screen_gap' : 'screen_audit',
      severity: status === 'gap_or_partial' ? 'warning' : 'info',
      method: '',
      path: '',
      backend_matched: referencedEndpoints.length
        ? referencedEndpoints.every((endpoint) => endpoint.backendMatched)
        : true,
      backend_ref: gapEndpoints
        .map((endpoint) => endpoint.backendRef)
        .filter(Boolean)
        .join(', '),
      source_refs: screenSourceRefs,
      notes: [
        screen.purpose,
        screen.route ? `Route: ${screen.route}` : '',
        gapEndpoints.length
          ? `Missing backend routes: ${gapEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join(' | '),
    };
  });

  const summaryScreens = screens.map((screen) => {
    const summaryScreen = summaryScreenByName.get(screen.name);
    const sourceRef = summaryScreen?.source
      ? `${rel(path.join(maidAppARoot, summaryScreen.source))}:${
          lineNumberOf(
            read(path.join(maidAppARoot, summaryScreen.source)),
            `function ${screen.route}`,
          ) ||
          lineNumberOf(read(path.join(maidAppARoot, summaryScreen.source)), screen.name) ||
          1
        }`
      : screen.sourceRef;
    const referencedEndpoints = screen.apis
      .map((apiKey) => endpointRecords.find((endpoint) => endpoint.key === apiKey))
      .filter(Boolean);
    const missingApis = referencedEndpoints
      .filter((endpoint) => !endpoint.backendMatched)
      .map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
      }));

    return {
      screen: screen.name,
      status: missingApis.length
        ? 'gap_or_partial'
        : screen.apis.length
          ? 'wired_or_service_available'
          : 'static_or_local',
      purpose: screen.purpose,
      notes: missingApis.length
        ? `Missing backend routes: ${missingApis.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ')}`
        : '',
      sourceRef,
      endpoints: referencedEndpoints,
      missingApis,
    };
  });

  const gapRecords = endpointRecords
    .filter((endpoint) => !endpoint.backendMatched)
    .map((endpoint) => ({
      surface: 'maid_app',
      screen_or_view: screens
        .filter((screen) => screen.apis.includes(endpoint.key))
        .map((screen) => screen.name)
        .join(', '),
      status: 'gap_or_partial',
      gap_type: 'missing_backend_route',
      severity: 'warning',
      method: endpoint.method,
      path: endpoint.path,
      backend_matched: endpoint.backendMatched,
      backend_ref: endpoint.backendRef,
      source_refs: endpoint.sourceRefs,
      notes: endpoint.notes,
    }));

  return {
    surface: 'maid_app',
    label: 'Maid App',
    root: rel(maidAppARoot),
    note: 'This section now treats a maid screen as a gap only when its referenced API has no matching backend route.',
    summary: {
      screens: screens.length,
      endpoints: endpointRecords.length,
      gaps: gapRecords.length,
      routeMatches: endpointRecords.filter((endpoint) => endpoint.backendMatched).length,
    },
    screens: summaryScreens,
    endpoints: endpointRecords,
    records: [...screenRecords, ...gapRecords],
    staleFindings: [],
  };
}

function extractApiCalls(source, filePath) {
  const calls = [];
  const callPattern = /api\.(get|post|put|patch|delete|postForm|putForm)\b/g;

  for (const match of source.matchAll(callPattern)) {
    const method = match[1].toUpperCase().replace('FORM', '');
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
      if (char === '(') break;
      index += 1;
    }
    if (source[index] !== '(') continue;
    index += 1;

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

    if (!rawPath.startsWith('/api/')) continue;
    calls.push({
      method,
      path: rawPath,
      normalizedPath: normalizeRoute(rawPath),
      sourceRef: `${rel(filePath)}:${lineNumberOf(source, rawPath)}`,
    });
  }

  return calls;
}

function uniqueBy(items, keyFn) {
  const seen = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!seen.has(key)) seen.set(key, item);
  });
  return [...seen.values()];
}

function buildAdminApiAudit({ backendRoutes }) {
  const adminViewsDir = path.join(adminAppRoot, 'src', 'views');
  const viewFiles = walkFiles(adminViewsDir, (filePath) => /\.(ts|tsx|js|jsx)$/.test(filePath));
  const frontendCalls = uniqueBy(
    viewFiles.flatMap((filePath) => extractApiCalls(read(filePath), filePath)),
    (call) => `${call.method} ${call.normalizedPath}`,
  );

  const adminRoutes = backendRoutes.filter((route) => route.area === 'admin');
  const missingFrontendCalls = frontendCalls.filter(
    (call) =>
      !backendRoutes.some(
        (route) =>
          route.method === call.method &&
          routeToRegex(route.normalizedPath).test(call.normalizedPath),
      ),
  );
  const backendOnlyRoutes = adminRoutes.filter(
    (route) =>
      !frontendCalls.some(
        (call) =>
          call.method === route.method &&
          routeToRegex(route.normalizedPath).test(call.normalizedPath),
      ),
  );

  const records = [
    ...missingFrontendCalls.map((call) => ({
      surface: 'admin_api',
      screen_or_view: call.sourceRef.split(':')[0].split('/').pop(),
      status: 'missing',
      gap_type: 'frontend_call_without_backend_route',
      severity: 'required',
      method: call.method,
      path: call.path,
      backend_matched: false,
      backend_ref: '',
      source_refs: [call.sourceRef],
      notes:
        'Admin UI calls a route shape that is not present in the current Express route inventory.',
    })),
    ...backendOnlyRoutes.map((route) => ({
      surface: 'admin_api',
      screen_or_view: 'Admin backend inventory',
      status: 'backend_only_or_ui_not_wired',
      gap_type: 'backend_route_not_used_by_admin_ui',
      severity: 'info',
      method: route.method,
      path: route.path,
      backend_matched: true,
      backend_ref: route.sourceRef,
      source_refs: [route.sourceRef],
      notes: 'Backend route exists but no current admin UI API call matches it.',
    })),
  ];

  return {
    surface: 'admin_api',
    label: 'Admin API Audit',
    root: rel(adminAppRoot),
    summary: {
      viewFiles: viewFiles.length,
      frontendCalls: frontendCalls.length,
      missingFrontendCalls: missingFrontendCalls.length,
      backendOnlyRoutes: backendOnlyRoutes.length,
    },
    frontendCalls,
    adminRoutes,
    records,
  };
}

function buildAdminKpiAudit() {
  const viewFiles = walkFiles(path.join(adminAppRoot, 'src', 'views'), (filePath) =>
    filePath.endsWith('View.tsx'),
  );
  const mockKpiPath = path.join(adminAppRoot, 'src', 'data', 'mockKpiData.ts');
  const mockKpiReferences = walkFiles(path.join(adminAppRoot, 'src'), (filePath) =>
    /\.(ts|tsx)$/.test(filePath),
  )
    .flatMap((filePath) =>
      lineRefs(filePath, ['mockKpiCardsData', 'mockBookingsOverview', 'mockCategoryDistribution']),
    )
    .filter((ref) => !ref.startsWith(rel(mockKpiPath)));

  const records = viewFiles.map((filePath) => {
    const source = read(filePath);
    const viewName = path.basename(filePath);
    let status = 'no_explicit_kpi_surface';
    let notes = 'No explicit KPI card or fallback analytics surface detected in this view.';

    if (viewName === 'DashboardView.tsx' && source.includes('/api/v1/admin/dashboard')) {
      status = 'live_wired';
      notes = 'Dashboard KPI cards and related overview data load from /api/v1/admin/dashboard.';
    } else if (viewName === 'AnalyticsView.tsx' && source.includes('/api/v1/admin/dashboard')) {
      status = /FALLBACK_[A-Z_]+/.test(source) ? 'live_with_fallback' : 'live_wired';
      notes = /FALLBACK_[A-Z_]+/.test(source)
        ? 'Analytics view is live-wired to admin APIs but still carries local fallback constants.'
        : 'Analytics view is fully live-wired to admin APIs.';
    } else if (/mockKpi/i.test(source)) {
      status = 'mock_only';
      notes = 'This view still imports or relies on mock KPI state.';
    } else if (
      /(KpiCard|MiniMetric|ProgressMetric|paymentSuccessRate|averageOrderValue|regionalServiceDensity|serviceCategorySplits)/.test(
        source,
      ) &&
      /api\.(get|post|put|patch)/.test(source)
    ) {
      status = 'live_wired';
      notes = 'View renders live metric-style content backed by admin APIs.';
    } else if (/FALLBACK_[A-Z_]+/.test(source)) {
      status = 'live_with_fallback';
      notes = 'View uses live API calls but keeps fallback metric constants.';
    }

    return {
      surface: 'admin_kpi',
      screen_or_view: viewName,
      status,
      gap_type: 'kpi_live_data_audit',
      severity: status === 'mock_only' || status === 'stale_artifact_claim' ? 'warning' : 'info',
      method: '',
      path: '',
      backend_matched: /api\.(get|post|put|patch)/.test(source),
      backend_ref: '',
      source_refs: [rel(filePath)],
      notes,
    };
  });

  records.push({
    surface: 'admin_kpi',
    screen_or_view: 'mockKpiData.ts',
    status: 'stale_artifact_claim',
    gap_type: 'unused_mock_inventory',
    severity: 'warning',
    method: '',
    path: '',
    backend_matched: false,
    backend_ref: '',
    source_refs: [rel(mockKpiPath)],
    notes:
      mockKpiReferences.length === 0
        ? 'Mock KPI inventory exists in source but has no active imports in current admin views, so it should not be treated as current dashboard truth.'
        : 'Mock KPI inventory still has active references and should be reviewed before treating admin metrics as fully live.',
  });

  return {
    surface: 'admin_kpi',
    label: 'Admin KPI Audit',
    root: rel(adminAppRoot),
    summary: {
      views: viewFiles.length,
      liveWired: records.filter((record) => record.status === 'live_wired').length,
      liveWithFallback: records.filter((record) => record.status === 'live_with_fallback').length,
      mockOnly: records.filter((record) => record.status === 'mock_only').length,
      staleArtifactClaims: records.filter((record) => record.status === 'stale_artifact_claim')
        .length,
      noExplicitKpiSurface: records.filter((record) => record.status === 'no_explicit_kpi_surface')
        .length,
    },
    records,
  };
}

function buildStalenessAudit({ customerAudit, adminApiAudit, adminKpiAudit }) {
  const findings = [...customerAudit.staleFindings];
  const adminBackendReportPath = path.join(backendRoot, 'artifacts', 'admin_backend_report.md');
  const kpiReportPath = path.join(backendRoot, 'artifacts', 'comprehensive_kpi_report.html');

  if (fs.existsSync(adminBackendReportPath)) {
    const source = read(adminBackendReportPath);
    if (
      /Missing \/ Potential Gaps/.test(source) &&
      adminApiAudit.summary.missingFrontendCalls === 0
    ) {
      findings.push({
        surface: 'staleness',
        screen_or_view: rel(adminBackendReportPath),
        status: 'stale_artifact_claim',
        gap_type: 'stale_report',
        severity: 'warning',
        method: '',
        path: '',
        backend_matched: true,
        backend_ref: '',
        source_refs: [rel(adminBackendReportPath)],
        notes:
          'Older admin completeness markdown still describes missing API gaps even though the current live admin UI scan finds 0 frontend calls missing backend routes.',
      });
    }
  }

  if (fs.existsSync(kpiReportPath)) {
    const source = read(kpiReportPath);
    const dashboardLiveRecord = adminKpiAudit.records.find(
      (record) => record.screen_or_view === 'DashboardView.tsx',
    );
    if (
      /mock objects|simulated mock/i.test(source) &&
      dashboardLiveRecord?.status === 'live_wired'
    ) {
      findings.push({
        surface: 'staleness',
        screen_or_view: rel(kpiReportPath),
        status: 'stale_artifact_claim',
        gap_type: 'stale_report',
        severity: 'warning',
        method: '',
        path: '',
        backend_matched: true,
        backend_ref: '',
        source_refs: [rel(kpiReportPath)],
        notes:
          'Older KPI report still frames the dashboard as mock-driven, but the current DashboardView source is live-wired to /api/v1/admin/dashboard.',
      });
    }
  }

  return {
    surface: 'staleness',
    label: 'Stale Artifact Findings',
    summary: {
      findings: findings.length,
    },
    records: findings,
  };
}

function buildExecutiveSummary({
  backendRoutes,
  customerAudit,
  maidAuditA,
  adminApiAudit,
  adminKpiAudit,
  stalenessAudit,
}) {
  return {
    generatedAt: new Date().toISOString(),
    backendRoutes: backendRoutes.length,
    customerScreens: customerAudit.summary.screens,
    maidScreens: maidAuditA.summary.screens,
    adminViews: adminApiAudit.summary.viewFiles,
    customerRequiredMissing: customerAudit.summary.requiredMissing,
    customerRecommendedMissing: customerAudit.summary.recommendedMissing,
    maidGaps: maidAuditA.summary.gaps,
    adminMissingFrontendCalls: adminApiAudit.summary.missingFrontendCalls,
    adminBackendOnlyRoutes: adminApiAudit.summary.backendOnlyRoutes,
    adminLiveWiredViews: adminKpiAudit.summary.liveWired,
    adminLiveWithFallbackViews: adminKpiAudit.summary.liveWithFallback,
    stalenessFindings: stalenessAudit.summary.findings,
  };
}

function summaryCard(label, value, tone) {
  return `
    <div class="summary-card ${tone}">
      <div class="summary-card-label">${escapeHtml(label)}</div>
      <div class="summary-card-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function formatStatusLabel(status) {
  switch (status) {
    case 'wired_or_service_available':
    case 'matched':
      return 'no_gap';
    case 'missing_backend_route':
    case 'missing':
      return 'missing_api';
    default:
      return status;
  }
}

function renderRecordsTable(records, emptyMessage) {
  if (!records.length) {
    return `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
  }

  const rows = records
    .map(
      (record) => `
    <tr>
      <td>${escapeHtml(record.surface)}</td>
      <td>${escapeHtml(record.screen_or_view)}</td>
      <td><span class="status-pill">${escapeHtml(formatStatusLabel(record.status))}</span></td>
      <td>${escapeHtml(record.gap_type)}</td>
      <td>${escapeHtml(record.severity)}</td>
      <td>${escapeHtml(record.method || '-')}</td>
      <td><code>${escapeHtml(record.path || '-')}</code></td>
      <td>${record.backend_matched ? 'Yes' : 'No'}</td>
      <td>${escapeHtml(record.backend_ref || '-')}</td>
      <td>${escapeHtml((record.source_refs || []).join(', ') || '-')}</td>
      <td>${escapeHtml(record.notes || '-')}</td>
    </tr>
  `,
    )
    .join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Surface</th>
            <th>Screen / View</th>
            <th>Status</th>
            <th>Gap Type</th>
            <th>Severity</th>
            <th>Method</th>
            <th>Path</th>
            <th>Backend Matched</th>
            <th>Backend Ref</th>
            <th>Source Refs</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderScreenSummaryTable(screens) {
  const rows = screens
    .map(
      (screen) => `
    <tr>
      <td>${escapeHtml(screen.screen || screen.name)}</td>
      <td>${escapeHtml(formatStatusLabel(screen.status || (screen.gaps?.length ? 'gap_or_partial' : 'wired_or_service_available')))}</td>
      <td>${escapeHtml(String((screen.endpoints || screen.apis || []).length))}</td>
      <td>${escapeHtml(String((screen.missingApis || screen.gaps || []).length))}</td>
      <td>${escapeHtml(screen.sourceRef)}</td>
      <td>${escapeHtml(screen.purpose || '')}</td>
    </tr>
  `,
    )
    .join('');

  return `
    <div class="table-wrap compact">
      <table>
        <thead>
          <tr>
            <th>Screen</th>
            <th>Status</th>
            <th>Mapped APIs</th>
            <th>Gap Count</th>
            <th>Source Ref</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderAppendixSection(sections) {
  const rows = sections
    .map(
      (section) => `
    <tr>
      <td>${escapeHtml(section.label)}</td>
      <td>${escapeHtml(section.root || '-')}</td>
      <td>${escapeHtml(String(section.summary.screens || section.summary.viewFiles || section.summary.views || 0))}</td>
      <td>${escapeHtml(String(section.summary.endpointDefinitions || section.summary.endpoints || section.summary.frontendCalls || 0))}</td>
      <td>${escapeHtml(JSON.stringify(section.summary))}</td>
    </tr>
  `,
    )
    .join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Surface</th>
            <th>Root</th>
            <th>Screens / Views</th>
            <th>Endpoints / Calls</th>
            <th>Summary JSON</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderHtml(report) {
  const summary = report.executiveSummary;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Zafabit Cross-Surface API and KPI Gap Master Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');

    :root {
      --ink: #12202d;
      --muted: #5b6d7a;
      --line: #d7e1e8;
      --bg: #f4f7f8;
      --accent: #0f766e;
      --accent-soft: #d9f2ef;
      --warning: #b45309;
      --warning-soft: #ffedd5;
      --danger: #b91c1c;
      --danger-soft: #fee2e2;
      --info: #1d4ed8;
      --info-soft: #dbeafe;
      --card: #ffffff;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: 'Outfit', sans-serif;
      color: var(--ink);
      background: linear-gradient(180deg, #eef5f4 0%, #ffffff 20%, #ffffff 100%);
      padding: 36px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .hero {
      background: radial-gradient(circle at top left, #d5f0ea 0%, #ffffff 48%),
        linear-gradient(135deg, #0f766e 0%, #164e63 100%);
      color: var(--ink);
      border-radius: 24px;
      padding: 28px 30px;
      margin-bottom: 28px;
      box-shadow: 0 20px 60px rgba(15, 118, 110, 0.18);
    }

    .eyebrow {
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #285264;
      opacity: 1;
      margin-bottom: 10px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 34px;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }

    .hero h1 {
      color: #12202d;
    }

    .hero p {
      margin: 0;
      max-width: 860px;
      font-size: 15px;
      line-height: 1.6;
      color: #425466;
    }

    h2 {
      margin: 32px 0 12px;
      font-size: 22px;
      letter-spacing: -0.02em;
      border-bottom: 2px solid var(--line);
      padding-bottom: 8px;
    }

    h3 {
      margin: 20px 0 10px;
      font-size: 16px;
    }

    p {
      color: var(--muted);
      line-height: 1.6;
      margin: 0 0 14px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0 6px;
    }

    .summary-card {
      background: var(--card);
      border-radius: 18px;
      padding: 16px 18px;
      border: 1px solid rgba(255,255,255,0.2);
      color: var(--ink);
    }

    .summary-card.info { background: #ffffff; }
    .summary-card.good { background: var(--accent-soft); }
    .summary-card.warn { background: var(--warning-soft); }
    .summary-card.danger { background: var(--danger-soft); }

    .summary-card-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      margin-bottom: 8px;
    }

    .summary-card-value {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }

    .section {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 24px;
      margin-bottom: 20px;
      page-break-inside: avoid;
      box-shadow: 0 10px 40px rgba(18, 32, 45, 0.05);
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 14px;
    }

    .meta-pill {
      border-radius: 999px;
      background: var(--bg);
      border: 1px solid var(--line);
      padding: 8px 12px;
      font-size: 12px;
      color: var(--muted);
    }

    .table-wrap {
      overflow: visible;
      border: 1px solid var(--line);
      border-radius: 16px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10px;
    }

    th, td {
      text-align: left;
      vertical-align: top;
      padding: 8px 9px;
      border-bottom: 1px solid var(--line);
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    th {
      background: #f8fbfb;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--muted);
    }

    tr:last-child td {
      border-bottom: none;
    }

    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      color: #0f3d56;
    }

    .status-pill {
      display: inline-block;
      border-radius: 999px;
      background: var(--info-soft);
      color: var(--info);
      padding: 4px 7px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .empty-state {
      padding: 16px 0 4px;
      color: var(--muted);
    }

    .footnote {
      margin-top: 16px;
      font-size: 12px;
      color: var(--muted);
    }

    @media print {
      body {
        padding: 16px;
      }
      .section, .hero {
        box-shadow: none;
      }
      table {
        font-size: 8.5px;
      }
      th {
        font-size: 8px;
      }
      code {
        font-size: 8px;
      }
    }
  </style>
</head>
<body>
  <section class="hero">
    <div class="eyebrow">Cross-Surface Audit</div>
    <h1>Zafabit API and KPI Gap Master Report</h1>
    <p>
      Consolidated repo-truth audit across the customer app, maid app,
      admin panel API surface, and admin KPI live-data coverage. Generated from current source
      and backend route inventory on ${escapeHtml(summary.generatedAt)}.
    </p>
    <div class="summary-grid">
      ${summaryCard('Backend Routes', summary.backendRoutes, 'info')}
      ${summaryCard('Customer Required Missing', summary.customerRequiredMissing, summary.customerRequiredMissing ? 'danger' : 'good')}
      ${summaryCard('Maid App Gap Endpoints', summary.maidGaps, summary.maidGaps ? 'warn' : 'good')}
      ${summaryCard('Admin Missing UI Calls', summary.adminMissingFrontendCalls, summary.adminMissingFrontendCalls ? 'danger' : 'good')}
      ${summaryCard('Customer Screens', summary.customerScreens, 'info')}
      ${summaryCard('Maid Screens', summary.maidScreens, 'info')}
      ${summaryCard('Admin Backend-only Routes', summary.adminBackendOnlyRoutes, 'warn')}
      ${summaryCard('Stale Findings', summary.stalenessFindings, summary.stalenessFindings ? 'warn' : 'good')}
    </div>
  </section>

  <section class="section">
    <h2>1. Executive Summary</h2>
    <p>
      Current source of truth shows the customer contract has no required missing APIs, the maid app
      still has multiple partial or mock-backed flows despite backend route availability, and the live admin UI route
      scan currently has zero frontend calls missing backend matches.
    </p>
    <p>
      The stale-artifact section highlights older generated files that no longer align with the current source,
      so this master report should be treated as the replacement reference.
    </p>
  </section>

  <section class="section">
    <h2>2. Customer App Screen Audit</h2>
    <div class="meta">
      <div class="meta-pill">Root: ${escapeHtml(report.customerAudit.root)}</div>
      <div class="meta-pill">Screens: ${escapeHtml(String(report.customerAudit.summary.screens))}</div>
      <div class="meta-pill">Required Missing: ${escapeHtml(String(report.customerAudit.summary.requiredMissing))}</div>
      <div class="meta-pill">Recommended Missing: ${escapeHtml(String(report.customerAudit.summary.recommendedMissing))}</div>
    </div>
    <p>
      Contract source is <code>${escapeHtml(rel(path.join(customerAppRoot, 'src', 'api', 'mobileApiContract.ts')))}</code>.
      This audit uses that file as the authority for screen coverage and expected gaps.
    </p>
    ${renderScreenSummaryTable(report.customerAudit.screens)}
    <h3>Gap Records</h3>
    ${renderRecordsTable(
      report.customerAudit.records.filter((record) => record.gap_type === 'missing_api'),
      'No customer gap records.',
    )}
  </section>

  <section class="section">
    <h2>3. Maid App Audit</h2>
    <div class="meta">
      <div class="meta-pill">Root: ${escapeHtml(report.maidAudit.root)}</div>
      <div class="meta-pill">Screens: ${escapeHtml(String(report.maidAudit.summary.screens))}</div>
      <div class="meta-pill">Endpoints: ${escapeHtml(String(report.maidAudit.summary.endpoints))}</div>
      <div class="meta-pill">Gap Endpoints: ${escapeHtml(String(report.maidAudit.summary.gaps))}</div>
    </div>
    <p>${escapeHtml(report.maidAudit.note)}</p>
    ${renderScreenSummaryTable(report.maidAudit.screens)}
    <h3>Gap Records</h3>
    ${renderRecordsTable(
      report.maidAudit.records.filter((record) => record.gap_type === 'partial_or_mock_flow'),
      'No maid app gap records.',
    )}
  </section>

  <section class="section">
    <h2>4. Admin API Audit</h2>
    <div class="meta">
      <div class="meta-pill">Root: ${escapeHtml(report.adminApiAudit.root)}</div>
      <div class="meta-pill">View Files: ${escapeHtml(String(report.adminApiAudit.summary.viewFiles))}</div>
      <div class="meta-pill">Frontend Calls: ${escapeHtml(String(report.adminApiAudit.summary.frontendCalls))}</div>
      <div class="meta-pill">Missing Calls: ${escapeHtml(String(report.adminApiAudit.summary.missingFrontendCalls))}</div>
      <div class="meta-pill">Backend-only Routes: ${escapeHtml(String(report.adminApiAudit.summary.backendOnlyRoutes))}</div>
    </div>
    <p>
      Admin UI route comparison is computed live from <code>zaffabit/src/views</code> against mounted
      Express routes. This section intentionally does not repeat older markdown claims when the current scan disagrees.
    </p>
    ${renderRecordsTable(report.adminApiAudit.records, 'No admin API gap or backend-only records.')}
  </section>

  <section class="section">
    <h2>5. Admin KPI Live-Data Audit</h2>
    <div class="meta">
      <div class="meta-pill">Views: ${escapeHtml(String(report.adminKpiAudit.summary.views))}</div>
      <div class="meta-pill">Live Wired: ${escapeHtml(String(report.adminKpiAudit.summary.liveWired))}</div>
      <div class="meta-pill">Live with Fallback: ${escapeHtml(String(report.adminKpiAudit.summary.liveWithFallback))}</div>
      <div class="meta-pill">Stale Claims: ${escapeHtml(String(report.adminKpiAudit.summary.staleArtifactClaims))}</div>
    </div>
    <p>
      DashboardView is currently live-wired to <code>/api/v1/admin/dashboard</code>. AnalyticsView is live-wired
      but still carries fallback constants. <code>mockKpiData.ts</code> is tracked as unused mock inventory rather
      than active KPI truth when it has no current imports.
    </p>
    ${renderRecordsTable(report.adminKpiAudit.records, 'No admin KPI records.')}
  </section>

  <section class="section">
    <h2>6. Stale Artifact Findings</h2>
    <p>
      These files exist in the repo or artifact directory but no longer line up with current source truth.
      They should be treated as historical outputs, not current audit authority.
    </p>
    ${renderRecordsTable(report.stalenessAudit.records, 'No stale artifact mismatches detected.')}
  </section>

  <section class="section">
    <h2>7. Appendix</h2>
    <p>Per-surface counts and compact evidence summary.</p>
    ${renderAppendixSection([
      report.customerAudit,
      report.maidAudit,
      report.adminApiAudit,
      report.adminKpiAudit,
    ])}
    <div class="footnote">
      Artifacts: <code>${escapeHtml(rel(jsonPath))}</code>,
      <code>${escapeHtml(rel(htmlPath))}</code>,
      <code>${escapeHtml(rel(pdfPath))}</code>
    </div>
  </section>
</body>
</html>`;
}

async function renderPdf() {
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
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 120000 });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' },
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  ensureDir(artifactsDir);

  const backendRoutes = scanBackendRoutes();
  const customerAudit = buildContractAppAudit({
    surface: 'customer_app',
    label: 'Customer App',
    appRoot: customerAppRoot,
    staleDocPath: path.join(customerAppRoot, 'docs', 'mobile-api-gap-report.md'),
    backendRoutes,
  });
  const maidAuditA = buildLegacyMaidAudit({ backendRoutes });
  maidAuditA.label = 'Maid App';
  const adminApiAudit = buildAdminApiAudit({ backendRoutes });
  adminApiAudit.summary.missingFrontendCalls = adminApiAudit.records.filter(
    (record) => record.gap_type === 'frontend_call_without_backend_route',
  ).length;
  adminApiAudit.summary.backendOnlyRoutes = adminApiAudit.records.filter(
    (record) => record.gap_type === 'backend_route_not_used_by_admin_ui',
  ).length;
  const adminKpiAudit = buildAdminKpiAudit();
  const stalenessAudit = buildStalenessAudit({ customerAudit, adminApiAudit, adminKpiAudit });
  stalenessAudit.summary.findings = stalenessAudit.records.length;
  const executiveSummary = buildExecutiveSummary({
    backendRoutes,
    customerAudit,
    maidAuditA,
    adminApiAudit,
    adminKpiAudit,
    stalenessAudit,
  });

  const records = [
    ...customerAudit.records,
    ...maidAuditA.records,
    ...adminApiAudit.records,
    ...adminKpiAudit.records,
    ...stalenessAudit.records,
  ];

  const report = {
    generatedAt: executiveSummary.generatedAt,
    outputs: {
      json: rel(jsonPath),
      html: rel(htmlPath),
      pdf: rel(pdfPath),
    },
    executiveSummary,
    customerAudit,
    maidAudit: maidAuditA,
    adminApiAudit,
    adminKpiAudit,
    stalenessAudit,
    records,
  };
  report.executiveSummary.customerScreens = report.customerAudit.summary.screens;
  report.executiveSummary.maidScreens = report.maidAudit.summary.screens;
  report.executiveSummary.maidGaps = report.maidAudit.summary.gaps;
  report.executiveSummary.customerRequiredMissing = report.customerAudit.summary.requiredMissing;
  report.executiveSummary.customerRecommendedMissing =
    report.customerAudit.summary.recommendedMissing;
  report.executiveSummary.adminMissingFrontendCalls =
    report.adminApiAudit.summary.missingFrontendCalls;
  report.executiveSummary.adminBackendOnlyRoutes = report.adminApiAudit.summary.backendOnlyRoutes;
  report.executiveSummary.stalenessFindings = report.stalenessAudit.summary.findings;

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(htmlPath, renderHtml(report));
  await renderPdf();

  console.log(`Generated ${rel(jsonPath)}`);
  console.log(`Generated ${rel(htmlPath)}`);
  console.log(`Generated ${rel(pdfPath)}`);
}

main().catch((error) => {
  console.error('Failed to generate cross-surface API and KPI gap report:', error);
  process.exitCode = 1;
});
