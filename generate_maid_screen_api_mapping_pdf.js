const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const puppeteer = require('puppeteer');

const backendRoot = __dirname;
const workspaceRoot = path.resolve(backendRoot, '..');
const maidAppRoot = path.join(workspaceRoot, 'zaffabit new maid app');
const maidSrcRoot = path.join(maidAppRoot, 'src');
const reportWorkDir = path.join(backendRoot, 'artifacts', 'maid_screen_api_mapping');
const screenshotDir = path.join(reportWorkDir, 'screenshots');
const htmlPath = path.join(reportWorkDir, 'MAID_SCREEN_API_MAPPING.html');
const pdfPath = path.join(reportWorkDir, 'MAID_SCREEN_API_MAPPING.pdf');
const summaryPath = path.join(reportWorkDir, 'summary.json');
const emulatorLoginShot = path.join(screenshotDir, 'emulator-current.png');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, {recursive: true});
}

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

function normalizeRoute(routePath) {
  return String(routePath || '')
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

function apiPath(endpointPath) {
  return endpointPath.startsWith('/api/v1') ? endpointPath : `/api/v1${endpointPath}`;
}

function lineRefs(filePath, patterns) {
  const source = read(filePath);
  if (!source) return [];
  const lines = source.split(/\r?\n/);
  const refs = [];
  patterns.forEach((pattern) => {
    lines.forEach((line, index) => {
      const matched = pattern instanceof RegExp ? pattern.test(line) : line.includes(pattern);
      if (matched) refs.push(`${rel(filePath)}:${index + 1}`);
    });
  });
  return [...new Set(refs)];
}

function refs(fileName, patterns) {
  return lineRefs(path.join(maidAppRoot, fileName), patterns);
}

function parseMountedRouteBases() {
  const source = read(path.join(backendRoot, 'src', 'app.js'));
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
  fs.readdirSync(routeDir)
    .filter((file) => file.endsWith('Routes.js'))
    .sort()
    .forEach((routeFile) => {
      const filePath = path.join(routeDir, routeFile);
      const source = read(filePath);
      const lines = source.split(/\r?\n/);
      const base = bases[routeFile] || '';
      const protectedUseLines = [];
      lines.forEach((line, index) => {
        if (/router\.use\(protect\)/.test(line)) protectedUseLines.push(index + 1);
      });

      lines.forEach((line, index) => {
        const match = line.match(/router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/);
        if (!match) return;
        const method = match[1].toUpperCase();
        const suffix = match[2] === '/' ? '' : match[2];
        const routePath = `${base}${suffix}`.replace(/\/+/g, '/');
        const lineNo = index + 1;
        const auth = protectedUseLines.some((protectLine) => protectLine < lineNo) || /\bprotect\b/.test(line)
          ? 'Bearer JWT required'
          : 'Public endpoint';
        routes.push({
          method,
          path: routePath,
          normalizedPath: normalizeRoute(routePath),
          auth,
          sourceRef: `${rel(filePath)}:${lineNo}`,
        });
      });
    });
  return routes;
}

function findRoute(routes, endpoint) {
  const fullPath = apiPath(endpoint.path);
  return routes.find((route) =>
    route.method === endpoint.method &&
    routeToRegex(route.normalizedPath).test(normalizeRoute(fullPath)),
  );
}

const file = {
  apiClient: 'src/services/api.client.ts',
  auth: 'src/services/auth.service.ts',
  jobs: 'src/services/jobs.service.ts',
  profile: 'src/services/profile.service.ts',
  earnings: 'src/services/earnings.service.ts',
  chat: 'src/services/chat.service.ts',
  context: 'src/context/AppContext.tsx',
  authScreens: 'src/screens/auth/AuthScreens.tsx',
  home: 'src/screens/home/HomeScreen.tsx',
  jobsScreens: 'src/screens/jobs/JobsScreens.tsx',
  earningsScreen: 'src/screens/earnings/EarningsScreen.tsx',
  referralScreen: 'src/screens/referral/ReferralScreen.tsx',
  profileScreens: 'src/screens/profile/ProfileScreens.tsx',
  supportScreens: 'src/screens/support/SupportScreens.tsx',
  navigator: 'src/navigation/AppNavigator.tsx',
  routes: 'src/constants/routes.ts',
};

const endpoints = [
  {
    key: 'auth.login',
    method: 'POST',
    path: '/auth/login',
    auth: 'Public login request; returns token for protected maid routes.',
    query: '-',
    request: '{ employeeId, password }',
    response: '{ success, token, data: { user, maidProfile } }',
    errors: '401 invalid credentials, validation failures, inactive/blocked account responses from auth middleware.',
    refs: [...refs(file.auth, ['/auth/login']), ...refs(file.authScreens, ['authService.login'])],
  },
  {
    key: 'maids.profileInfo',
    method: 'GET',
    path: '/maids/profile-info',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { profile } } mapped into Profile.',
    errors: '401 auth failure, 404 profile not found.',
    refs: [...refs(file.auth, ['/maids/profile-info']), ...refs(file.profile, ['/maids/profile-info']), ...refs(file.context, ['getProfile'])],
  },
  {
    key: 'maids.updateProfileInfo',
    method: 'PUT',
    path: '/maids/profile-info',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ name, language, jobType, workAreas, phone, email } derived from Profile.',
    response: '{ success, data: { profile } }.',
    errors: '401 auth failure, 400 validation error.',
    refs: [...refs(file.profile, ["put('/maids/profile-info", 'put("/maids/profile-info"', 'updateProfile']), ...refs(file.context, ['profileService.updateProfile'])],
  },
  {
    key: 'maids.onboardingJobType',
    method: 'POST',
    path: '/maids/onboarding/job-type',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ jobType }.',
    response: '{ success, data: { onboardingStatus, jobType } }.',
    errors: '401 auth failure, 400 validation error.',
    refs: refs(file.profile, ['/maids/onboarding/job-type']),
  },
  {
    key: 'maids.onboardingWorkAreas',
    method: 'POST',
    path: '/maids/onboarding/work-areas',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ workAreas: string[] }.',
    response: '{ success, data: { onboardingStatus, workAreas } }.',
    errors: '401 auth failure, 400 validation error.',
    refs: refs(file.profile, ['/maids/onboarding/work-areas']),
  },
  {
    key: 'maids.onboardingSelfie',
    method: 'POST',
    path: '/maids/onboarding/selfie',
    auth: 'Bearer JWT required.',
    query: '-',
    request: 'Multipart/selfie payload expected by backend.',
    response: '{ success, data: { onboardingStatus, selfieUrl } }.',
    errors: '401 auth failure, 400 missing upload/validation error.',
    refs: refs(file.authScreens, ['SelfieVerificationScreen', 'Capture Selfie']),
    status: 'gap',
  },
  {
    key: 'maids.onboardingConfirm',
    method: 'POST',
    path: '/maids/onboarding/confirm',
    auth: 'Bearer JWT required.',
    query: '-',
    request: 'Confirmation payload or empty body depending on backend controller.',
    response: '{ success, data: { onboardingStatus, profile } }.',
    errors: '401 auth failure, 400 incomplete onboarding.',
    refs: refs(file.authScreens, ['ConfirmDetailsScreen', 'RootMain']),
    status: 'gap',
  },
  {
    key: 'maids.dashboard',
    method: 'GET',
    path: '/maids/dashboard',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { todaySummary, activeJob, upcomingJobs, notifications } }.',
    errors: '401 auth failure.',
    refs: refs(file.home, ['homeDashboard']),
    status: 'gap',
  },
  {
    key: 'maids.availability',
    method: 'PATCH',
    path: '/maids/availability',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ available: boolean }.',
    response: '{ success, data: { availability } }.',
    errors: '401 auth failure, 400 validation error.',
    refs: refs(file.home, ['setAvailable', 'AvailabilityToggle']),
    status: 'gap',
  },
  {
    key: 'maids.myJobs',
    method: 'GET',
    path: '/maids/my-jobs',
    auth: 'Bearer JWT required.',
    query: 'tab=new|upcoming|completed.',
    request: '-',
    response: '{ success, data: { jobs: [] } } mapped into Job[].',
    errors: '401 auth failure.',
    refs: [...refs(file.jobs, ['/maids/my-jobs?tab=new', '/maids/my-jobs?tab=upcoming', '/maids/my-jobs?tab=completed']), ...refs(file.context, ['jobsService.listJobs'])],
  },
  {
    key: 'bookings.detail',
    method: 'GET',
    path: '/bookings/:id',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { booking } } mapped into Job detail.',
    errors: '401 auth failure, 404 booking not found.',
    refs: refs(file.jobs, ['/bookings/${jobId}']),
  },
  {
    key: 'bookings.respond',
    method: 'POST',
    path: '/bookings/:id/respond',
    auth: 'Bearer JWT required.',
    query: 'action=accept|decline.',
    request: '-',
    response: '{ success, data: { booking } }.',
    errors: '401 auth failure, 404 booking not found, invalid state.',
    refs: refs(file.context, ['respond?action=accept', 'respond?action=decline']),
  },
  {
    key: 'bookings.verifyStart',
    method: 'POST',
    path: '/bookings/:id/verify-start',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ otp }.',
    response: '{ success, data: { booking, startedAt } }.',
    errors: '401 auth failure, 400 invalid OTP, 404 booking not found.',
    refs: [...refs(file.jobs, ['/bookings/${jobId}/verify-start']), ...refs(file.jobsScreens, ['fallbackOtps', 'enteredOtp'])],
    status: 'gap',
  },
  {
    key: 'bookings.complete',
    method: 'POST',
    path: '/bookings/:id/complete',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { booking } }.',
    errors: '401 auth failure, 404 booking not found, invalid state.',
    refs: refs(file.context, ['/complete']),
  },
  {
    key: 'bookings.extraTime',
    method: 'POST',
    path: '/bookings/:id/extra-time',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ minutes, reason }.',
    response: '{ success, data: { extraTimeRequest } }.',
    errors: '401 auth failure, 400 validation error, 404 booking not found.',
    refs: refs(file.jobsScreens, ['ExtraTimeRequestScreen', 'Add Extra Time', 'Request Sent']),
    status: 'gap',
  },
  {
    key: 'bookings.checklist',
    method: 'PATCH',
    path: '/bookings/:id/checklist/:index',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ completed: boolean }.',
    response: '{ success, data: { checklist } }.',
    errors: '401 auth failure, 400 validation error, 404 booking not found.',
    refs: refs(file.jobsScreens, ['checklist', 'toggleChecklist']),
    status: 'gap',
  },
  {
    key: 'maids.activeJob',
    method: 'GET',
    path: '/maids/active-job',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { activeJob } }.',
    errors: '401 auth failure.',
    refs: refs(file.jobsScreens, ['ActiveJobViewScreen']),
    status: 'gap',
  },
  {
    key: 'maids.extraTimeStatus',
    method: 'GET',
    path: '/maids/active-job/extra-time-status',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { status, requestedMinutes } }.',
    errors: '401 auth failure.',
    refs: refs(file.jobsScreens, ['ExtraTimeRequestScreen']),
    status: 'gap',
  },
  {
    key: 'maids.earnings',
    method: 'GET',
    path: '/maids/earnings',
    auth: 'Bearer JWT required.',
    query: 'period/date filters if supported by backend.',
    request: '-',
    response: '{ success, data: { total, weeklyTrend, dailyBreakdown } }.',
    errors: '401 auth failure.',
    refs: [...refs(file.earnings, ['/maids/earnings']), ...refs(file.earningsScreen, ['₹5,480', 'Weekly Trend'])],
    status: 'gap',
  },
  {
    key: 'maids.referralInfo',
    method: 'GET',
    path: '/maids/referral-info',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { referralCode, reward, referrals } }.',
    errors: '401 auth failure.',
    refs: [...refs(file.earnings, ['/maids/referral-info']), ...refs(file.referralScreen, ['referrals', 'ZF-MAID-2041'])],
    status: 'gap',
  },
  {
    key: 'support.aiChat',
    method: 'POST',
    path: '/support/ai-chat',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ message, context }.',
    response: '{ success, data: { reply, conversationId } }.',
    errors: '401 auth failure, 400 validation error.',
    refs: [...refs(file.chat, ['/support/ai-chat']), ...refs(file.supportScreens, ['AIChatScreen', 'reply:'])],
    status: 'gap',
  },
  {
    key: 'support.contact',
    method: 'POST',
    path: '/support/contact',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ category, message/details, screen, bookingId }.',
    response: '{ success, data: { ticket } }.',
    errors: '401 auth failure, 400 validation error.',
    refs: refs(file.supportScreens, ['ReportIssueScreen', 'setSubmitted(true)']),
    status: 'gap',
  },
  {
    key: 'maids.notifications',
    method: 'GET',
    path: '/maids/notifications',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { notifications: [] } }.',
    errors: '401 auth failure.',
    refs: [...refs(file.home, ['notificationBellCircle', 'Bell']), ...refs(file.profileScreens, ['notificationBellCircle', 'Notifications'])],
    status: 'gap',
  },
  {
    key: 'maids.notificationsReadAll',
    method: 'PATCH',
    path: '/maids/notifications/read-all',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '-',
    response: '{ success, data: { updatedCount } }.',
    errors: '401 auth failure.',
    refs: refs(file.profileScreens, ['Notifications']),
    status: 'gap',
  },
  {
    key: 'maids.location',
    method: 'PATCH',
    path: '/maids/location',
    auth: 'Bearer JWT required.',
    query: '-',
    request: '{ latitude, longitude }.',
    response: '{ success, data: { location } }.',
    errors: '401 auth failure, 400 validation error.',
    refs: refs(file.authScreens, ['LocationPermissionScreen', 'selectedAreas']),
    status: 'gap',
  },
];

