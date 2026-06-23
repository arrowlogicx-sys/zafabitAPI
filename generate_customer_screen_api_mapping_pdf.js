const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const backendRoot = __dirname;
const workspaceRoot = path.resolve(backendRoot, '..');
const customerAppRoot = path.join(workspaceRoot, 'zaffabit app reactnative', 'ZaffabitApp');
const appSrcRoot = path.join(customerAppRoot, 'src');
const artifactsDir = path.join(backendRoot, 'artifacts');
const reportWorkDir = path.join(artifactsDir, 'customer_screen_api_mapping');
const pdfPath = path.join(artifactsDir, 'SCREEN_API_MAPPING.pdf');
const htmlPath = path.join(artifactsDir, 'SCREEN_API_MAPPING.html');
const emulatorHomeShot = path.join(reportWorkDir, 'screenshots', 'emulator-current.png');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
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

function lineOf(source, needle) {
  const index = source.indexOf(needle);
  if (index < 0) return undefined;
  return source.slice(0, index).split(/\r?\n/).length;
}

function lineRefs(filePath, patterns) {
  if (!fs.existsSync(filePath)) return [];
  const source = read(filePath);
  return patterns.flatMap((pattern) => {
    const lines = [];
    source.split(/\r?\n/).forEach((line, index) => {
      const matched = pattern instanceof RegExp ? pattern.test(line) : line.includes(pattern);
      if (matched) {
        lines.push(`${rel(filePath)}:${index + 1}`);
      }
    });
    return lines;
  });
}

function firstLineRef(filePath, patterns) {
  return lineRefs(filePath, patterns)[0];
}

function normalizeRoute(routePath) {
  return routePath
    .replace(/\?.*$/, '')
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

function parseEndpointDefinitions() {
  const apiPath = path.join(appSrcRoot, 'api', 'mobileApi.ts');
  const source = read(apiPath);
  const endpoints = new Map();
  const pattern = /\{\s*key:\s*'([^']+)',\s*method:\s*'([^']+)',\s*path:\s*'([^']+)',\s*screens:\s*\[([^\]]*)\],\s*purpose:\s*'([^']+)'\s*\}/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1];
    const method = match[2];
    const endpointPath = match[3];
    const screens = [...match[4].matchAll(/'([^']+)'/g)].map((item) => item[1]);
    const purpose = match[5];
    const line = lineOf(source, `key: '${key}'`);
    endpoints.set(key, {
      key,
      method,
      path: endpointPath,
      screens,
      purpose,
      sourceRef: `${rel(apiPath)}:${line}`,
    });
  }
  return endpoints;
}

function parseMountedRouteBases() {
  const appPath = path.join(backendRoot, 'src', 'app.js');
  const source = read(appPath);
  const bases = {};
  for (const match of source.matchAll(/app\.use\(['"]([^'"]+)['"],\s*require\(['"]\.\/routes\/([^'"]+)['"]\)\)/g)) {
    bases[`${match[2]}.js`] = match[1];
  }
  return bases;
}

