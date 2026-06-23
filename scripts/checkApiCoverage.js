const fs = require('fs');
const path = require('path');

// Mock any setup needed for requiring app
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/test';

// Route file mappings from src/app.js
const routeMappings = {
  '/api/v1/auth': '../src/routes/authRoutes',
  '/api/v1/customers': '../src/routes/customerRoutes',
  '/api/v1/services': '../src/routes/serviceRoutes',
  '/api/v1/bookings': '../src/routes/bookingRoutes',
  '/api/v1/payments': '../src/routes/paymentRoutes',
  '/api/v1/reviews': '../src/routes/reviewRoutes',
  '/api/v1/support': '../src/routes/supportRoutes',
  '/api/v1/maids': '../src/routes/maidRoutes',
  '/api/v1/admin': '../src/routes/adminRoutes',
  '/api/v1/agents': '../src/routes/agentRoutes',
  '/api/v1/notifications': '../src/routes/notificationRoutes',
  '/api/v1/cart': '../src/routes/cartRoutes',
  '/api/v1/promotions': '../src/routes/promoRoutes',
  '/api/v1/content': '../src/routes/contentRoutes',
  '/api/v1/locations': '../src/routes/locationRoutes',
  '/api/v1/system': '../src/routes/systemRoutes',
};

// Path to customer APIs json
const postmanPath =
  '/Users/renoroy/Desktop/zaffabit new/zaffabit app reactnative/zaffabit customer apis.json';

// Helper to normalize paths for comparison
function normalizePath(routePath) {
  if (!routePath) return '';
  return routePath
    .toLowerCase()
    .replace(/\/+/g, '/') // collapse multiple slashes
    .replace(/\/$/, '') // remove trailing slash
    .replace(/\/:[^/]+/g, '/:param') // replace Express params like :id with :param
    .replace(/\/\{\{[^/]+\}\}/g, '/:param'); // replace Postman variables like {{id}} with :param
}

// Extract routes from router instance
function getRoutesFromRouter(router, basePath) {
  const routes = [];
  if (!router || !router.stack) return routes;

  router.stack.forEach((layer) => {
    if (layer.route) {
      const path = basePath + layer.route.path;
      const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
      methods.forEach((method) => {
        routes.push({ method, path, normalized: `${method} ${normalizePath(path)}` });
      });
    }
  });
  return routes;
}

// Recursively collect Postman items
function collectPostmanEndpoints(items, list = []) {
  for (const item of items) {
    if (item.request) {
      const method = item.request.method.toUpperCase();
      let path = '';
      if (item.request.url && item.request.url.path) {
        path = '/api/v1/' + item.request.url.path.join('/');
      }
      list.push({
        name: item.name,
        method,
        path,
        normalized: `${method} ${normalizePath(path)}`,
        description: item.request.description || '',
      });
    }
    if (item.item) {
      collectPostmanEndpoints(item.item, list);
    }
  }
  return list;
}

function runCheck() {
  console.log('--- STARTING API COVERAGE GAP ANALYSIS ---');

  // 1. Gather all registered routes
  let expressRoutes = [];
  Object.entries(routeMappings).forEach(([basePath, routeFile]) => {
    try {
      const router = require(routeFile);
      const routes = getRoutesFromRouter(router, basePath);
      expressRoutes = expressRoutes.concat(routes);
    } catch (e) {
      console.error(`Failed to load router for ${basePath}:`, e.message);
    }
  });
  console.log(`Loaded ${expressRoutes.length} active routes from routers.`);

  // 2. Load Postman collection
  if (!fs.existsSync(postmanPath)) {
    console.error(`Postman file not found at: ${postmanPath}`);
    return;
  }

  const postmanData = JSON.parse(fs.readFileSync(postmanPath, 'utf8'));
  const postmanEndpoints = collectPostmanEndpoints(postmanData.item);
  console.log(`Loaded ${postmanEndpoints.length} endpoints from Postman collection.\n`);

  const expressNormalizedMap = new Map();
  expressRoutes.forEach((r) => expressNormalizedMap.set(r.normalized, r));

  const matched = [];
  const missing = [];

  // Compare Postman against Express
  postmanEndpoints.forEach((pe) => {
    const isMatched = expressNormalizedMap.has(pe.normalized);
    if (isMatched) {
      matched.push(pe);
    } else {
      missing.push(pe);
    }
  });

  console.log('==================================================================');
  console.log(`MATCHED ENDPOINTS (${matched.length}/${postmanEndpoints.length})`);
  console.log('==================================================================');
  matched.forEach((m) => {
    console.log(`[OK]  ${m.method.padEnd(6)} ${m.path} (${m.name})`);
  });

  console.log('\n==================================================================');
  console.log(`MISSING ENDPOINTS (${missing.length})`);
  console.log('==================================================================');
  if (missing.length === 0) {
    console.log('Perfect! No missing endpoints found.');
  } else {
    missing.forEach((m) => {
      console.log(`[X]   ${m.method.padEnd(6)} ${m.path} (${m.name})`);
    });
  }

  // Optional: Check if there are Express routes that are not in the Postman collection
  const postmanNormalizedSet = new Set(postmanEndpoints.map((pe) => pe.normalized));
  const extraExpress = expressRoutes.filter((er) => !postmanNormalizedSet.has(er.normalized));

  console.log('\n==================================================================');
  console.log(`EXTRA API ENDPOINTS IN EXPRESS ROUTER (${extraExpress.length})`);
  console.log('==================================================================');
  extraExpress.forEach((e) => {
    console.log(`[+]   ${e.method.padEnd(6)} ${e.path}`);
  });

  console.log('\n--- COVERAGE CHECK COMPLETE ---');
}

runCheck();