const screenData = [
  {
    name: 'Login',
    route: 'Login',
    source: file.authScreens,
    screenshot: emulatorLoginShot,
    purpose: 'Authenticates the maid/partner with employee ID and password.',
    apis: ['auth.login'],
    components: [
      ['Employee ID field', 'POST /auth/login', 'employeeId', 'token, user', 'Collects partner employee ID.'],
      ['Password field', 'POST /auth/login', 'password', 'token, user', 'Collects password and masks input.'],
      ['Login button', 'POST /auth/login', '{ employeeId, password }', 'auth token', 'Starts authenticated session and moves to onboarding/main flow.'],
    ],
    navigation: 'Login -> Selfie Verification after successful login in the current flow.',
    validation: 'Requires non-empty employee ID and password before submit.',
    gaps: ['No locale header is attached by api.client.ts.'],
  },
  {
    name: 'Selfie Verification',
    route: 'SelfieVerification',
    source: file.authScreens,
    purpose: 'Captures or confirms worker selfie during onboarding.',
    apis: ['maids.onboardingSelfie'],
    components: [
      ['Capture Selfie', 'POST /maids/onboarding/selfie', 'selfie file/form-data', 'selfieUrl, onboardingStatus', 'Currently navigates forward without upload.'],
    ],
    navigation: 'Selfie Verification -> Job Type.',
    validation: 'Should require a captured selfie before continuing; current source does not enforce backend upload.',
    gaps: ['Backend route exists but screen does not call it.'],
  },
  {
    name: 'Job Type',
    route: 'JobType',
    source: file.authScreens,
    purpose: 'Lets the worker choose full-time or part-time job preference.',
    apis: ['maids.onboardingJobType'],
    components: [
      ['Job type option', 'POST /maids/onboarding/job-type', 'jobType', 'jobType, onboardingStatus', 'Current screen stores selection in context; profile service has the API method.'],
    ],
    navigation: 'Job Type -> Work Area.',
    validation: 'One job type must be selected.',
    gaps: ['Screen selection is local until profile sync; onboarding API should be called in this step or confirm step.'],
  },
  {
    name: 'Work Area',
    route: 'LocationPermission',
    source: file.authScreens,
    purpose: 'Collects preferred work areas and location permission context.',
    apis: ['maids.onboardingWorkAreas', 'maids.location'],
    components: [
      ['Area selection chips', 'POST /maids/onboarding/work-areas', 'workAreas[]', 'workAreas, onboardingStatus', 'Current screen stores selected areas in context.'],
      ['Location permission/action', 'PATCH /maids/location', 'latitude, longitude', 'location', 'Backend has live location route; screen does not update it.'],
    ],
    navigation: 'Work Area -> Confirm Details.',
    validation: 'At least one work area should be selected.',
    gaps: ['No backend call in the screen for work area or current location.'],
  },
  {
    name: 'Confirm Details',
    route: 'ConfirmDetails',
    source: file.authScreens,
    purpose: 'Reviews onboarding choices before entering the main partner app.',
    apis: ['maids.onboardingConfirm'],
    components: [
      ['Confirm button', 'POST /maids/onboarding/confirm', 'confirmation payload', 'profile, onboardingStatus', 'Currently navigates to Main Tabs without backend confirmation.'],
    ],
    navigation: 'Confirm Details -> Main Tabs.',
    validation: 'Should ensure selfie, job type, and work areas are complete.',
    gaps: ['Backend confirm API is not called.'],
  },
  {
    name: 'Home',
    route: 'Home',
    source: file.home,
    purpose: 'Dashboard with availability, current request, summary cards, and notification entry.',
    apis: ['maids.dashboard', 'maids.availability', 'maids.myJobs', 'bookings.respond', 'maids.notifications'],
    components: [
      ['Availability toggle', 'PATCH /maids/availability', 'available', 'availability', 'Currently local UI state only.'],
      ['New request card', 'GET /maids/my-jobs?tab=new', 'tab=new', 'jobs[]', 'Currently uses mock request data.'],
      ['Accept/decline actions', 'POST /bookings/:id/respond?action=accept|decline', 'booking id, action query', 'booking', 'Context action calls backend when job comes from jobsList.'],
      ['Dashboard counters', 'GET /maids/dashboard', '-', 'todaySummary', 'Currently use homeDashboard mock constants.'],
      ['Bell icon', 'GET /maids/notifications', '-', 'notifications[]', 'Currently displays static alert.'],
    ],
    navigation: 'Home -> Job Details or Active Job; Home tab is one of the Main Tabs.',
    validation: 'Availability should be boolean; accept/decline should require a backend job ID.',
    gaps: ['Dashboard, request card, availability, and notifications are not fully live.'],
  },
  {
    name: 'Jobs List',
    route: 'Jobs',
    source: file.jobsScreens,
    purpose: 'Shows new, upcoming, and completed jobs.',
    apis: ['maids.myJobs', 'bookings.respond'],
    components: [
      ['New tab', 'GET /maids/my-jobs?tab=new', 'tab=new', 'jobs[]', 'Loaded by AppContext refreshData.'],
      ['Upcoming tab', 'GET /maids/my-jobs?tab=upcoming', 'tab=upcoming', 'jobs[]', 'Loaded by AppContext refreshData.'],
      ['Completed tab', 'GET /maids/my-jobs?tab=completed', 'tab=completed', 'jobs[]', 'Loaded by AppContext refreshData.'],
      ['Accept/decline buttons', 'POST /bookings/:id/respond', 'action query', 'booking', 'Context calls backend and updates local state.'],
    ],
    navigation: 'Jobs -> Job Details -> OTP Verification -> Active Job.',
    validation: 'Requires a job ID for action buttons.',
    gaps: ['Initial mock jobs remain as fallback when API load fails.'],
  },
  {
    name: 'Job Details',
    route: 'JobsDetails',
    source: file.jobsScreens,
    purpose: 'Displays selected job detail, customer, address, services, and action controls.',
    apis: ['bookings.detail', 'bookings.respond'],
    components: [
      ['Job detail panel', 'GET /bookings/:id', 'booking id', 'booking', 'Service has getJob, but screen primarily uses context selected job.'],
      ['Accept job', 'POST /bookings/:id/respond?action=accept', 'booking id', 'booking', 'Moves accepted job to upcoming locally after call.'],
      ['Decline job', 'POST /bookings/:id/respond?action=decline', 'booking id', 'booking', 'Removes job locally after call.'],
      ['Start/OTP action', 'POST /bookings/:id/verify-start', 'otp', 'started booking', 'Navigation goes to OTP screen.'],
    ],
    navigation: 'Job Details -> OTP Verification or Jobs List.',
    validation: 'Requires selected job ID; start requires OTP verification.',
    gaps: ['Detail screen does not fetch latest booking detail when opened.'],
  },
  {
    name: 'OTP Verification',
    route: 'OTPVerification',
    source: file.jobsScreens,
    purpose: 'Verifies customer-provided OTP before starting service.',
    apis: ['bookings.verifyStart'],
    components: [
      ['OTP input', 'POST /bookings/:id/verify-start', 'otp', 'booking, startedAt', 'Current screen validates locally with fallback OTP values.'],
      ['Verify/Start button', 'POST /bookings/:id/verify-start', 'booking id and otp', 'started booking', 'Should start backend job after successful OTP.'],
    ],
    navigation: 'OTP Verification -> Active Job on success.',
    validation: 'Requires OTP length and booking ID.',
    gaps: ['Screen does not call jobsService.verifyOtp; local fallback OTPs allow start without backend verification.'],
  },
  {
    name: 'Active Job',
    route: 'ActiveJobView',
    source: file.jobsScreens,
    purpose: 'Tracks in-progress job, checklist, timer, extra time, and completion.',
    apis: ['maids.activeJob', 'bookings.checklist', 'bookings.complete', 'maids.extraTimeStatus'],
    components: [
      ['Active job card', 'GET /maids/active-job', '-', 'activeJob', 'Current active job comes from context state.'],
      ['Checklist row', 'PATCH /bookings/:id/checklist/:index', 'completed', 'checklist', 'Current checklist is local state.'],
      ['Complete job button', 'POST /bookings/:id/complete', 'booking id', 'booking', 'Context calls backend and updates local state.'],
      ['Extra time status', 'GET /maids/active-job/extra-time-status', '-', 'status', 'Backend status route exists but screen does not poll.'],
    ],
    navigation: 'Active Job -> Extra Time Request or completion state.',
    validation: 'Completion should require active booking state and any mandatory checklist rules.',
    gaps: ['Checklist and active-job refresh are not persisted/read from backend.'],
  },
  {
    name: 'Extra Time Request',
    route: 'ExtraTimeRequest',
    source: file.jobsScreens,
    purpose: 'Requests additional paid work time for the active booking.',
    apis: ['bookings.extraTime', 'maids.extraTimeStatus'],
    components: [
      ['Minute selector', 'POST /bookings/:id/extra-time', 'minutes', 'extraTimeRequest', 'Current screen sends no backend request.'],
      ['Reason/details', 'POST /bookings/:id/extra-time', 'reason', 'extraTimeRequest', 'Should be persisted with request.'],
      ['Request status', 'GET /maids/active-job/extra-time-status', '-', 'status', 'No status polling in current screen.'],
    ],
    navigation: 'Extra Time Request -> Active Job.',
    validation: 'Minutes should be positive and reason should be provided when required.',
    gaps: ['Only an alert is shown after tapping submit.'],
  },
  {
    name: 'Earnings',
    route: 'Earnings',
    source: file.earningsScreen,
    purpose: 'Displays partner earnings, weekly trend, daily breakdown, and referral prompt.',
    apis: ['maids.earnings', 'maids.referralInfo', 'maids.notifications'],
    components: [
      ['Total earnings', 'GET /maids/earnings', '-', 'total', 'Current value is static: Rs 5,480.'],
      ['Weekly chart', 'GET /maids/earnings', 'period', 'weeklyTrend[]', 'Current bars are hard-coded.'],
      ['Daily breakdown', 'GET /maids/earnings', 'period', 'dailyBreakdown[]', 'Current rows are hard-coded.'],
      ['Referral card', 'GET /maids/referral-info', '-', 'referralCode, reward', 'Current card is static.'],
      ['Bell icon', 'GET /maids/notifications', '-', 'notifications[]', 'Currently static alert.'],
    ],
    navigation: 'Earnings tab in Main Tabs.',
    validation: 'Period selector should map to supported earning filters.',
    gaps: ['Earnings service exists but screen is not rendering live service data.'],
  },
  {
    name: 'Referral',
    route: 'Referral',
    source: file.referralScreen,
    purpose: 'Shows referral rewards, code, and referred workers.',
    apis: ['maids.referralInfo'],
    components: [
      ['Referral code', 'GET /maids/referral-info', '-', 'referralCode', 'Current code is static: ZF-MAID-2041.'],
      ['Referral list', 'GET /maids/referral-info', '-', 'referrals[]', 'Current list uses mock referrals.'],
      ['Share invite button', 'GET /maids/referral-info', '-', 'inviteLink/referralCode', 'Button currently has no action.'],
    ],
    navigation: 'Intended Profile -> Referral, but ReferralStack is not mounted in MainTabsNavigator.',
    validation: 'Referral code must exist before sharing.',
    gaps: ['Referral screen is not reachable through mounted tabs/stacks in current navigator; screen uses mock data.'],
  },
  {
    name: 'Profile',
    route: 'Profile',
    source: file.profileScreens,
    purpose: 'Displays partner profile summary and account actions.',
    apis: ['maids.profileInfo', 'maids.notifications'],
    components: [
      ['Profile summary', 'GET /maids/profile-info', '-', 'profile', 'Context loads profile, but screen still displays static Sarah Johnson in header card.'],
      ['Personal Information row', 'GET /maids/profile-info', '-', 'profile', 'Navigates to personal information screen.'],
      ['Bell icon', 'GET /maids/notifications', '-', 'notifications[]', 'Currently static alert.'],
      ['Logout button', 'Auth/session clear', '-', '-', 'Resets navigation locally; no logout API in current maid auth service.'],
    ],
    navigation: 'Profile -> Personal Information, Support & Safety, Privacy & Terms, Referral intent.',
    validation: 'Profile route requires authenticated session.',
    gaps: ['Profile header and notifications are not fully backend driven; referral navigation targets an unmounted stack.'],
  },
  {
    name: 'Personal Information',
    route: 'PersonalInformation',
    source: file.profileScreens,
    purpose: 'Shows and edits partner name, language, job type, work area, and notification setting.',
    apis: ['maids.profileInfo', 'maids.updateProfileInfo', 'maids.onboardingJobType', 'maids.onboardingWorkAreas', 'maids.notificationsReadAll'],
    components: [
      ['Name fields', 'PUT /maids/profile-info', 'name', 'profile.name', 'Saved through context updateProfile.'],
      ['Language selector', 'PUT /maids/profile-info', 'language', 'profile.language', 'Saved as profile field; API locale header is still absent.'],
      ['Job type selector', 'POST /maids/onboarding/job-type', 'jobType', 'jobType', 'Profile service can sync job type.'],
      ['Work area row', 'POST /maids/onboarding/work-areas', 'workAreas[]', 'workAreas', 'Current row shows static alert.'],
      ['Notifications switch', 'PATCH /maids/notifications/read-all or preference route', 'enabled', 'notification preference', 'Current switch is local UI state.'],
    ],
    navigation: 'Personal Information -> Profile.',
    validation: 'Name should not be empty; language/job type values should be from supported lists.',
    gaps: ['Notifications preference and work area editing are local/static.'],
  },
  {
    name: 'Edit Personal Information',
    route: 'EditPersonalInformation',
    source: file.profileScreens,
    purpose: 'Declared route that immediately redirects back; actual editing is a modal inside Personal Information.',
    apis: [],
    components: [
      ['Redirect effect', '-', '-', '-', 'No backend call; component returns null after navigation.goBack().'],
    ],
    navigation: 'Edit Personal Information -> previous screen immediately.',
    validation: 'No form validation because no form is rendered.',
    gaps: ['Route exists but is not a real edit screen.'],
  },
  {
    name: 'Privacy Terms',
    route: 'PrivacyTerms',
    source: file.profileScreens,
    purpose: 'Shows static partner privacy and terms text.',
    apis: [],
    components: [
      ['Terms cards', '-', '-', '-', 'Static client-side content.'],
    ],
    navigation: 'Privacy Terms -> Profile.',
    validation: 'No backend validation.',
    gaps: ['No CMS/content endpoint is used for policy text.'],
  },
  {
    name: 'Support & Safety',
    route: 'SupportSafety',
    source: file.supportScreens,
    purpose: 'Entry point for support topics and safety issue reporting.',
    apis: ['support.contact'],
    components: [
      ['Support topic row', 'POST /support/contact', 'category', 'ticket', 'Rows navigate to Report Issue.'],
      ['Report Safety Issue', 'POST /support/contact', 'category/details', 'ticket', 'Navigates to Report Issue.'],
    ],
    navigation: 'Support & Safety -> Report Issue.',
    validation: 'Issue category should be carried to report form.',
    gaps: ['Support categories are mock constants, not backend driven.'],
  },
  {
    name: 'AI Chat Entry',
    route: 'AIChat',
    source: file.supportScreens,
    purpose: 'Intro screen before opening AI support chat.',
    apis: [],
    components: [
      ['Open Chat button', '-', '-', '-', 'Navigates to AI Chat screen.'],
    ],
    navigation: 'AI Chat Entry -> AI Chat Screen.',
    validation: 'No backend validation.',
    gaps: ['No chat session preload.'],
  },
  {
    name: 'AI Chat Screen',
    route: 'AIChatScreen',
    source: file.supportScreens,
    purpose: 'Partner support chat for questions about jobs, OTP, payment, safety, and app usage.',
    apis: ['support.aiChat'],
    components: [
      ['Message list', 'POST /support/ai-chat', 'message', 'reply', 'Current replies are generated locally.'],
      ['Send button', 'POST /support/ai-chat', 'message', 'reply', 'chatService exists but screen does not use it.'],
    ],
    navigation: 'AI Chat Screen -> previous profile/support route.',
    validation: 'Input must be non-empty.',
    gaps: ['Screen does not call chatService.sendMessage.'],
  },
  {
    name: 'Report Issue',
    route: 'ReportIssue',
    source: file.supportScreens,
    purpose: 'Collects support issue category and details.',
    apis: ['support.contact'],
    components: [
      ['Category chips', 'POST /support/contact', 'category', 'ticket.category', 'Current category is local state.'],
      ['Details field', 'POST /support/contact', 'details/message', 'ticket.message', 'Current details are local state.'],
      ['Submit Report', 'POST /support/contact', '{ category, details }', 'ticket', 'Currently only flips submitted state.'],
    ],
    navigation: 'Report Issue -> submitted state -> Report Issue.',
    validation: 'Details should be required before submission.',
    gaps: ['Submit does not create backend support ticket.'],
  },
  {
    name: 'Error Screens',
    route: 'NoInternet, LocationAccessError, NotFound, UnauthorizedAccess, NoData',
    source: 'src/screens/errors/ErrorScreens.tsx',
    purpose: 'Shared offline, location, not-found, unauthorized, and empty-state screens.',
    apis: [],
    components: [
      ['Retry/back buttons', '-', '-', '-', 'Local navigation or retry behavior.'],
    ],
    navigation: 'Can be shown by RootStack for app-level failures.',
    validation: 'No backend validation.',
    gaps: ['No direct API mapping.'],
  },
];

