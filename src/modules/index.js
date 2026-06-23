const authRoutes = require('../routes/authRoutes');
const customerRoutes = require('../routes/customerRoutes');
const serviceRoutes = require('../routes/serviceRoutes');
const bookingRoutes = require('../routes/bookingRoutes');
const paymentRoutes = require('../routes/paymentRoutes');
const reviewRoutes = require('../routes/reviewRoutes');
const supportRoutes = require('../routes/supportRoutes');
const maidRoutes = require('../routes/maidRoutes');
const adminRoutes = require('../routes/adminRoutes');
const agentRoutes = require('../routes/agentRoutes');
const notificationRoutes = require('../routes/notificationRoutes');
const cartRoutes = require('../routes/cartRoutes');
const promoRoutes = require('../routes/promoRoutes');
const contentRoutes = require('../routes/contentRoutes');
const locationRoutes = require('../routes/locationRoutes');
const systemRoutes = require('../routes/systemRoutes');
const { apiRateLimiter, authRateLimiter } = require('../middleware/rateLimiter');

const API_PREFIX = '/api/v1';

const modules = [
  {
    name: 'auth',
    basePath: '/auth',
    router: authRoutes,
    rateLimiter: authRateLimiter,
    owner: 'shared',
    capabilities: ['jwt', 'otp', 'session', 'role-access'],
  },
  {
    name: 'customer',
    basePath: '/customers',
    router: customerRoutes,
    owner: 'customer',
    capabilities: ['profile', 'addresses', 'wallet', 'referrals', 'notifications'],
  },
  {
    name: 'serviceCatalog',
    basePath: '/services',
    router: serviceRoutes,
    owner: 'shared',
    capabilities: ['service-listing', 'pricing', 'availability-inputs'],
  },
  {
    name: 'booking',
    basePath: '/bookings',
    router: bookingRoutes,
    owner: 'shared',
    capabilities: ['booking-create', 'dispatch', 'tracking', 'status-workflow', 'history'],
  },
  {
    name: 'payment',
    basePath: '/payments',
    router: paymentRoutes,
    owner: 'shared',
    capabilities: ['payment-initiation', 'verification', 'refunds', 'settlement'],
  },
  {
    name: 'review',
    basePath: '/reviews',
    router: reviewRoutes,
    owner: 'shared',
    capabilities: ['ratings', 'reviews', 'feedback'],
  },
  {
    name: 'support',
    basePath: '/support',
    router: supportRoutes,
    owner: 'shared',
    capabilities: ['tickets', 'complaints', 'chat', 'help'],
  },
  {
    name: 'maid',
    basePath: '/maids',
    router: maidRoutes,
    owner: 'maid',
    capabilities: ['profile', 'documents', 'availability', 'jobs', 'earnings', 'onboarding'],
  },
  {
    name: 'admin',
    basePath: '/admin',
    router: adminRoutes,
    owner: 'admin',
    capabilities: ['dashboard', 'users', 'maid-verification', 'booking-management', 'reports'],
  },
  {
    name: 'agent',
    basePath: '/agents',
    router: agentRoutes,
    owner: 'operations',
    capabilities: ['field-operations'],
  },
  {
    name: 'notification',
    basePath: '/notifications',
    router: notificationRoutes,
    owner: 'shared',
    capabilities: ['push', 'sms-email-hooks', 'inbox'],
  },
  {
    name: 'cart',
    basePath: '/cart',
    router: cartRoutes,
    owner: 'customer',
    capabilities: ['cart-items', 'checkout-prep'],
  },
  {
    name: 'promotion',
    basePath: '/promotions',
    router: promoRoutes,
    owner: 'shared',
    capabilities: ['promo-codes', 'discounts'],
  },
  {
    name: 'content',
    basePath: '/content',
    router: contentRoutes,
    owner: 'shared',
    capabilities: ['home-content', 'cms', 'localization'],
  },
  {
    name: 'location',
    basePath: '/locations',
    router: locationRoutes,
    owner: 'shared',
    capabilities: ['search', 'serviceability', 'geo'],
  },
  {
    name: 'system',
    basePath: '/system',
    router: systemRoutes,
    owner: 'platform',
    capabilities: ['health', 'legal', 'dispatch-metrics'],
  },
];

const getModuleMountPath = (moduleDefinition) => `${API_PREFIX}${moduleDefinition.basePath}`;

const assertUniqueModuleMounts = () => {
  const seen = new Set();

  for (const moduleDefinition of modules) {
    const mountPath = getModuleMountPath(moduleDefinition);

    if (seen.has(mountPath)) {
      throw new Error(`Duplicate API module mount path: ${mountPath}`);
    }

    seen.add(mountPath);
  }
};

const registerApiModules = (app) => {
  assertUniqueModuleMounts();
  app.use(API_PREFIX, apiRateLimiter);

  for (const moduleDefinition of modules) {
    const handlers = moduleDefinition.rateLimiter
      ? [moduleDefinition.rateLimiter, moduleDefinition.router]
      : [moduleDefinition.router];

    app.use(getModuleMountPath(moduleDefinition), ...handlers);
  }
};

module.exports = {
  API_PREFIX,
  modules,
  getModuleMountPath,
  registerApiModules,
};