function scanBackendRoutes() {
  const routeDir = path.join(backendRoot, 'src', 'routes');
  const bases = parseMountedRouteBases();
  const routes = [];
  for (const routeFile of fs.readdirSync(routeDir).filter((file) => file.endsWith('Routes.js')).sort()) {
    const filePath = path.join(routeDir, routeFile);
    const source = read(filePath);
    const lines = source.split(/\r?\n/);
    const base = bases[routeFile] || '';
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
      const roleMatch = line.match(/restrictTo\(([^)]+)\)/);
      routes.push({
        method,
        path: routePath,
        normalizedPath: normalizeRoute(routePath),
        file: rel(filePath),
        line: lineNo,
        auth: protectedByUse || protectedInline ? 'Bearer JWT required' : 'Public endpoint',
        role: roleMatch ? roleMatch[1].replace(/['"]/g, '') : '',
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

function findRoute(routes, endpoint) {
  const candidate = withApiPrefix(endpoint.path);
  return routes.find((route) =>
    route.method === endpoint.method &&
    routeToRegex(route.normalizedPath).test(normalizeRoute(candidate)),
  );
}

const endpointDetails = {
  'auth.sendOtp': {
    request: 'JSON body: phone, optional language.',
    query: '-',
    response: 'data.phone, data.otp inside the common response envelope.',
    errors: '400 VALIDATION_ERROR when phone is missing.',
  },
  'auth.verifyOtp': {
    request: 'JSON body: phone, otp.',
    query: '-',
    response: 'data.token and data.user profile/auth fields.',
    errors: '400 VALIDATION_ERROR, 400 INVALID_REQUEST, 403 ACCOUNT_BLOCKED.',
  },
  'auth.updateLanguage': {
    request: 'JSON body: language. Request includes locale header with the same selected code.',
    query: '-',
    response: 'Localized message such as Language updated successfully plus data.language and data.locale.',
    errors: '400 VALIDATION_ERROR when language is not one of en, ml, hi, ta.',
  },
  'auth.updateProfile': {
    request: 'JSON body: firstName, lastName, email, name, optional language for authenticated users.',
    query: '-',
    response: 'data.user.',
    errors: '401 auth failure, 404 NOT_FOUND.',
  },
  'auth.logout': {
    request: '-',
    query: '-',
    response: 'success/message only.',
    errors: '401 auth failure.',
  },
  'auth.deleteMe': {
    request: '-',
    query: '-',
    response: 'success/message only.',
    errors: '401 auth failure, 404 NOT_FOUND.',
  },
  'auth.updatePushToken': {
    request: 'JSON body: pushToken.',
    query: '-',
    response: 'data.pushToken.',
    errors: '400 VALIDATION_ERROR, 401 auth failure, 404 NOT_FOUND.',
  },
  'customer.profile': {
    request: '-',
    query: '-',
    response: 'data.user populated with customerProfile.',
    errors: '401 auth failure.',
  },
  'customer.updateProfile': {
    request: 'JSON body: firstName, lastName, email, phone.',
    query: '-',
    response: 'data.user.',
    errors: '401 auth failure, validation errors from model.',
  },
  'customer.addresses': {
    request: '-',
    query: '-',
    response: 'data.addresses[].',
    errors: '401 auth failure.',
  },
  'customer.addAddress': {
    request: 'JSON address body: title/label, houseName, street, landmark, city, pincode, phone, latitude, longitude, isDefault.',
    query: '-',
    response: 'data.addresses[].',
    errors: '401 auth failure, 404 NOT_FOUND if user is missing.',
  },
  'customer.updateAddress': {
    request: 'JSON address patch body.',
    query: '-',
    response: 'data.address.',
    errors: '401 auth failure, 404 NOT_FOUND.',
  },
  'customer.deleteAddress': {
    request: '-',
    query: '-',
    response: 'data.addresses[].',
    errors: '401 auth failure.',
  },
  'customer.propertyProfile': {
    request: '-',
    query: '-',
    response: 'data.propertyProfile.',
    errors: '401 auth failure.',
  },
  'customer.savePropertyProfile': {
    request: 'JSON body: property profile fields such as homeType, bhkType, memberCount, hasPets, petTemperament.',
    query: '-',
    response: 'data.propertyProfile.',
    errors: '401 auth failure.',
  },
  'customer.wallet': {
    request: '-',
    query: '-',
    response: 'data.balance, data.transactions[], data.rewardPoints.',
    errors: '401 auth failure.',
  },
  'customer.addMoney': {
    request: 'JSON body: amount.',
    query: '-',
    response: 'data.walletBalance, data.transactions[].',
    errors: '400 VALIDATION_ERROR, 401 auth failure, 404 NOT_FOUND.',
  },
  'customer.referral': {
    request: '-',
    query: '-',
    response: 'data.referralCode, data.invited, data.joined, data.earned.',
    errors: '401 auth failure, 404 NOT_FOUND.',
  },
  'customer.applyReferral': {
    request: 'JSON body: code or referralCode.',
    query: '-',
    response: 'data.newBalance, data.message.',
    errors: '400 VALIDATION_ERROR, 400 CONFLICT, 400 INVALID_REQUEST, 404 NOT_FOUND.',
  },
  'customer.supportInfo': {
    request: '-',
    query: '-',
    response: 'data support/safety fields.',
    errors: '401 auth failure.',
  },
  'content.banners': {
    request: '-',
    query: 'optional all=true is supported by backend; app does not pass it.',
    response: 'data.banners[], data.greeting.',
    errors: 'Backend route is public; app may include Bearer header if token exists.',
  },
  'content.splash': {
    request: '-',
    query: 'optional all=true is supported by backend/admin; app does not pass it.',
    response: 'data.splash[] with title, subtitle, imageUrl, ctaLabel, isActive, order.',
    errors: 'Backend route is public.',
  },
  'content.featuredServices': {
    request: '-',
    query: 'optional all=true is supported by backend; app does not pass it.',
    response: 'data.featured[].',
    errors: 'Backend route is public.',
  },
  'services.list': {
    request: '-',
    query: 'page, limit, category, search, all.',
    response: 'data.services[], meta.pagination.',
    errors: 'Backend route is public.',
  },
  'services.detail': {
    request: '-',
    query: '-',
    response: 'data.service.',
    errors: '404 NOT_FOUND.',
  },
  'services.estimate': {
    request: '-',
    query: 'items, bhkType, frequency, surface.',
    response: 'data estimated time fields.',
    errors: '400 VALIDATION_ERROR.',
  },
  'services.policy': {
    request: '-',
    query: '-',
    response: 'data cancellation/refund policy.',
    errors: 'Backend route is public.',
  },
  'cart.get': {
    request: '-',
    query: '-',
    response: 'data.cart, data.billDetails.',
    errors: '401 auth failure.',
  },
  'cart.addItems': {
    request: 'JSON body: single item, items[], or array. Each item requires serviceId and optional duration.',
    query: '-',
    response: 'data.cart, data.billDetails.',
    errors: '400 VALIDATION_ERROR, 404 NOT_FOUND.',
  },
  'cart.updateItem': {
    request: 'JSON body: duration.',
    query: '-',
    response: 'data.cart, data.billDetails.',
    errors: '404 NOT_FOUND.',
  },
  'cart.clear': {
    request: '-',
    query: '-',
    response: 'data.cart and zeroed billDetails.',
    errors: '401 auth failure.',
  },
  'bookings.availableSlots': {
    request: '-',
    query: '-',
    response: 'data.dates[], data.slots[].',
    errors: '401 auth failure.',
  },
  'bookings.instantAvailability': {
    request: 'JSON body: lat/lng or latitude/longitude plus estimatedDurationMinutes.',
    query: '-',
    response: 'data.count, data.maids[], data.message.',
    errors: '401 auth failure.',
  },
  'bookings.create': {
    request: 'JSON booking body with serviceId or items, address/addressId, scheduleDate, bookingType, location.',
    query: '-',
    response: 'data.booking.',
    errors: '400 VALIDATION_ERROR, 404 NOT_FOUND.',
  },
  'bookings.fromCart': {
    request: 'JSON body: scheduleDate, bookingType, address/addressId, propertyProfile, location.',
    query: '-',
    response: 'data.booking.',
    errors: '400 VALIDATION_ERROR, 404 NOT_FOUND.',
  },
  'bookings.list': {
    request: '-',
    query: 'status, page, limit.',
    response: 'data.bookings[], meta.pagination.',
    errors: '401 auth failure.',
  },
  'bookings.detail': {
    request: '-',
    query: '-',
    response: 'data.booking.',
    errors: '401 auth failure, 403 FORBIDDEN, 404 NOT_FOUND.',
  },
  'bookings.cancel': {
    request: 'Optional JSON body for cancellation reason.',
    query: '-',
    response: 'data.booking, refund metadata when applicable.',
    errors: '403 FORBIDDEN, 400 INVALID_REQUEST, 404 NOT_FOUND.',
  },
  'bookings.approveExtraTime': {
    request: 'JSON body: approved true/false.',
    query: '-',
    response: 'data.booking and approval/rejection status.',
    errors: '400 VALIDATION_ERROR, 403 FORBIDDEN, 404 NOT_FOUND.',
  },
  'bookings.estimate': {
    request: 'JSON body: serviceId or items, propertyProfile, duration.',
    query: '-',
    response: 'data estimated duration/amount fields.',
    errors: '400 VALIDATION_ERROR, 404 NOT_FOUND.',
  },
  'bookings.tracking': {
    request: '-',
    query: '-',
    response: 'data tracking fields such as lat, lng, distance, status.',
    errors: '401 auth failure, 404 NOT_FOUND.',
  },
  'payments.initiate': {
    request: 'JSON body: bookingId, optional method.',
    query: '-',
    response: 'data.order, data.paymentId.',
    errors: '400 VALIDATION_ERROR, 403 FORBIDDEN, 404 NOT_FOUND.',
  },
  'payments.verify': {
    request: 'JSON body: paymentId/order/payment signature fields.',
    query: '-',
    response: 'data.payment and optional dispatch result.',
    errors: '400 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND.',
  },
  'promotions.validate': {
    request: 'JSON body: code, bookingAmount.',
    query: '-',
    response: 'data.discountAmount and promo details.',
    errors: '400 VALIDATION_ERROR, 400 INVALID_CODE, 400 EXPIRED_CODE, 400 LIMIT_REACHED, 404 NOT_FOUND.',
  },
  'reviews.submit': {
    request: 'JSON body: bookingId, rating, review, tags.',
    query: '-',
    response: 'data.review.',
    errors: '400 INVALID_REQUEST, 400 VALIDATION_ERROR, 404 NOT_FOUND.',
  },
  'reviews.raiseIssue': {
    request: 'JSON body: bookingId, issueDescription.',
    query: '-',
    response: 'data.issue.',
    errors: '400 VALIDATION_ERROR, 404 NOT_FOUND.',
  },
  'reviews.maid': {
    request: '-',
    query: 'page, limit, sentiment.',
    response: 'data reviews for maid.',
    errors: '401 auth failure.',
  },
  'support.helplines': {
    request: '-',
    query: '-',
    response: 'data helpline numbers.',
    errors: '401 auth failure.',
  },
  'support.contact': {
    request: 'JSON body: subject, message.',
    query: '-',
    response: 'success/message only.',
    errors: '401 auth failure.',
  },
  'support.sos': {
    request: 'Optional JSON body with booking/location context.',
    query: '-',
    response: 'data incident/SOS acknowledgement.',
    errors: '401 auth failure.',
  },
  'support.aiChat': {
    request: 'JSON body: message.',
    query: '-',
    response: 'data.response from backend controller.',
    errors: '400 VALIDATION_ERROR, 401 auth failure.',
  },
  'locations.serviceability': {
    request: '-',
    query: 'lat, lon, pincode.',
    response: 'data.serviceable plus city/pincode/area details.',
    errors: '401 auth failure.',
  },
  'locations.search': {
    request: '-',
    query: 'q.',
    response: 'data[] location suggestions.',
    errors: '401 auth failure.',
  },
};

const file = {
  auth: path.join(appSrcRoot, 'screens', 'AuthScreens.tsx'),
  main: path.join(appSrcRoot, 'screens', 'MainScreens.tsx'),
  booking: path.join(appSrcRoot, 'screens', 'BookingScreens.tsx'),
  profile: path.join(appSrcRoot, 'screens', 'ProfileScreens.tsx'),
  store: path.join(appSrcRoot, 'store', 'AppStore.tsx'),
  api: path.join(appSrcRoot, 'api', 'mobileApi.ts'),
  client: path.join(appSrcRoot, 'api', 'client.ts'),
  navigator: path.join(appSrcRoot, 'navigation', 'AppNavigator.tsx'),
};

const screenFiles = {
  Splash: { file: file.auth, fn: 'SplashScreen' },
  Login: { file: file.auth, fn: 'LoginScreen' },
  LoginError: { file: file.auth, fn: 'LoginErrorScreen' },
  OTP: { file: file.auth, fn: 'OtpScreen' },
  OTPError: { file: file.auth, fn: 'OtpErrorScreen' },
  Name: { file: file.auth, fn: 'NameScreen' },
  Language: { file: file.auth, fn: 'LanguageScreen' },
  Location: { file: file.auth, fn: 'LocationScreen' },
  LocationSearch: { file: file.auth, fn: 'LocationSearchScreen' },
  LocationNotFound: { file: file.auth, fn: 'LocationNotFoundScreen' },
  AddressDetails: { file: file.auth, fn: 'AddressDetailsScreen' },
  CustomHomeDetails: { file: file.auth, fn: 'CustomHomeDetailsScreen' },
  OtherHomeDetails: { file: file.auth, fn: 'OtherHomeDetailsScreen' },
  HomeTab: { file: file.main, fn: 'HomeScreen' },
  BookingsTab: { file: file.main, fn: 'BookingHistoryScreen' },
  WalletTab: { file: file.main, fn: 'WalletScreen' },
  ServiceList: { file: file.booking, fn: 'ServiceListScreen' },
  ServiceDetails: { file: file.booking, fn: 'ServiceDetailsScreen' },
  ServiceReview: { file: file.booking, fn: 'ServiceReviewScreen' },
  HourlyServices: { file: file.booking, fn: 'HourlyServicesScreen' },
  Cart: { file: file.booking, fn: 'CartScreen' },
  AddMoreServices: { file: file.booking, fn: 'AddMoreServicesScreen' },
  Schedule: { file: file.booking, fn: 'ScheduleScreen' },
  InstantSchedule: { file: file.booking, fn: 'InstantScheduleScreen' },
  OneHourSchedule: { file: file.booking, fn: 'OneHourScheduleScreen' },
  BookingSummary: { file: file.booking, fn: 'BookingSummaryScreen' },
  BillDetails: { file: file.booking, fn: 'BillDetailsScreen' },
  PaymentSuccess: { file: file.booking, fn: 'PaymentSuccessScreen' },
  PaymentFailed: { file: file.booking, fn: 'PaymentFailedScreen' },
  LiveTracking: { file: file.booking, fn: 'LiveTrackingScreen' },
  Profile: { file: file.profile, fn: 'ProfileScreen' },
  EditProfile: { file: file.profile, fn: 'EditProfileScreen' },
  SavedAddresses: { file: file.profile, fn: 'SavedAddressesScreen' },
  EditAddress: { file: file.profile, fn: 'EditAddressScreen' },
  UpdateHomeAddress: { file: file.profile, fn: 'UpdateHomeAddressScreen' },
  Refer: { file: file.profile, fn: 'ReferScreen' },
  AddMoney: { file: file.profile, fn: 'AddMoneyScreen' },
  PrivacyPolicy: { file: file.profile, fn: 'PrivacyPolicyScreen' },
  Terms: { file: file.profile, fn: 'TermsScreen' },
  ReportIssue: { file: file.profile, fn: 'ReportIssueScreen' },
  SOS: { file: file.profile, fn: 'SosScreen' },
  Logout: { file: file.profile, fn: 'LogoutScreen' },
  ConfirmDeleteAccount: { file: file.profile, fn: 'ConfirmDeleteAccountScreen' },
  AIChat: { file: file.profile, fn: 'AiChatScreen' },
  AIChatConversation: { file: file.profile, fn: 'AiChatConversationScreen' },
};

function screenshot(name) {
  return path.join(customerAppRoot, 'img', name);
}

function usage(apiKey, component, requestField, responseField, description, sourceType = 'direct') {
  return { apiKey, component, requestField, responseField, description, sourceType };
}

const screens = [
  {
    name: 'Splash',
    display: 'Splash',
    screenshot: screenshot('splash.png'),
    purpose: 'Initial brand screen and entry point into onboarding. Admin-managed splash content can replace the bundled fallback image.',
    navigation: 'Get Started -> Language.',
    usages: [
      usage('content.splash', 'Splash background image', '-', 'data.splash[].imageUrl', 'Loads active splash artwork/content managed from the admin App Content Manager. Falls back to bundled splash.png if unavailable.'),
    ],
    validation: 'No form validation. Backend content fetch failure keeps the local fallback image.',
  },
  {
    name: 'Language',
    display: 'Language Selection',
    screenshot: screenshot('language.png'),
    purpose: 'Captures preferred language before OTP flow.',
    navigation: 'Continue -> Login; Back -> Name.',
    usages: [
      usage('auth.updateLanguage', 'Continue button', 'language + locale header', 'data.language, data.locale', 'Saves selected API response locale before OTP using the public language endpoint.'),
    ],
    validation: 'One language is selected in local context; API failures are logged and the flow still continues to Login. The selected code is also sent later through sendOtp.',
  },
  {
    name: 'Login',
    display: 'Login',
    screenshot: screenshot('login.png'),
    purpose: 'Collects mobile number and requests an OTP.',
    navigation: 'Send OTP -> OTP; invalid phone -> LoginError; Back -> Language.',
    usages: [
      usage('auth.sendOtp', 'Mobile number form / Send OTP button', 'phone, language', 'data.phone, data.otp', 'Requests OTP for the entered Indian mobile number.'),
      usage('auth.sendOtp', 'Send OTP on WhatsApp button', 'phone, language, channel=whatsapp', 'data.phone, data.otp', 'Requests OTP through the WhatsApp action using the same backend endpoint.'),
    ],
    validation: 'Digits are normalized; numbers shorter than 10 digits route to LoginError without API call.',
  },
  {
    name: 'LoginError',
    display: 'Login Error',
    screenshot: screenshot('login - Error.png'),
    purpose: 'Shows invalid phone state and lets the user retry OTP request.',
    navigation: 'Send OTP -> OTP when valid; Back -> Language.',
    usages: [
      usage('auth.sendOtp', 'Retry phone form', 'phone, language', 'data.phone, data.otp', 'Same OTP request as Login, displayed with validation error state.'),
    ],
    validation: 'Requires 10 normalized phone digits.',
  },
  {
    name: 'OTP',
    display: 'OTP Verification',
    screenshot: screenshot('otp.png'),
    purpose: 'Verifies OTP and stores JWT/profile data.',
    navigation: 'Verify success -> Name or MainTabs; failure -> OTPError.',
    usages: [
      usage('auth.verifyOtp', 'OTP input / Verify Code', 'phone, otp', 'data.token, data.user', 'Verifies OTP, updates app auth token, and hydrates profile state.'),
      usage('auth.updatePushToken', 'Post-login push token registration', 'pushToken', 'data.pushToken', 'Registers a placeholder device token after explicit OTP verification succeeds.'),
    ],
    validation: 'OTP must contain 6 digits before explicit verification.',
    gaps: ['The TextInput 6-digit auto-submit branch verifies OTP but does not call auth.updatePushToken; only the explicit Verify Code path registers the push token.'],
  },
  {
    name: 'OTPError',
    display: 'OTP Error',
    screenshot: screenshot('otp - Error.png'),
    purpose: 'Shows invalid OTP state and lets the user retry verification.',
    navigation: 'Verify success -> Name; resend/reset -> OTP.',
    usages: [
      usage('auth.verifyOtp', 'Retry OTP input', 'phone, otp', 'data.token, data.user', 'Retries OTP verification after a failed attempt.'),
    ],
    validation: 'OTP is sanitized to numeric digits and capped at 6 digits.',
  },
  {
    name: 'Name',
    display: 'Name Entry',
    screenshot: screenshot('name.png'),
    purpose: 'Collects first and last name after OTP verification.',
    navigation: 'Continue -> Location.',
    usages: [
      usage('auth.updateProfile', 'Firstname / Lastname fields', 'firstName, lastName', 'data.user', 'Persists profile name against the authenticated user.'),
    ],
    validation: 'No blocking validation; empty names are allowed by current UI.',
  },
  {
    name: 'Location',
    display: 'Location Confirmation',
    screenshot: screenshot('location.png'),
    purpose: 'Finds current location, displays static map, and checks serviceability.',
    navigation: 'Search box -> LocationSearch; serviceable -> AddressDetails; not serviceable -> LocationNotFound.',
    usages: [
      usage('locations.serviceability', 'Confirm Location button', 'query: lat, lon, pincode', 'data.serviceable, city, pincode, area', 'Checks backend service availability for selected coordinates/pincode.'),
      usage('external.ipGeo', 'Use Current Location button', '-', 'latitude, longitude, city, postal, region', 'Uses external IP geolocation fallbacks: ipapi.co, freeipapi.com, ipinfo.io.', 'external'),
      usage('external.staticMap', 'Map image', 'lat, lon, zoom', 'map image', 'Renders Yandex static map for location preview.', 'external'),
    ],
    validation: 'Falls back to Kochi/Kakkanad coordinates if external location providers fail.',
  },
  {
    name: 'LocationSearch',
    display: 'Location Search',
    screenshot: screenshot('location Search.png'),
    purpose: 'Searches known service areas and returns location suggestions.',
    navigation: 'Suggestion -> Location; not found state -> LocationNotFound.',
    usages: [
      usage('locations.search', 'Search field / results list', 'query: q', 'data[] locations', 'Debounced backend search for area or pincode suggestions.'),
    ],
    validation: 'Blank search clears results and does not call backend.',
  },
  {
    name: 'LocationNotFound',
    display: 'Location Not Found',
    screenshot: screenshot('location not found.png'),
    purpose: 'Unsupported location state after serviceability failure.',
    navigation: 'Try Another Location -> LocationSearch; Back -> Location.',
    usages: [],
    validation: 'No form validation.',
  },
  {
    name: 'AddressDetails',
    display: 'Address Details',
    screenshot: screenshot('Update Home Address.png'),
    purpose: 'Collects home address and saves it for bookings.',
    navigation: 'Continue -> CustomHomeDetails.',
    usages: [
      usage('customer.addAddress', 'Address form / Continue button', 'address fields', 'data.addresses[]', 'Saves address to backend and local context.'),
    ],
    validation: 'Fallback values are inserted for house, area, city, pincode when fields are blank.',
  },
  {
    name: 'CustomHomeDetails',
    display: 'Home Details',
    screenshot: screenshot('details.png'),
    purpose: 'Captures home type, BHK size, members, and pet details for estimates.',
    navigation: 'Continue -> MainTabs/HomeTab; Other/Add -> OtherHomeDetails.',
    usages: [
      usage('customer.savePropertyProfile', 'Home profile form / Continue', 'homeType, bhkType, memberCount, hasPets, petTemperament', 'data.propertyProfile', 'Persists property details for future estimate and booking context.'),
    ],
    validation: 'Member count cannot go below 1; pet temperament is sent only when pets are selected.',
  },
  {
    name: 'OtherHomeDetails',
    display: 'Custom Home Details',
    screenshot: screenshot('details -custom home.png'),
    purpose: 'Captures custom home type/name/size.',
    navigation: 'Save -> MainTabs/HomeTab.',
    usages: [],
    validation: 'No backend call in current screen.',
    gaps: ['Custom home details are local/navigation state only; they are not persisted to customer.propertyProfile in this screen.'],
  },
  {
    name: 'HomeTab',
    display: 'Home',
    screenshot: fs.existsSync(emulatorHomeShot) ? emulatorHomeShot : screenshot('Home.png'),
    screenshotSource: fs.existsSync(emulatorHomeShot) ? 'Fresh emulator capture' : 'Provided screenshot asset',
    purpose: 'Primary customer landing screen with hero banners, service browsing, scheduling entry points, and cart status.',
    navigation: 'Get Started/View All/Search -> ServiceList; service card -> ServiceDetails; schedule cards -> Schedule/InstantSchedule/OneHourSchedule; avatar -> Profile; cart -> Cart.',
    usages: [
      usage('content.banners', 'Hero carousel and greeting', '-', 'data.banners[], data.greeting', 'Displays backend-managed hero content.', 'store-auto-load'),
      usage('content.featuredServices', 'Our Services cards', '-', 'data.featured[]', 'Displays backend-managed featured services.', 'store-auto-load'),
      usage('services.list', 'Service catalog cards', 'query: limit=100', 'data.services[]', 'Hydrates fallback service list and service navigation targets.', 'store-auto-load'),
      usage('cart.get', 'Cart shortcut/count', '-', 'data.cart.serviceCart[]', 'Shows current cart count after auth.', 'store-auto-load'),
      usage('customer.profile', 'Greeting/profile shortcut', '-', 'data.user', 'Hydrates customer name/greeting after auth.', 'store-auto-load'),
    ],
    validation: 'Shows empty/fallback content if public data cannot load.',
  },
  {
    name: 'BookingsTab',
    display: 'Booking History',
    screenshot: screenshot('booking history.png'),
    purpose: 'Displays historical and active bookings.',
    navigation: 'Tracking button -> LiveTracking; tab nav -> Home/Wallet.',
    usages: [
      usage('bookings.list', 'Booking cards/list', 'query: limit=50', 'data.bookings[]', 'Loads booking history into app store.', 'store-auto-load'),
    ],
    validation: 'Empty state appears when no backend bookings are loaded.',
  },
  {
    name: 'WalletTab',
    display: 'Wallet',
    screenshot: screenshot('wallet.png'),
    purpose: 'Displays wallet balance, reward points, transactions, and referral entry point.',
    navigation: 'Add Money -> AddMoney; Refer -> Refer.',
    usages: [
      usage('customer.wallet', 'Balance, points, transaction list', '-', 'data.balance, data.rewardPoints, data.transactions[]', 'Hydrates wallet data after auth.', 'store-auto-load'),
      usage('customer.referral', 'Referral summary', '-', 'data.referralCode, invited, joined, earned', 'Hydrates referral stats used across wallet/refer screens.', 'store-auto-load'),
    ],
    validation: 'Displays zero/empty values if wallet API has no data.',
    gaps: ['Redeem action has no backend endpoint in current routes.'],
  },
  {
    name: 'ServiceList',
    display: 'Service List',
    screenshot: screenshot('service.png'),
    purpose: 'Lists backend service catalog and routes to selected service detail.',
    navigation: 'Service tile -> ServiceDetails; Back -> previous screen.',
    usages: [
      usage('services.list', 'Service tiles', 'query: limit=100', 'data.services[]', 'Services are loaded by AppStore and consumed by this screen.', 'store-auto-load'),
      usage('cart.addItems', 'Service tile add action', 'serviceId, quantity', 'data.cart, data.billDetails', 'Syncs selected service into the backend cart before navigating to details.'),
    ],
    validation: 'Shows empty backend data message when no services are loaded.',
  },
  {
    name: 'ServiceDetails',
    display: 'Service Details',
    screenshot: screenshot('service details.png'),
    purpose: 'Shows selected service detail, inclusion/exclusion lists, process, FAQs, and add-to-cart CTA.',
    navigation: 'Add to Cart -> Cart; Back -> previous screen.',
    usages: [
      usage('services.detail', 'Service detail view', 'path: serviceId', 'data.service', 'Refreshes selected service detail from backend.'),
      usage('services.list', 'Initial service fallback', 'query: limit=100', 'data.services[]', 'Uses store-loaded services while detail refresh runs.', 'store-auto-load'),
      usage('cart.addItems', 'Add to Cart CTA', 'serviceId, quantity', 'data.cart, data.billDetails', 'Adds the displayed service to backend cart before navigating to Cart.'),
    ],
    validation: 'Skips network detail fetch in test environment; empty state shown when no service is available.',
  },
  {
    name: 'ServiceReview',
    display: 'Service Review',
    screenshot: screenshot('service review.png'),
    purpose: 'Displays review form for a completed booking.',
    navigation: 'Submit Review -> previous screen.',
    usages: [
      usage('bookings.list', 'Completed booking context', 'query: limit=50', 'data.bookings[]', 'Uses store-loaded bookings to determine review context.', 'store-auto-load'),
      usage('reviews.submit', 'Submit Review CTA', 'bookingId, rating, comment', 'data.review', 'Submits rating and note for the selected completed booking.'),
    ],
    validation: 'Prevents duplicate submit while request is in progress; rating is selected from one to five stars.',
    gaps: ['Review note is currently sent as comment, while the backend controller expects the field name review.'],
  },
  {
    name: 'HourlyServices',
    display: 'Hourly Services',
    screenshot: screenshot('Hourly Services.png'),
    purpose: 'Displays hourly service details and add-to-cart CTA.',
    navigation: 'Add to Cart -> Cart; Back -> previous screen.',
    usages: [
      usage('services.list', 'Hourly service details', 'query: limit=100', 'data.services[] filtered by category', 'Consumes store-loaded services and filters hourly category.', 'store-auto-load'),
      usage('cart.addItems', 'Hourly Add to Cart CTA', 'serviceId, quantity', 'data.cart, data.billDetails', 'Adds the hourly service to backend cart before navigating to Cart.'),
    ],
    validation: 'Shows empty state if no hourly service is loaded.',
    gaps: ['Duration still comes from the service list item; GET /services/estimate is not used on this screen.'],
  },
  {
    name: 'Cart',
    display: 'Cart',
    screenshot: screenshot('Cart.png'),
    purpose: 'Displays selected services, booking address, profile details, and bill summary.',
    navigation: 'Add more services -> AddMoreServices; address -> SavedAddresses; profile -> EditProfile; Proceed -> Schedule.',
    usages: [
      usage('cart.get', 'Cart item list and bill details', '-', 'data.cart, data.billDetails', 'Hydrates cart after auth.', 'store-auto-load'),
      usage('cart.updateItem', 'Duration +/- controls', 'itemId path param, duration', 'data.cart, data.billDetails', 'Syncs changed service duration to backend cart.'),
      usage('customer.addresses', 'Booking address row', '-', 'data.addresses[]', 'Hydrates saved addresses after auth.', 'store-auto-load'),
      usage('customer.profile', 'Customer contact row', '-', 'data.user', 'Hydrates profile data after auth.', 'store-auto-load'),
    ],
    validation: 'Duration controls clamp local duration at zero; backend update failures are logged without blocking the UI.',
    gaps: ['Promo validation is still not exposed in the current cart UI.'],
  },
  {
    name: 'AddMoreServices',
    display: 'Add More Services',
    screenshot: screenshot('Add more services.png'),
    purpose: 'Lets the customer add another service from the catalog.',
    navigation: 'Service row -> Cart; Back -> Cart.',
    usages: [
      usage('services.list', 'Additional service rows', 'query: limit=100', 'data.services[]', 'Uses store-loaded services.', 'store-auto-load'),
      usage('cart.addItems', 'Additional service row tap', 'serviceId, quantity', 'data.cart, data.billDetails', 'Adds the selected extra service to backend cart before returning to Cart.'),
    ],
    validation: 'Empty state shown when no services are loaded.',
  },
  {
    name: 'Schedule',
    display: 'Schedule Booking',
    screenshot: screenshot('schedule.png'),
    purpose: 'Loads available dates/time slots and stores selected schedule.',
    navigation: 'Continue -> BookingSummary.',
    usages: [
      usage('bookings.availableSlots', 'Date and time slot selector', '-', 'data.dates[], data.slots[]', 'Loads available booking slots.'),
    ],
    validation: 'Allows continue without a slot if none is loaded.',
  },
  {
    name: 'InstantSchedule',
    display: 'Instant Schedule',
    screenshot: screenshot('instant schedule.png'),
    purpose: 'Confirms instant booking mode without slot selection.',
    navigation: 'Continue instantly -> BookingSummary.',
    usages: [],
    validation: 'No slot selection required.',
  },
  {
    name: 'OneHourSchedule',
    display: 'One Hour Schedule',
    screenshot: screenshot('1hr schedule.png'),
    purpose: 'Schedules one-hour service using available slots.',
    navigation: 'Continue -> BookingSummary.',
    usages: [
      usage('bookings.availableSlots', 'Date and time slot selector', '-', 'data.dates[], data.slots[]', 'Loads available booking slots.'),
    ],
    validation: 'Continue stores selected slot in local state.',
  },
  {
    name: 'BookingSummary',
    display: 'Booking Summary',
    screenshot: screenshot('Booking Summary.png'),
    purpose: 'Reviews service/cart, address, bill, map, and nearby maid availability before payment.',
    navigation: 'Confirm & Pay -> BillDetails.',
    usages: [
      usage('bookings.instantAvailability', 'Nearby maid map and availability badge', 'lat/lng, estimatedDurationMinutes', 'data.count, data.maids[], data.message', 'Checks free nearby maids for instant availability.'),
      usage('cart.get', 'Bill/service summary', '-', 'data.cart, data.billDetails', 'Uses store-loaded cart totals.', 'store-auto-load'),
      usage('customer.addresses', 'Location summary', '-', 'data.addresses[]', 'Uses selected address from store.', 'store-auto-load'),
      usage('external.staticMap', 'Summary map image', 'lat/lng and maid coordinates', 'map image', 'Renders Yandex static map with customer and maid markers.', 'external'),
    ],
    validation: 'Falls back to default Kochi coordinates when no selected address coordinates exist.',
    gaps: ['Booking amount still comes from local cart totals; POST /bookings/estimate is not used before payment.'],
  },
  {
    name: 'BillDetails',
    display: 'Bill Details',
    screenshot: screenshot('bill details.png'),
    purpose: 'Displays payable amount and payment options.',
    navigation: 'Confirm & Pay -> PaymentSuccess when API flow succeeds; API failure -> PaymentFailed.',
    usages: [
      usage('cart.get', 'Bill details', '-', 'data.cart, data.billDetails', 'Uses store-loaded cart totals.', 'store-auto-load'),
      usage('bookings.fromCart', 'Confirm & Pay action - booking creation', 'scheduleDate, scheduleTime', 'data.booking', 'Attempts to create a booking from the current backend cart.'),
      usage('payments.initiate', 'Confirm & Pay action - payment order', 'bookingId', 'data.order, data.paymentId', 'Creates a backend payment order for the booking.'),
      usage('payments.verify', 'Confirm & Pay action - payment verification', 'bookingId, orderId, paymentId, signature, status', 'data.payment / dispatch result', 'Attempts to verify payment and mark booking paid.'),
      usage('cart.clear', 'Successful payment cleanup', '-', 'data.cart, data.billDetails', 'Clears backend cart after payment success.'),
    ],
    validation: 'Prevents duplicate payment submission while isPaying is true and routes failures to PaymentFailed.',
    gaps: [
      'createFromCart is called without address/addressId, but backend booking creation requires address or addressId.',
      'payments.verify payload uses orderId/signature/status, while backend expects razorpayOrderId/razorpayPaymentId/razorpaySignature or mock/mockStatus.',
    ],
  },
  {
    name: 'PaymentSuccess',
    display: 'Payment Success',
    screenshot: screenshot('bill details-1.png'),
    purpose: 'Displays success modal and booking/payment summary.',
    navigation: 'Go to Bookings -> MainTabs/BookingsTab; Download Receipt -> LiveTracking.',
    usages: [
      usage('bookings.list', 'Booking summary rows', 'query: limit=50', 'data.bookings[]', 'Uses first store-loaded booking for display.', 'store-auto-load'),
      usage('payments.verify', 'Payment success state source', 'verification payload from BillDetails', 'data.payment / dispatch result', 'The success screen is reached after BillDetails payment verification resolves.'),
    ],
    validation: 'Displays placeholder text when no booking data is loaded.',
    gaps: ['Success details still read the first store booking, not necessarily the booking/payment response just created in BillDetails.'],
  },
  {
    name: 'PaymentFailed',
    display: 'Payment Failed',
    screenshot: screenshot('Payment Failed.png'),
    purpose: 'Displays failed payment modal and retry action.',
    navigation: 'Retry -> BillDetails.',
    usages: [
      usage('bookings.list', 'Booking summary rows', 'query: limit=50', 'data.bookings[]', 'Uses first store-loaded booking for display.', 'store-auto-load'),
      usage('payments.verify', 'Payment failure state source', 'verification payload from BillDetails', 'error envelope', 'The failure screen is reached when BillDetails booking/payment/verify flow throws.'),
    ],
    validation: 'Displays placeholder text when no booking data is loaded.',
    gaps: ['Failure details still read the first store booking, not necessarily the failed booking/payment attempt.'],
  },
  {
    name: 'LiveTracking',
    display: 'Live Tracking',
    screenshot: screenshot('live tracking.png'),
    purpose: 'Shows live booking tracking map, provider status, timeline, OTP hint, and help entry point.',
    navigation: 'Need Help -> AIChat; Back -> previous screen.',
    usages: [
      usage('bookings.tracking', 'Tracking status/map', 'path: booking.id', 'data.lat, data.lng, data.distance', 'Loads initial tracking details when a booking ID exists.'),
      usage('bookings.list', 'Booking context', 'query: limit=50', 'data.bookings[]', 'Uses first store-loaded booking for provider/status display.', 'store-auto-load'),
      usage('external.socket', 'Live provider updates', 'join_booking event with booking.id', 'maid_location_changed, maid_nearby', 'Subscribes to Socket.IO live tracking events.', 'external'),
      usage('external.staticMap', 'Tracking map image', 'customer and provider coordinates', 'map image', 'Renders Yandex static map.', 'external'),
    ],
    validation: 'No tracking call is made until booking.id exists.',
  },
  {
    name: 'Profile',
    display: 'Profile',
    screenshot: screenshot('profile.png'),
    purpose: 'Displays account details and navigation links for profile, address, wallet, legal, support, AI, logout, and deletion flows.',
    navigation: 'Rows navigate to EditProfile, SavedAddresses, BillDetails, Refer, WalletTab, ReportIssue, AIChat, legal screens, delete/logout confirmations.',
    usages: [
      usage('customer.profile', 'Profile hero', '-', 'data.user', 'Displays store-loaded customer name and phone.', 'store-auto-load'),
    ],
    validation: 'Displays placeholder text when profile is not loaded.',
    gaps: ['Payment Methods row routes to BillDetails; no saved payment-method API exists or is called.'],
  },
  {
    name: 'EditProfile',
    display: 'Edit Profile',
    screenshot: screenshot('edit profile.png'),
    purpose: 'Edits first name, last name, and phone locally.',
    navigation: 'Save Changes -> Profile.',
    usages: [
      usage('customer.profile', 'Prefilled profile form', '-', 'data.user', 'Uses store-loaded customer profile.', 'store-auto-load'),
      usage('customer.updateProfile', 'Save Changes button', 'firstName, lastName, phone', 'data.user', 'Persists edited profile fields to the customer profile endpoint.'),
    ],
    validation: 'No required-field validation; save button enters a loading state and logs backend failures.',
  },
  {
    name: 'SavedAddresses',
    display: 'Saved Addresses',
    screenshot: screenshot('Saved address.png'),
    purpose: 'Lists saved addresses and lets customer select/edit/add locally.',
    navigation: 'Edit -> EditAddress; Add New Address -> UpdateHomeAddress.',
    usages: [
      usage('customer.addresses', 'Address cards', '-', 'data.addresses[]', 'Uses store-loaded saved addresses.', 'store-auto-load'),
      usage('customer.deleteAddress', 'Del button', 'addressId path param', 'data.addresses[]', 'Deletes selected saved address from backend and then removes it from local state.'),
    ],
    validation: 'Empty state appears when no addresses are loaded.',
  },
  {
    name: 'EditAddress',
    display: 'Edit Address',
    screenshot: screenshot('Edit address.png'),
    purpose: 'Edits address fields locally.',
    navigation: 'Save Address -> SavedAddresses.',
    usages: [
      usage('customer.addresses', 'Prefilled address form', '-', 'data.addresses[]', 'Uses store-loaded saved addresses.', 'store-auto-load'),
      usage('customer.updateAddress', 'Save Address button', 'addressId path param, line1, line2, phone', 'data.address', 'Persists edited address fields to backend.'),
    ],
    validation: 'No required-field validation; save button enters a loading state and logs backend failures.',
  },
  {
    name: 'UpdateHomeAddress',
    display: 'Update Home Address',
    screenshot: screenshot('Update Home Address.png'),
    purpose: 'Adds a new address locally from profile/account flow.',
    navigation: 'Save Address -> SavedAddresses.',
    usages: [
      usage('customer.profile', 'Name/phone defaults', '-', 'data.user', 'Uses store-loaded customer profile for address metadata.', 'store-auto-load'),
      usage('customer.addAddress', 'Save Address button', 'label, houseName, street, phone', 'data.addresses[]', 'Creates a saved address through the backend customer address endpoint.'),
    ],
    validation: 'No required-field validation; save button enters a loading state and logs backend failures.',
  },
  {
    name: 'Refer',
    display: 'Refer',
    screenshot: screenshot('refer.png'),
    purpose: 'Displays referral code and referral stats.',
    navigation: 'Back -> Profile.',
    usages: [
      usage('customer.referral', 'Referral code/stat card', '-', 'data.referralCode, invited, joined, earned', 'Uses store-loaded referral data.', 'store-auto-load'),
    ],
    validation: 'Shows placeholder when referral details are not loaded.',
    gaps: ['Apply referral endpoint exists, but current Refer screen has no invite-code input/API call.'],
  },
  {
    name: 'AddMoney',
    display: 'Add Money',
    screenshot: screenshot('add money.png'),
    purpose: 'Captures wallet top-up amount.',
    navigation: 'Add Money -> WalletTab.',
    usages: [
      usage('customer.addMoney', 'Add Money button', 'amount', 'data.walletBalance, data.transactions[]', 'Adds wallet balance through the current backend wallet endpoint.'),
    ],
    validation: 'Amount must parse to a positive number before the backend call runs.',
    gaps: ['Current backend endpoint directly credits wallet balance; no payment-backed wallet top-up initiate/verify flow exists.'],
  },
  {
    name: 'PrivacyPolicy',
    display: 'Privacy Policy',
    screenshot: screenshot('Privacy Policy.png'),
    purpose: 'Legal content screen.',
    navigation: 'Back -> Profile.',
    usages: [],
    validation: 'Static/empty legal copy placeholder.',
    gaps: ['No backend legal/content endpoint is consumed.'],
  },
  {
    name: 'Terms',
    display: 'Terms and Conditions',
    screenshot: screenshot('Terms & Conditions.png'),
    purpose: 'Terms content screen.',
    navigation: 'Back -> Profile.',
    usages: [],
    validation: 'Static/empty legal copy placeholder.',
    gaps: ['No backend full terms endpoint is consumed. GET /services/policy only covers cancellation/refund policy.'],
  },
  {
    name: 'ReportIssue',
    display: 'Report Issue',
    screenshot: screenshot('Report an issue.png'),
    purpose: 'Collects support issue text and routes to AI/SOS help.',
    navigation: 'Submit Issue -> AIChatConversation; Emergency SOS -> SOS.',
    usages: [
      usage('support.contact', 'Submit Issue button', 'subject, message', 'success/message', 'Submits the issue text to the support contact endpoint before navigating to AI chat.'),
    ],
    validation: 'Blank issue skips support.contact and opens AI chat directly.',
    gaps: ['Booking-specific post-service issue endpoint POST /reviews/issue is still not used here.'],
  },
  {
    name: 'SOS',
    display: 'SOS',
    screenshot: screenshot('sos.png'),
    purpose: 'Emergency support call-to-action.',
    navigation: 'Open AI Help -> AIChat.',
    usages: [
      usage('support.helplines', 'SOS helpline display', '-', 'data.helplines[]', 'Loads helplines when the SOS screen mounts.'),
      usage('support.sos', 'Call Support button', 'type=emergency', 'data incident/SOS acknowledgement', 'Triggers the emergency support flow.'),
    ],
    validation: 'Call Support button changes to SOS Sent after it is pressed.',
    gaps: ['Helpline extraction expects phone/helplineNumber/number, but backend returns helplines[].numbers. GET /customers/support is still not consumed.'],
  },
  {
    name: 'Logout',
    display: 'Logout Confirmation',
    screenshot: screenshot('Logout.png'),
    purpose: 'Confirms logout action.',
    navigation: 'Log Out -> Login; Cancel -> previous screen.',
    usages: [
      usage('auth.logout', 'Log Out button', '-', 'success/message', 'Calls backend logout, clears local session, and returns to Login.'),
    ],
    validation: 'Backend logout failures are logged; local session is still cleared.',
  },
  {
    name: 'ConfirmDeleteAccount',
    display: 'Confirm Delete Account',
    screenshot: screenshot('Confirm Delete Account.png'),
    purpose: 'Confirms permanent account deletion.',
    navigation: 'Delete Account -> Login; Cancel -> previous screen.',
    usages: [
      usage('auth.deleteMe', 'Delete Account button', '-', 'success/message', 'Deletes authenticated account, clears session, and returns to Login.'),
    ],
    validation: 'Button enters loading state while request is in progress.',
  },
  {
    name: 'AIChat',
    display: 'AI Chat Start',
    screenshot: screenshot('Ai chat.png'),
    purpose: 'Entry screen for AI support assistant.',
    navigation: 'Start Chat -> AIChatConversation.',
    usages: [],
    validation: 'No API call until conversation screen sends a message.',
  },
  {
    name: 'AIChatConversation',
    display: 'AI Chat Conversation',
    screenshot: screenshot('Ai chat chat screen.png'),
    purpose: 'Sends user support messages and displays AI replies.',
    navigation: 'Back -> AIChat/Profile.',
    usages: [
      usage('support.aiChat', 'Chat composer / send button', 'message', 'data.response', 'Sends support question to backend AI chat controller.'),
    ],
    validation: 'Blank messages and duplicate sends are blocked.',
    gaps: ['Frontend expects data.reply, but backend returns data.response, so assistant replies may not render until this shape mismatch is fixed.'],
  },
];

const externalEndpoints = {
  'external.ipGeo': {
    method: 'GET',
    path: 'https://ipapi.co/json/; https://freeipapi.com/api/json; https://ipinfo.io/json',
    purpose: 'External IP-based geolocation fallbacks.',
    sourceRef: `${rel(file.auth)}:482`,
  },
  'external.staticMap': {
    method: 'GET',
    path: 'https://static-maps.yandex.ru/1.x/',
    purpose: 'External static map image rendering.',
    sourceRef: `${rel(file.auth)}:565 / ${rel(file.booking)}:1187`,
  },
  'external.socket': {
    method: 'Socket.IO',
    path: 'http://10.0.2.2:5001 or http://localhost:5001',
    purpose: 'Live tracking websocket events.',
    sourceRef: `${rel(file.booking)}:1110`,
  },
};

const knownGaps = [
  {
    screen: 'OTP',
    gap: 'Push token registration is wired only on the Verify Code button path; the auto-submit OTP path still verifies login without calling /auth/push-token.',
    evidence: 'AuthScreens.tsx calls api.auth.updatePushToken inside handleVerify, but not inside the 6-digit TextInput auto-verify branch.',
  },
  {
    screen: 'WalletTab',
    gap: 'Redeem points action has no backend route.',
    evidence: 'No /customers/wallet/redeem route in customerRoutes.js.',
  },
  {
    screen: 'BillDetails/Profile',
    gap: 'Saved payment methods UI exists, but backend has no payment-methods resource.',
    evidence: 'No /customers/payment-methods route in customerRoutes.js.',
  },
  {
    screen: 'AddMoney',
    gap: 'Wallet top-up now calls /customers/wallet/add-money, but the backend still directly credits wallet balance without payment initiation/verification.',
    evidence: 'customerController.addMoneyToWallet updates walletBalance directly; no wallet top-up payment routes exist.',
  },
  {
    screen: 'BillDetails',
    gap: 'Payment APIs are wired, but the request payloads do not fully match backend expectations.',
    evidence: 'createFromCart is called without address/addressId, while bookingController requires address or addressId; verify sends orderId/paymentId/signature/status, while paymentController expects paymentId plus razorpayOrderId/razorpayPaymentId/razorpaySignature or mock/mockStatus.',
  },
  {
    screen: 'ServiceReview',
    gap: 'Review submission is wired, but the note field is sent as comment while the backend reads review.',
    evidence: 'BookingScreens.tsx sends { bookingId, rating, comment }; reviewController.submitReview destructures { bookingId, rating, review, tags }.',
  },
  {
    screen: 'AIChatConversation',
    gap: 'Frontend expects data.reply, backend returns data.response.',
    evidence: 'ProfileScreens.tsx reads res.data.reply; supportController.js sends { response }.',
  },
  {
    screen: 'SOS',
    gap: 'Helplines API is wired, but UI extraction does not match backend response shape.',
    evidence: 'SosScreen looks for data.phone/data.helplineNumber/data.number; supportController.getHelplines returns data.helplines[].numbers.',
  },
  {
    screen: 'OtherHomeDetails',
    gap: 'Custom home details are still local/navigation state only.',
    evidence: 'OtherHomeDetailsScreen saves by navigating to MainTabs and does not call /customers/property-profile.',
  },
  {
    screen: 'Refer',
    gap: 'Referral display is wired, but applying a referral code is not exposed in this screen.',
    evidence: 'mobileApi has customer.applyReferral, but ReferScreen has only Share Invite and no api.customer.applyReferral call.',
  },
  {
    screen: 'PrivacyPolicy/Terms',
    gap: 'Legal content is still static/empty and has no backend content route.',
    evidence: 'PrivacyPolicyScreen and TermsScreen pass empty paragraphs; backend only exposes /services/policy for cancellation/refund policy.',
  },
  {
    screen: 'Cart/BookingSummary',
    gap: 'Promo validation and booking estimate routes exist but are still not consumed by the checkout UI.',
    evidence: 'mobileApi exposes promotions.validate and bookings.estimate, but current Cart/BookingSummary code does not call them.',
  },
];

const fixedApiWiring = [
  ['Splash', 'GET /content/splash now loads admin-managed splash artwork/content with bundled image fallback.'],
  ['ServiceList', 'POST /cart/items now syncs service tile add-to-cart actions.'],
  ['ServiceDetails', 'POST /cart/items now runs from the Add to Cart CTA.'],
  ['AddMoreServices', 'POST /cart/items now runs before returning to Cart.'],
  ['HourlyServices', 'POST /cart/items now runs from the hourly Add to Cart CTA.'],
  ['Cart', 'PUT /cart/items/:itemId now runs for duration +/- controls.'],
  ['BillDetails', 'POST /bookings/from-cart, POST /payments/initiate, POST /payments/verify, and DELETE /cart are now called from the payment action.'],
  ['ServiceReview', 'POST /reviews is now called from Submit Review.'],
  ['EditProfile', 'PUT /customers/profile is now called from Save Changes.'],
  ['SavedAddresses', 'DELETE /customers/addresses/:id is now called from the new Del action.'],
  ['EditAddress', 'PUT /customers/addresses/:id is now called from Save Address.'],
  ['UpdateHomeAddress', 'POST /customers/addresses is now called from Save Address.'],
  ['AddMoney', 'POST /customers/wallet/add-money is now called after amount validation.'],
  ['ReportIssue', 'POST /support/contact is now called before navigating to chat.'],
  ['SOS', 'GET /support/helplines runs on mount and POST /support/sos runs from Call Support.'],
  ['Logout', 'GET /auth/logout is now called before clearing local session.'],
  ['Language', 'PUT /auth/languager now records the selected response locale before OTP; POST /auth/send-otp still persists language against the phone user.'],
  ['Login', 'WhatsApp OTP reuses POST /auth/send-otp with channel=whatsapp.'],
  ['OTP', 'PUT /auth/push-token is now attempted after successful explicit OTP verification.'],
];

const apiCallPatternByKey = {
  'bookings.fromCart': 'api.bookings.createFromCart',
  'customer.addMoney': 'api.customer.addMoneyToWallet',
  'reviews.maid': 'api.reviews.forMaid',
};

function callRefsForUsage(item) {
  if (item.sourceType === 'external') {
    const ext = externalEndpoints[item.apiKey];
    return ext ? [ext.sourceRef] : [];
  }

  const [group, method] = item.apiKey.split('.');
  const pattern = apiCallPatternByKey[item.apiKey] || `api.${group}.${method}`;
  const screenInfo = currentScreenInfo;
  const refs = [];
  if (screenInfo?.filePath) {
    refs.push(...lineRefs(screenInfo.filePath, [pattern]));
  }
  refs.push(...lineRefs(file.store, [pattern]));
  return [...new Set(refs)];
}

let currentScreenInfo = null;

function screenSourceRef(screen) {
  const meta = screenFiles[screen.name];
  if (!meta) return '-';
  const source = read(meta.file);
  const line = lineOf(source, `export function ${meta.fn}`);
  return `${rel(meta.file)}:${line || 1}`;
}

function screenNavRef(screen) {
  return firstLineRef(file.navigator, [`name="${screen.name}"`]) || '-';
}

function endpointFor(apiKey, endpoints, routes) {
  if (externalEndpoints[apiKey]) {
    return {
      key: apiKey,
      ...externalEndpoints[apiKey],
      auth: 'External',
      routeRef: 'External service',
      backendMatch: 'External',
      request: endpointDetails[apiKey]?.request || '-',
      query: endpointDetails[apiKey]?.query || '-',
      response: endpointDetails[apiKey]?.response || '-',
      errors: endpointDetails[apiKey]?.errors || '-',
    };
  }

  const endpoint = endpoints.get(apiKey);
  if (!endpoint) {
    return {
      key: apiKey,
      method: '?',
      path: apiKey,
      purpose: 'Endpoint key not found in mobileApiEndpointDefinitions.',
      sourceRef: '-',
      auth: 'Unknown',
      routeRef: '-',
      backendMatch: 'Missing definition',
      request: '-',
      query: '-',
      response: '-',
      errors: '-',
    };
  }
  const route = findRoute(routes, endpoint);
  const detail = endpointDetails[apiKey] || {};
  return {
    ...endpoint,
    auth: route ? route.auth : 'No matching backend route found',
    role: route?.role || '',
    routeRef: route ? `${route.file}:${route.line}` : '-',
    backendMatch: route ? 'Matched' : 'Missing',
    request: detail.request || '-',
    query: detail.query || '-',
    response: detail.response || 'Common envelope: success, message, data, error, meta.',
    errors: detail.errors || 'Common API errors: 401 auth failure, 500 internal error.',
  };
}

function imageHtml(screen) {
  const imagePath = screen.screenshot;
  if (!imagePath || !fs.existsSync(imagePath)) {
    return `<div class="missing-shot">Screenshot not found for ${escapeHtml(screen.display)}.</div>`;
  }
  const source = screen.screenshotSource || 'Provided screenshot asset';
  return `
    <figure class="screenshot">
      <img src="${pathToFileURL(imagePath).href}" alt="${escapeHtml(screen.display)} screenshot" />
      <figcaption>${escapeHtml(source)}: ${escapeHtml(rel(imagePath))}</figcaption>
    </figure>`;
}

function endpointBadge(endpoint) {
  return `<span class="method method-${String(endpoint.method).toLowerCase().replace(/[^a-z]/g, '')}">${escapeHtml(endpoint.method)}</span> <code>${escapeHtml(endpoint.path)}</code>`;
}

function apisTable(screen, endpoints, routes) {
  const usages = screen.usages.filter((item) => item.sourceType !== 'external');
  if (!usages.length) {
    return '<p class="muted">No backend API is called or consumed by this screen in the current source.</p>';
  }
  const rows = usages.map((item) => {
    const endpoint = endpointFor(item.apiKey, endpoints, routes);
    currentScreenInfo = { filePath: screenFiles[screen.name]?.file };
    const refs = callRefsForUsage(item);
    currentScreenInfo = null;
    return `
      <tr>
        <td>${endpointBadge(endpoint)}</td>
        <td>${escapeHtml(endpoint.auth)}${endpoint.role ? `<br><span class="muted">role: ${escapeHtml(endpoint.role)}</span>` : ''}</td>
        <td>${escapeHtml(item.sourceType === 'store-auto-load' ? 'AppStore auto-load' : 'Screen direct call')}</td>
        <td>${escapeHtml(endpoint.request)}</td>
        <td>${escapeHtml(endpoint.query)}</td>
        <td>${escapeHtml(endpoint.response)}</td>
        <td>${escapeHtml(endpoint.errors)}</td>
        <td>${escapeHtml([endpoint.sourceRef, endpoint.routeRef, ...refs].filter(Boolean).join('\n'))}</td>
      </tr>`;
  }).join('');
  return `
    <table class="api-table">
      <thead>
        <tr>
          <th>API</th>
          <th>Auth</th>
          <th>Use Type</th>
          <th>Request Payload</th>
          <th>Query Params</th>
          <th>Response Structure</th>
          <th>Error Responses</th>
          <th>Source References</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function uiMappingTable(screen, endpoints, routes) {
  if (!screen.usages.length) {
    return '<p class="muted">No UI element maps to a backend API on this screen.</p>';
  }
  const rows = screen.usages.map((item) => {
    const endpoint = endpointFor(item.apiKey, endpoints, routes);
    return `
      <tr>
        <td>${escapeHtml(item.component)}</td>
        <td>${endpointBadge(endpoint)}</td>
        <td>${escapeHtml(item.requestField)}</td>
        <td>${escapeHtml(item.responseField)}</td>
        <td>${escapeHtml(item.description)}</td>
      </tr>`;
  }).join('');
  return `
    <table>
      <thead>
        <tr>
          <th>UI Component</th>
          <th>API Endpoint</th>
          <th>Request Field</th>
          <th>Response Field</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function requestExamples(screen, endpoints, routes) {
  const usages = screen.usages.filter((item) => item.sourceType !== 'external');
  if (!usages.length) return '<p class="muted">No backend request example for this screen.</p>';
  return usages.map((item) => {
    const endpoint = endpointFor(item.apiKey, endpoints, routes);
    return `<pre><code>${escapeHtml(`${endpoint.method} /api/v1${endpoint.path}\nHeaders: locale: en | ml | hi | ta\nAuth: ${endpoint.auth}\nRequest: ${endpoint.request}\nQuery: ${endpoint.query}`)}</code></pre>`;
  }).join('');
}

function responseExamples(screen, endpoints, routes) {
  const usages = screen.usages.filter((item) => item.sourceType !== 'external');
  if (!usages.length) return '<p class="muted">No backend response example for this screen.</p>';
  const examples = usages.map((item) => {
    const endpoint = endpointFor(item.apiKey, endpoints, routes);
    return {
      endpoint: `${endpoint.method} /api/v1${endpoint.path}`,
      envelope: {
        success: true,
        message: 'Request successful',
        data: endpoint.response,
        error: null,
        meta: { requestId: 'uuid', timestamp: 'ISO-8601' },
      },
    };
  });
  return `<pre><code>${escapeHtml(JSON.stringify(examples, null, 2))}</code></pre>`;
}

function allUsedApiKeys() {
  return [...new Set(screens.flatMap((screen) => screen.usages.map((item) => item.apiKey)).filter((key) => !key.startsWith('external.')))];
}

function inventoryRows() {
  return screens.map((screen, index) => {
    const apiCount = screen.usages.filter((item) => !item.apiKey.startsWith('external.')).length;
    const screenshotStatus = screen.screenshot && fs.existsSync(screen.screenshot) ? 'Embedded' : 'Missing';
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(screen.display)}</td>
        <td><code>${escapeHtml(screen.name)}</code></td>
        <td>${apiCount}</td>
        <td>${escapeHtml(screenshotStatus)}</td>
        <td>${escapeHtml(screenSourceRef(screen))}</td>
        <td>${escapeHtml(screenNavRef(screen))}</td>
      </tr>`;
  }).join('');
}

function apiMatrixRows(endpoints, routes) {
  const keys = allUsedApiKeys();
  return keys.map((key) => {
    const endpoint = endpointFor(key, endpoints, routes);
    const consumingScreens = screens
      .filter((screen) => screen.usages.some((item) => item.apiKey === key))
      .map((screen) => screen.name)
      .join(', ');
    return `
      <tr>
        <td>${endpointBadge(endpoint)}</td>
        <td>${escapeHtml(consumingScreens)}</td>
        <td>${escapeHtml(endpoint.auth)}</td>
        <td>${escapeHtml(endpoint.backendMatch)}</td>
        <td>${escapeHtml(endpoint.sourceRef)}</td>
        <td>${escapeHtml(endpoint.routeRef)}</td>
      </tr>`;
  }).join('');
}

function unusedCustomerRoutes(endpoints, routes) {
  const usedKeys = allUsedApiKeys();
  const usedEndpointSet = new Set(usedKeys.map((key) => {
    const endpoint = endpoints.get(key);
    return endpoint ? `${endpoint.method} ${normalizeRoute(withApiPrefix(endpoint.path))}` : '';
  }));
  return routes
    .filter((route) => route.area === 'customer/mobile')
    .filter((route) => !route.path.startsWith('/api/v1/admin'))
    .filter((route) => !route.path.startsWith('/api/v1/maids'))
    .filter((route) => !route.path.startsWith('/api/v1/agents'))
    .filter((route) => !usedEndpointSet.has(`${route.method} ${normalizeRoute(route.path)}`))
    .slice(0, 80);
}

function screenSection(screen, endpoints, routes) {
  return `
    <section class="screen-section">
      <div class="screen-heading">
        <div>
          <div class="eyebrow">Screen</div>
          <h2>${escapeHtml(screen.display)}</h2>
          <p class="muted"><code>${escapeHtml(screen.name)}</code> | ${escapeHtml(screenSourceRef(screen))}</p>
        </div>
        <div class="nav-ref">Navigator: ${escapeHtml(screenNavRef(screen))}</div>
      </div>
      <div class="screen-grid">
        ${imageHtml(screen)}
        <div class="screen-copy">
          <h3>Purpose</h3>
          <p>${escapeHtml(screen.purpose)}</p>
          <h3>Navigation Links</h3>
          <p>${escapeHtml(screen.navigation)}</p>
          <h3>Validation Rules</h3>
          <p>${escapeHtml(screen.validation || 'No explicit validation found in source.')}</p>
          <h3>Dependencies</h3>
          <p>${escapeHtml('React Navigation, AppStore Context/useReducer, mobileApi client, backend response envelope. Specific screen source listed above.')}</p>
        </div>
      </div>

      <h3>APIs Used</h3>
      ${apisTable(screen, endpoints, routes)}

      <h3>UI to API Mapping</h3>
      ${uiMappingTable(screen, endpoints, routes)}

      <h3>Data Flow Analysis</h3>
      <p>${escapeHtml(dataFlowText(screen))}</p>

      <h3>Request Examples</h3>
      ${requestExamples(screen, endpoints, routes)}

      <h3>Response Examples</h3>
      ${responseExamples(screen, endpoints, routes)}

      <h3>Error Handling</h3>
      <p>${escapeHtml(errorHandlingText(screen))}</p>

      ${screen.gaps?.length ? `
        <h3>Implementation Gaps</h3>
        <ul>${screen.gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul>
      ` : ''}
    </section>`;
}

function dataFlowText(screen) {
  if (!screen.usages.length) {
    return 'This screen is static or local-state driven in the current source. No backend response is consumed directly by the screen.';
  }
  const store = screen.usages.some((item) => item.sourceType === 'store-auto-load');
  const direct = screen.usages.some((item) => item.sourceType === 'direct');
  const external = screen.usages.some((item) => item.sourceType === 'external');
  const parts = [];
  if (store) {
    parts.push('Shared data is loaded by AppStoreProvider useEffect hooks, transformed through mapper functions in AppStore.tsx, stored in Context state, and consumed by this screen via useAppStore().');
  }
  if (direct) {
    parts.push('Direct screen actions call the typed mobileApi wrapper, which builds requests through createApiClient and reads the standard backend response envelope.');
  }
  if (external) {
    parts.push('External HTTP/image/socket integrations provide map, location, or live tracking data outside the Express API.');
  }
  return parts.join(' ');
}

function errorHandlingText(screen) {
  if (!screen.usages.length) {
    return 'No backend errors are handled on this screen because no backend API is called or consumed.';
  }
  return 'The API client throws ApiError for non-2xx responses after parsing the backend error envelope. Screen-level code generally catches errors, logs warnings, navigates to error states, or shows empty fallback text. Store auto-load calls use Promise.allSettled so partial public/customer data can still render when one API fails.';
}

function htmlReport(endpoints, routes) {
  const unusedRoutes = unusedCustomerRoutes(endpoints, routes);
  const generatedAt = new Date().toISOString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zafabit Customer App Screen API Mapping</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      color: #1f2937;
      font-family: Inter, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.45;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
    }
    h1, h2, h3 { color: #111827; margin: 0 0 8px; }
    h1 { font-size: 30px; letter-spacing: 0; }
    h2 { font-size: 21px; }
    h3 { font-size: 14px; margin-top: 18px; }
    p { margin: 0 0 10px; }
    code, pre { font-family: Menlo, Monaco, Consolas, monospace; }
    pre {
      background: #f8fafc;
      border: 1px solid #dbe3ef;
      border-radius: 8px;
      color: #334155;
      font-size: 10px;
      overflow-wrap: anywhere;
      padding: 10px;
      white-space: pre-wrap;
    }
    table {
      border-collapse: collapse;
      font-size: 10px;
      margin: 8px 0 14px;
      table-layout: fixed;
      width: 100%;
    }
    th {
      background: #ede9fe;
      border: 1px solid #d8cffa;
      color: #312e81;
      font-weight: 800;
      padding: 7px;
      text-align: left;
      vertical-align: top;
    }
    td {
      border: 1px solid #e5e7eb;
      padding: 7px;
      vertical-align: top;
      word-break: break-word;
    }
    .cover {
      border-bottom: 4px solid #6d3bb8;
      margin-bottom: 22px;
      padding-bottom: 22px;
    }
    .subtitle { color: #475569; font-size: 14px; max-width: 900px; }
    .meta-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, 1fr);
      margin: 20px 0;
    }
    .metric {
      background: #f8fafc;
      border: 1px solid #dbe3ef;
      border-radius: 8px;
      padding: 13px;
    }
    .metric-label {
      color: #64748b;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .metric-value { color: #4c1d95; font-size: 24px; font-weight: 900; margin-top: 4px; }
    .muted { color: #64748b; }
    .eyebrow {
      color: #6d3bb8;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .diagram {
      background: #f8fafc;
      border: 1px solid #dbe3ef;
      border-radius: 8px;
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(5, 1fr);
      margin: 12px 0 18px;
      padding: 12px;
    }
    .node {
      background: #ffffff;
      border: 1px solid #ddd6fe;
      border-radius: 8px;
      color: #312e81;
      font-weight: 800;
      min-height: 48px;
      padding: 9px;
      text-align: center;
    }
    .screen-section {
      border-top: 2px solid #e5e7eb;
      margin-top: 26px;
      padding-top: 22px;
      page-break-inside: avoid;
    }
    .screen-heading {
      align-items: flex-start;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }
    .nav-ref {
      background: #f3f4f6;
      border-radius: 6px;
      color: #475569;
      font-size: 10px;
      padding: 8px;
      width: 220px;
    }
    .screen-grid {
      align-items: start;
      display: grid;
      gap: 18px;
      grid-template-columns: 220px 1fr;
      margin-bottom: 12px;
    }
    .screenshot {
      margin: 0;
      text-align: center;
    }
    .screenshot img {
      border: 1px solid #d1d5db;
      border-radius: 12px;
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.16);
      max-height: 430px;
      max-width: 210px;
      object-fit: contain;
      width: auto;
    }
    .screenshot figcaption {
      color: #64748b;
      font-size: 9px;
      margin-top: 6px;
      overflow-wrap: anywhere;
    }
    .missing-shot {
      align-items: center;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 12px;
      color: #991b1b;
      display: flex;
      height: 360px;
      justify-content: center;
      padding: 12px;
      text-align: center;
      width: 210px;
    }
    .screen-copy {
      background: #fafafa;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
    }
    .method {
      border-radius: 4px;
      color: #fff;
      display: inline-block;
      font-size: 9px;
      font-weight: 900;
      min-width: 38px;
      padding: 2px 4px;
      text-align: center;
    }
    .method-get { background: #059669; }
    .method-post { background: #2563eb; }
    .method-put { background: #d97706; }
    .method-patch { background: #7c3aed; }
    .method-delete { background: #dc2626; }
    .method-socketio { background: #0f172a; min-width: 60px; }
    .callout {
      background: #fff7ed;
      border-left: 4px solid #f97316;
      color: #7c2d12;
      margin: 10px 0 16px;
      padding: 10px 12px;
    }
    .api-table th:nth-child(1) { width: 15%; }
    .api-table th:nth-child(2) { width: 10%; }
    .api-table th:nth-child(3) { width: 9%; }
    .api-table th:nth-child(8) { width: 17%; }
    ul { margin: 6px 0 14px 18px; padding: 0; }
    li { margin-bottom: 4px; }
    @page { size: A4; margin: 18mm 12mm; }
    @media print {
      body { padding: 0; }
      .screen-section { page-break-inside: avoid; }
      h2, h3 { page-break-after: avoid; }
    }
  </style>
</head>
<body>
  <section class="cover">
    <div class="eyebrow">Screen to API Mapping</div>
    <h1>Zafabit Customer App</h1>
    <p class="subtitle">Client-ready mapping of every customer React Native screen to backend and external APIs. Mappings are traced from source code in <code>${escapeHtml(rel(customerAppRoot))}</code> and Express routes/controllers in <code>${escapeHtml(rel(backendRoot))}</code>.</p>
    <p class="muted">Generated: ${escapeHtml(generatedAt)} | Scope: customer app only. Maid app and admin panel are excluded.</p>
    <div class="meta-grid">
      <div class="metric"><div class="metric-label">Screens Documented</div><div class="metric-value">${screens.length}</div></div>
      <div class="metric"><div class="metric-label">Backend APIs Used</div><div class="metric-value">${allUsedApiKeys().length}</div></div>
      <div class="metric"><div class="metric-label">Screenshots Embedded</div><div class="metric-value">${screens.filter((screen) => screen.screenshot && fs.existsSync(screen.screenshot)).length}</div></div>
      <div class="metric"><div class="metric-label">Known Gaps</div><div class="metric-value">${knownGaps.length}</div></div>
    </div>
  </section>

  <section>
    <h2>Architecture Overview</h2>
    <p>The customer app uses React Navigation for stack/tab routing, a Context plus useReducer store in <code>${escapeHtml(rel(file.store))}</code>, and a typed API wrapper in <code>${escapeHtml(rel(file.api))}</code>. The client base URL is defined in <code>${escapeHtml(rel(file.client))}</code> as Android emulator <code>http://10.0.2.2:5001/api/v1</code> or local <code>http://localhost:5001/api/v1</code>. Every customer API request includes a <code>locale</code> header from <code>${escapeHtml(rel(file.client))}</code>; the header starts as <code>en</code> and changes to <code>en</code>, <code>ml</code>, <code>hi</code>, or <code>ta</code> when the user selects a language.</p>
    <div class="diagram">
      <div class="node">React Native Screens</div>
      <div class="node">useAppStore Context</div>
      <div class="node">mobileApi Wrapper</div>
      <div class="node">ApiClient Fetch</div>
      <div class="node">Express /api/v1 Routes</div>
    </div>
    <h3>Navigation Flow</h3>
    <p>Auth/onboarding starts at Splash and flows through Language, Login, OTP, Name, Location, AddressDetails, CustomHomeDetails, then MainTabs. MainTabs hosts Home, Bookings, and Wallet. Booking screens branch from Home/ServiceList into ServiceDetails, Cart, Schedule, BookingSummary, BillDetails, payment result screens, and LiveTracking. Profile links to saved addresses, referral, wallet, legal screens, issue/SOS, account deletion, logout, and AI chat.</p>
    <h3>State Management</h3>
    <p>No Redux, Zustand, or React Query is used in the customer app. State is centralized in AppStoreProvider with React Context/useReducer. Public data auto-loads services, banners, and featured services. Authenticated data auto-loads customer profile, addresses, cart, bookings, wallet, and referral after a token exists. There is no persistent cache layer beyond in-memory React state.</p>
    <h3>Backend Overview</h3>
    <p>The backend mounts customer/mobile routes in <code>${escapeHtml(rel(path.join(backendRoot, 'src', 'app.js')))}</code>. Responses use the common envelope from <code>${escapeHtml(rel(path.join(backendRoot, 'src', 'utils', 'apiResponse.js')))}</code>: <code>success</code>, <code>message</code>, <code>data</code>, <code>error</code>, and <code>meta</code>. The response helper translates backend response messages from the incoming <code>locale</code> header through <code>${escapeHtml(rel(path.join(backendRoot, 'src', 'utils', 'locales.js')))}</code>; static UI labels remain client-side localization. The admin panel fetch wrapper also sends the same header from <code>${escapeHtml(rel(path.join(workspaceRoot, 'zaffabit', 'src', 'lib', 'api.ts')))}</code>.</p>
  </section>

  <section>
    <h2>Screen Inventory</h2>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Screen</th><th>Route Name</th><th>API Count</th><th>Screenshot</th><th>Screen Source</th><th>Navigator Source</th>
        </tr>
      </thead>
      <tbody>${inventoryRows()}</tbody>
    </table>
  </section>

  <section>
    <h2>API Usage Matrix</h2>
    <table>
      <thead>
        <tr>
          <th>API</th><th>Consuming Screens</th><th>Auth</th><th>Backend Match</th><th>Frontend Definition</th><th>Backend Route</th>
        </tr>
      </thead>
      <tbody>${apiMatrixRows(endpoints, routes)}</tbody>
    </table>
  </section>

  <section>
    <h2>Recent API Wiring Updates</h2>
    <p>The following screen integrations are now reflected in this PDF based on the current customer app source.</p>
    <table>
      <thead><tr><th>Screen</th><th>Update Reflected</th></tr></thead>
      <tbody>
        ${fixedApiWiring.map(([screen, update]) => `<tr><td>${escapeHtml(screen)}</td><td>${escapeHtml(update)}</td></tr>`).join('')}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Missing or Unused APIs</h2>
    <div class="callout">These gaps are based on actual screen/store API calls and backend route inventory. They are not inferred from screenshots alone.</div>
    <table>
      <thead><tr><th>Screen/Area</th><th>Gap</th><th>Evidence</th></tr></thead>
      <tbody>
        ${knownGaps.map((gap) => `<tr><td>${escapeHtml(gap.screen)}</td><td>${escapeHtml(gap.gap)}</td><td>${escapeHtml(gap.evidence)}</td></tr>`).join('')}
      </tbody>
    </table>
    <h3>Customer/Mobile Backend Routes Not Consumed by Current Customer Screens</h3>
    <table>
      <thead><tr><th>Method</th><th>Route</th><th>Area</th><th>Source</th><th>Auth</th></tr></thead>
      <tbody>
        ${unusedRoutes.map((route) => `
          <tr>
            <td><span class="method method-${route.method.toLowerCase()}">${route.method}</span></td>
            <td><code>${escapeHtml(route.path)}</code></td>
            <td>${escapeHtml(route.area)}</td>
            <td>${escapeHtml(`${route.file}:${route.line}`)}</td>
            <td>${escapeHtml(route.auth)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </section>

  ${screens.map((screen) => screenSection(screen, endpoints, routes)).join('\n')}
</body>
</html>`;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(reportWorkDir, { recursive: true });
  const endpoints = parseEndpointDefinitions();
  const routes = scanBackendRoutes();
  const html = htmlReport(endpoints, routes);
  fs.writeFileSync(htmlPath, html);

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (fs.existsSync(chromePath)) {
    launchOptions.executablePath = chromePath;
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size:8px;color:#64748b;width:100%;padding:0 12mm;">Zafabit Customer App Screen-to-API Mapping</div>',
      footerTemplate: '<div style="font-size:8px;color:#64748b;width:100%;padding:0 12mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: '16mm', bottom: '16mm', left: '10mm', right: '10mm' },
      timeout: 120000,
    });
  } finally {
    await browser.close();
  }

  const summary = {
    pdfPath,
    htmlPath,
    screens: screens.length,
    backendApis: allUsedApiKeys().length,
    screenshotsEmbedded: screens.filter((screen) => screen.screenshot && fs.existsSync(screen.screenshot)).length,
  };
  fs.writeFileSync(path.join(reportWorkDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  // Copy to the active conversation artifacts directory
  const sessionArtifactsDir = '/Users/renoroy/.gemini/antigravity/brain/aa86db2c-fc9a-49e8-9a00-c1b4f6bc5a76/artifacts';
  if (fs.existsSync(sessionArtifactsDir)) {
    const destinationPdfPath = path.join(sessionArtifactsDir, 'SCREEN_API_MAPPING.pdf');
    fs.copyFileSync(pdfPath, destinationPdfPath);
    console.log(`Successfully copied SCREEN_API_MAPPING.pdf to session artifacts directory: ${destinationPdfPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