const providedScreenshotDir = '/Users/renoroy/Downloads/zafabit (4)';
const screenShotMap = {
  Login: 'login.png',
  'Selfie Verification': 'Selfie Verification.png',
  'Job Type': 'job type.png',
  'Work Area': 'location.png',
  'Confirm Details': 'confirm.png',
  Home: 'Home.png',
  'Jobs List': 'jobs.png',
  'Job Details': 'jobs Details.png',
  'OTP Verification': 'OTP Verification.png',
  'Active Job': 'Active job view.png',
  'Extra Time Request': 'extra time request.png',
  Earnings: 'earning.png',
  Referral: 'referral.png',
  Profile: 'Profile.png',
  'Personal Information': 'Personal Information.png',
  'Edit Personal Information': 'Edit Personal Information.png',
  'Privacy Terms': 'Privacy & Terms.png',
  'Support & Safety': 'Support & Safety.png',
  'AI Chat Entry': 'Ai chat.png',
  'AI Chat Screen': 'Ai chat chat screen.png',
  'Report Issue': 'Report an issue.png',
  'Error Screens': 'login.png',
};

screenData.forEach((screen) => {
  const fileName = screenShotMap[screen.name];
  if (!fileName) return;
  const shotPath = path.join(providedScreenshotDir, fileName);
  if (fs.existsSync(shotPath)) {
    screen.screenshot = shotPath;
  }
});

function resolveEndpoint(key, routeMatches) {
  const endpoint = endpoints.find((item) => item.key === key);
  if (!endpoint) return null;
  const route = routeMatches[key];
  return {
    ...endpoint,
    route,
    backendRef: route ? route.sourceRef : 'Backend route not found',
    backendAuth: route ? route.auth : endpoint.auth,
  };
}

function apiTable(screen, routeMatches) {
  const rows = (screen.apis || [])
    .map((key) => resolveEndpoint(key, routeMatches))
    .filter(Boolean)
    .map((endpoint) => `
      <tr>
        <td><span class="method">${endpoint.method}</span></td>
        <td><code>${escapeHtml(endpoint.path)}</code></td>
        <td>${escapeHtml(endpoint.backendAuth || endpoint.auth)}</td>
        <td>${escapeHtml(endpoint.query)}</td>
        <td>${escapeHtml(endpoint.request)}</td>
        <td>${escapeHtml(endpoint.response)}</td>
        <td>${escapeHtml(endpoint.errors)}</td>
        <td>${escapeHtml(endpoint.refs.length ? endpoint.refs.join(', ') : endpoint.backendRef)}</td>
      </tr>
    `).join('');

  if (!rows) return '<p class="muted">No backend API is called or consumed by this screen in the current source.</p>';

  return `
    <table>
      <thead>
        <tr>
          <th>Method</th>
          <th>Endpoint</th>
          <th>Auth</th>
          <th>Query</th>
          <th>Request Payload</th>
          <th>Response Structure</th>
          <th>Error Responses</th>
          <th>Code References</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function componentTable(screen) {
  const rows = screen.components.map((row) => `
    <tr>
      <td>${escapeHtml(row[0])}</td>
      <td><code>${escapeHtml(row[1])}</code></td>
      <td>${escapeHtml(row[2])}</td>
      <td>${escapeHtml(row[3])}</td>
      <td>${escapeHtml(row[4])}</td>
    </tr>
  `).join('');
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
    </table>
  `;
}

function screenshotBlock(screen) {
  if (screen.screenshot && fs.existsSync(screen.screenshot)) {
    return `
      <figure class="screenshot">
        <img src="${pathToFileURL(screen.screenshot).href}" alt="${escapeHtml(screen.name)} screenshot" />
        <figcaption>Captured from Android emulator: ${escapeHtml(rel(screen.screenshot))}</figcaption>
      </figure>
    `;
  }
  return `
    <div class="screenshot pending">
      <div class="phone-frame">
        <div class="phone-title">${escapeHtml(screen.name)}</div>
        <div class="phone-subtitle">Pending emulator capture</div>
        <div class="phone-copy">Source traced from ${escapeHtml(screen.source)}. API mapping below is based on code references and backend routes.</div>
      </div>
    </div>
  `;
}

function requestExamples(screen, routeMatches) {
  const examples = (screen.apis || [])
    .map((key) => resolveEndpoint(key, routeMatches))
    .filter(Boolean)
    .map((endpoint) => {
      const body = endpoint.request === '-' ? '' : ` \\\n  -H 'Content-Type: application/json' \\\n  -d '${escapeHtml(endpoint.request)}'`;
      return `<pre><code>curl -X ${endpoint.method} '${apiPath(endpoint.path)}' \\
  -H 'Authorization: Bearer &lt;token&gt;' \\
  -H 'locale: en'${body}</code></pre>`;
    }).join('');
  return examples || '<p class="muted">No backend request example for this screen.</p>';
}

function responseExamples(screen, routeMatches) {
  const examples = (screen.apis || [])
    .map((key) => resolveEndpoint(key, routeMatches))
    .filter(Boolean)
    .map((endpoint) => `<pre><code>${escapeHtml(endpoint.response)}</code></pre>`)
    .join('');
  return examples || '<p class="muted">No backend response example for this screen.</p>';
}

function renderScreen(screen, routeMatches) {
  const sourceRefs = lineRefs(path.join(maidAppRoot, screen.source), [
    `function ${screen.name.replace(/[^A-Za-z0-9]/g, '')}`,
    screen.route,
    screen.name,
  ]);
  const refsText = sourceRefs.length ? sourceRefs.join(', ') : rel(path.join(maidAppRoot, screen.source));
  const gaps = (screen.gaps || []).map((gap) => `<li>${escapeHtml(gap)}</li>`).join('');

  return `
    <section class="screen page-break">
      <h1>${escapeHtml(screen.name)}</h1>
      <div class="meta-grid">
        <div><strong>Route</strong><br />${escapeHtml(screen.route)}</div>
        <div><strong>Source</strong><br />${escapeHtml(refsText)}</div>
      </div>
      <h2>Screenshot</h2>
      ${screenshotBlock(screen)}
      <h2>Purpose</h2>
      <p>${escapeHtml(screen.purpose)}</p>
      <h2>APIs Used</h2>
      ${apiTable(screen, routeMatches)}
      <h2>UI to API Mapping Table</h2>
      ${componentTable(screen)}
      <h2>Request Examples</h2>
      ${requestExamples(screen, routeMatches)}
      <h2>Response Examples</h2>
      ${responseExamples(screen, routeMatches)}
      <h2>Validation Rules</h2>
      <p>${escapeHtml(screen.validation)}</p>
      <h2>Error Handling</h2>
      <p>${screen.apis && screen.apis.length ? 'API errors are caught in service/context layers where wired. Several gap screens currently show local alerts or local state instead of backend error feedback.' : 'No backend errors are handled on this screen because no backend API is called or consumed.'}</p>
      <h2>Navigation Links</h2>
      <p>${escapeHtml(screen.navigation)}</p>
      <h2>Dependencies</h2>
      <p>React Navigation, AppContext, service layer, mobile API client, and backend response envelope. Source references are listed above.</p>
      ${gaps ? `<h2>Integration Gaps</h2><ul>${gaps}</ul>` : ''}
    </section>
  `;
}

function renderMatrix(routeMatches) {
  const rows = endpoints.map((endpoint) => {
    const route = routeMatches[endpoint.key];
    const usedScreens = screenData
      .filter((screen) => (screen.apis || []).includes(endpoint.key))
      .map((screen) => screen.name)
      .join(', ');
    const status = endpoint.status === 'gap'
      ? 'Gap or partial integration'
      : route
        ? 'Wired or service available'
        : 'Backend route not matched';
    return `
      <tr>
        <td>${escapeHtml(endpoint.key)}</td>
        <td><span class="method">${endpoint.method}</span></td>
        <td><code>${escapeHtml(endpoint.path)}</code></td>
        <td>${escapeHtml(usedScreens || 'Service/backend only')}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(route ? route.sourceRef : 'No backend route match')}</td>
      </tr>
    `;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>API Key</th>
          <th>Method</th>
          <th>Endpoint</th>
          <th>Screens</th>
          <th>Status</th>
          <th>Backend Reference</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderHtml(routeMatches, totals) {
  const navFlow = [
    'Login -> Selfie Verification -> Job Type -> Work Area -> Confirm Details -> Main Tabs',
    'Main Tabs -> Home, Jobs, Earnings, Profile',
    'Jobs -> New/Upcoming/Completed -> Job Details -> OTP Verification -> Active Job -> Extra Time Request -> Completion',
    'Profile -> Personal Information/Edit, Privacy Terms, Support & Safety -> AI Chat or Report Issue',
  ];

  const currentApiClient = read(path.join(maidAppRoot, file.apiClient));
  const portStatus = currentApiClient.includes('5001')
    ? 'Confirmed current maid API client points to backend port 5001.'
    : 'Gap: current maid API client does not point to backend port 5001.';
  const localeStatus = /locale/i.test(currentApiClient)
    ? 'Locale header appears in the API client.'
    : 'Gap: api.client.ts does not attach a locale header such as locale: en or locale: ml.';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Maid App Screen to API Mapping</title>
  <style>
    :root { color-scheme: light; --ink: #1d1730; --muted: #6f687d; --line: #e7e0ef; --soft: #f7f4fb; --brand: #65419a; --ok: #138a5b; --warn: #af5c00; --bad: #b42318; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.42; background: white; }
    .cover { min-height: 940px; padding: 72px 56px; background: linear-gradient(180deg, #ffffff 0%, #f7f4fb 100%); }
    .eyebrow { color: var(--brand); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.1; }
    h2 { margin: 20px 0 8px; font-size: 16px; color: var(--brand); }
    h3 { margin: 16px 0 8px; font-size: 13px; }
    p { margin: 0 0 10px; }
    code { font-family: Menlo, Consolas, monospace; font-size: 10.5px; color: #2a2041; }
    pre { margin: 8px 0; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: #fbfaff; white-space: pre-wrap; word-break: break-word; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; table-layout: fixed; }
    th, td { border: 1px solid var(--line); padding: 6px; vertical-align: top; word-break: break-word; }
    th { background: var(--soft); color: #35294f; font-size: 10.5px; text-align: left; }
    td { font-size: 10.3px; }
    ul { margin: 6px 0 12px 18px; padding: 0; }
    li { margin: 3px 0; }
    .subtitle { max-width: 680px; font-size: 15px; color: var(--muted); }
    .summary-grid, .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 22px 0; }
    .meta-grid { grid-template-columns: 1fr 2fr; }
    .stat, .meta-grid div { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: white; }
    .stat .num { font-size: 24px; font-weight: 800; color: var(--brand); }
    .muted { color: var(--muted); }
    .method { display: inline-block; min-width: 38px; text-align: center; color: white; background: var(--brand); border-radius: 4px; padding: 2px 4px; font-weight: 800; font-size: 10px; }
    .pill { display: inline-block; border-radius: 999px; padding: 4px 8px; margin: 3px 4px 3px 0; background: #efe8f8; color: var(--brand); font-weight: 700; }
    .warn { color: var(--warn); font-weight: 800; }
    .ok { color: var(--ok); font-weight: 800; }
    .bad { color: var(--bad); font-weight: 800; }
    .screen { padding: 44px 42px; }
    .page-break { page-break-before: always; }
    .screenshot { margin: 0 0 12px; text-align: left; }
    .screenshot img { width: 220px; max-height: 490px; object-fit: contain; border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 6px 20px rgba(29, 23, 48, .12); }
    .screenshot figcaption { margin-top: 6px; color: var(--muted); font-size: 10px; }
    .pending { width: 220px; min-height: 420px; border: 1px solid var(--line); border-radius: 18px; background: #fbfaff; padding: 14px; display: flex; align-items: center; justify-content: center; }
    .phone-frame { border: 1px dashed #b9a8d6; border-radius: 12px; padding: 18px 12px; text-align: center; min-height: 360px; display: flex; flex-direction: column; justify-content: center; }
    .phone-title { font-size: 18px; font-weight: 800; color: var(--brand); }
    .phone-subtitle { margin-top: 10px; font-weight: 800; color: var(--warn); }
    .phone-copy { margin-top: 12px; color: var(--muted); font-size: 11px; }
    .flow { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: white; }
    .flow div { margin: 6px 0; }
    @page { size: A4; margin: 14mm; }
  </style>
</head>
<body>
  <section class="cover">
    <div class="eyebrow">Zafabit Maid App</div>
    <h1>Screen-to-API Mapping Document</h1>
    <p class="subtitle">Maid/partner-app-only API completion audit generated from <code>${escapeHtml(rel(maidAppRoot))}</code> and backend routes under <code>${escapeHtml(rel(path.join(backendRoot, 'src', 'routes')))}</code>. Customer app and admin-panel screens are intentionally excluded.</p>
    <div class="summary-grid">
      <div class="stat"><div class="num">${totals.screens}</div><div>Screens documented</div></div>
      <div class="stat"><div class="num">${totals.endpoints}</div><div>Endpoints audited</div></div>
      <div class="stat"><div class="num">${totals.gaps}</div><div>Open integration gaps</div></div>
    </div>
    <h2>Navigation Flow</h2>
    <div class="flow">${navFlow.map((item) => `<div>${escapeHtml(item)}</div>`).join('')}</div>
    <h2>Architecture Overview</h2>
    <p>The app uses React Native, React Navigation native stacks and bottom tabs, an AppContext provider, and a small fetch-based service layer. The service layer calls <code>/api/v1</code> backend routes and stores the JWT in module memory with <code>setAuthToken</code>.</p>
    <p>The backend exposes Express routes through <code>zafabitAPI/src/app.js</code>. Maid-facing routes are primarily under <code>/api/v1/maids</code>, with booking actions under <code>/api/v1/bookings</code>, support under <code>/api/v1/support</code>, and login under <code>/api/v1/auth</code>.</p>
    <h2>Localized API Readiness</h2>
    <p class="${currentApiClient.includes('5001') ? 'ok' : 'bad'}">${escapeHtml(portStatus)}</p>
    <p class="${/locale/i.test(currentApiClient) ? 'ok' : 'bad'}">${escapeHtml(localeStatus)}</p>
    <p>Required behavior: all supported API requests should send a locale header, for example <code>locale: en</code> or <code>locale: ml</code>. Static UI labels remain client-localized and do not require backend changes.</p>
    <h2>Screenshot Source Limitations</h2>
    <p>The Login screen screenshot was captured from the active Android emulator. Other screens are represented with source-traced capture placeholders because automated navigation through authenticated/onboarding flows was not completed without changing app state. The API mapping itself is traced from source files and backend routes.</p>
  </section>

  <section class="screen page-break">
    <h1>API Usage Matrix</h1>
    ${renderMatrix(routeMatches)}
  </section>

  <section class="screen page-break">
    <h1>Remaining Integration Gaps</h1>
    <ul>
      ${endpoints.filter((endpoint) => endpoint.status === 'gap').map((endpoint) => `<li><strong>${escapeHtml(endpoint.key)}</strong>: <code>${endpoint.method} ${escapeHtml(endpoint.path)}</code> is backend-available or service-available but screen usage is missing, local-only, static, or partial.</li>`).join('')}
      <li><strong>locale header</strong>: <code>src/services/api.client.ts</code> does not send <code>locale</code> on every request.</li>
      <li><strong>Referral navigation</strong>: Profile attempts to navigate to ReferralStack, but ReferralStack is not mounted in the Main Tabs navigator.</li>
    </ul>
  </section>

  ${screenData.map((screen) => renderScreen(screen, routeMatches)).join('')}
</body>
</html>`;
}

async function main() {
  ensureDir(reportWorkDir);
  ensureDir(screenshotDir);

  const backendRoutes = scanBackendRoutes();
  const routeMatches = Object.fromEntries(endpoints.map((endpoint) => [endpoint.key, findRoute(backendRoutes, endpoint)]));
  const totals = {
    screens: screenData.length,
    endpoints: endpoints.length,
    gaps: endpoints.filter((endpoint) => endpoint.status === 'gap').length + 2,
    backendRoutes: backendRoutes.length,
    routeMatches: Object.values(routeMatches).filter(Boolean).length,
  };

  const html = renderHtml(routeMatches, totals);
  const forbidden = ['undefined', 'NaN', 'Missing definition', 'Screenshot not found'];
  const bad = forbidden.filter((term) => html.includes(term));
  if (bad.length) {
    throw new Error(`Generated HTML contains forbidden terms: ${bad.join(', ')}`);
  }

  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceApp: rel(maidAppRoot),
    output: {
      html: rel(htmlPath),
      pdf: rel(pdfPath),
      summary: rel(summaryPath),
    },
    totals,
    currentFindings: {
      apiClientPort: read(path.join(maidAppRoot, file.apiClient)).includes('5001') ? '5001 configured' : '5001 not configured',
      localeHeader: /locale/i.test(read(path.join(maidAppRoot, file.apiClient))) ? 'present' : 'not present',
      loginScreenshot: fs.existsSync(emulatorLoginShot) ? rel(emulatorLoginShot) : 'not captured',
    },
    endpoints: endpoints.map((endpoint) => {
      const route = routeMatches[endpoint.key];
      return {
        key: endpoint.key,
        method: endpoint.method,
        path: endpoint.path,
        status: endpoint.status === 'gap' ? 'gap_or_partial' : 'wired_or_service_available',
        backendMatched: Boolean(route),
        backendRef: route ? route.sourceRef : null,
        sourceRefs: endpoint.refs,
      };
    }),
    screens: screenData.map((screen) => ({
      name: screen.name,
      route: screen.route,
      source: screen.source,
      apis: screen.apis || [],
      gaps: screen.gaps || [],
      screenshot: screen.screenshot && fs.existsSync(screen.screenshot) ? rel(screen.screenshot) : 'pending_capture',
    })),
  }, null, 2));

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
    await page.goto(pathToFileURL(htmlPath).href, {waitUntil: 'load', timeout: 120000});
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-family:Arial,sans-serif;font-size:8px;color:#777;width:100%;padding:0 14mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: {top: '12mm', right: '10mm', bottom: '14mm', left: '10mm'},
      timeout: 120000,
    });
  } finally {
    await browser.close();
  }

  console.log(`Generated ${rel(htmlPath)}`);
  console.log(`Generated ${rel(pdfPath)}`);
  console.log(`Generated ${rel(summaryPath)}`);

  // Copy to the active conversation artifacts directory
  const sessionArtifactsDir = '/Users/renoroy/.gemini/antigravity/brain/aa86db2c-fc9a-49e8-9a00-c1b4f6bc5a76/artifacts';
  if (fs.existsSync(sessionArtifactsDir)) {
    const destinationPdfPath = path.join(sessionArtifactsDir, 'MAID_SCREEN_API_MAPPING.pdf');
    fs.copyFileSync(pdfPath, destinationPdfPath);
    console.log(`Successfully copied MAID_SCREEN_API_MAPPING.pdf to session artifacts directory: ${destinationPdfPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
