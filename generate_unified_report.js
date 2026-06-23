const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const backendRoot = __dirname;
const workspaceRoot = path.resolve(backendRoot, '..');
const artifactsDir = path.join(backendRoot, 'artifacts');
const pdfPath = path.join(artifactsDir, 'zaffabit_unified_screen_api_mapping.pdf');
const htmlPath = path.join(artifactsDir, 'zaffabit_unified_screen_api_mapping.html');

// Create directories if not exists
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const customerScreens = [
  { name: 'Splash', route: 'Splash', apis: ['GET /content/splash'], apiCount: 1, purpose: 'Initial brand screen and entry point into onboarding. Loads admin-managed splash screen image.' },
  { name: 'Language Selection', route: 'Language', apis: ['PUT /auth/languager'], apiCount: 1, purpose: 'Captures preferred language and updates API response locale.' },
  { name: 'Login', route: 'Login', apis: ['POST /auth/send-otp'], apiCount: 1, purpose: 'Collects mobile number and requests OTP (SMS or WhatsApp).' },
  { name: 'Login Error', route: 'LoginError', apis: ['POST /auth/send-otp'], apiCount: 1, purpose: 'Shows invalid phone state and lets user retry request.' },
  { name: 'OTP Verification', route: 'OTP', apis: ['POST /auth/verify-otp', 'PUT /auth/push-token'], apiCount: 2, purpose: 'Verifies OTP, stores JWT and updates push token.' },
  { name: 'OTP Error', route: 'OTPError', apis: ['POST /auth/verify-otp'], apiCount: 1, purpose: 'Shows invalid OTP state and lets user retry.' },
  { name: 'Name Entry', route: 'Name', apis: ['PUT /auth/profile'], apiCount: 1, purpose: 'Collects first and last name after OTP verification.' },
  { name: 'Location Confirmation', route: 'Location', apis: ['GET /locations/serviceability', 'External IP Geolocation (ipapi.co/freeipapi.com/ipinfo.io)', 'External Static Maps (Yandex Maps)'], apiCount: 3, purpose: 'Finds current location and checks serviceability.' },
  { name: 'Location Search', route: 'LocationSearch', apis: ['GET /locations/search'], apiCount: 1, purpose: 'Searches known service areas for address suggestions.' },
  { name: 'Location Not Found', route: 'LocationNotFound', apis: [], apiCount: 0, purpose: 'Unsupported location screen.' },
  { name: 'Address Details', route: 'AddressDetails', apis: ['POST /customers/addresses'], apiCount: 1, purpose: 'Collects home address and saves it for bookings.' },
  { name: 'Home Details', route: 'CustomHomeDetails', apis: ['POST /customers/property-profile'], apiCount: 1, purpose: 'Captures home type, BHK size, members, and pets for estimates.' },
  { name: 'Custom Home Details', route: 'OtherHomeDetails', apis: [], apiCount: 0, purpose: 'Captures custom home details locally.' },
  { name: 'Home Tab', route: 'HomeTab', apis: ['GET /content/banners', 'GET /content/featured-services', 'GET /services', 'GET /cart', 'GET /customers/profile'], apiCount: 5, purpose: 'Customer landing screen with hero banners, service browsing, and cart status.' },
  { name: 'Booking History', route: 'BookingsTab', apis: ['GET /bookings'], apiCount: 1, purpose: 'Displays historical and active bookings.' },
  { name: 'Wallet Tab', route: 'WalletTab', apis: ['GET /customers/wallet', 'GET /customers/referral'], apiCount: 2, purpose: 'Displays wallet balance, reward points, and transactions.' },
  { name: 'Service List', route: 'ServiceList', apis: ['GET /services', 'POST /cart/items'], apiCount: 2, purpose: 'Lists backend service catalog.' },
  { name: 'Service Details', route: 'ServiceDetails', apis: ['GET /services/:id', 'GET /services', 'POST /cart/items'], apiCount: 3, purpose: 'Shows service detail, inclusions, exclusions, and FAQs.' },
  { name: 'Service Review', route: 'ServiceReview', apis: ['GET /bookings', 'POST /reviews'], apiCount: 2, purpose: 'Displays review form for completed bookings.' },
  { name: 'Hourly Services', route: 'HourlyServices', apis: ['GET /services', 'POST /cart/items'], apiCount: 2, purpose: 'Displays hourly service details.' },
  { name: 'Cart', route: 'Cart', apis: ['GET /cart', 'PUT /cart/items/:itemId', 'GET /customers/addresses', 'GET /customers/profile'], apiCount: 4, purpose: 'Displays selected services, address, profile, and bill summary.' },
  { name: 'Add More Services', route: 'AddMoreServices', apis: ['GET /services', 'POST /cart/items'], apiCount: 2, purpose: 'Lets the customer add another service to the cart.' },
  { name: 'Schedule Booking', route: 'Schedule', apis: ['GET /bookings/available-slots'], apiCount: 1, purpose: 'Loads available dates and time slots.' },
  { name: 'Instant Schedule', route: 'InstantSchedule', apis: [], apiCount: 0, purpose: 'Confirms instant booking mode.' },
  { name: 'One Hour Schedule', route: 'OneHourSchedule', apis: ['GET /bookings/available-slots'], apiCount: 1, purpose: 'Schedules one-hour service using available slots.' },
  { name: 'Booking Summary', route: 'BookingSummary', apis: ['POST /bookings/instant-availability', 'GET /cart', 'GET /customers/addresses', 'External Maps (Yandex Maps)'], apiCount: 4, purpose: 'Reviews service, address, bill, map, and maid availability.' },
  { name: 'Bill Details', route: 'BillDetails', apis: ['GET /cart', 'POST /bookings/from-cart', 'POST /payments/initiate', 'POST /payments/verify', 'DELETE /cart'], apiCount: 5, purpose: 'Displays payable amount and coordinates booking checkout/payment.' },
  { name: 'Payment Success', route: 'PaymentSuccess', apis: ['GET /bookings', 'POST /payments/verify'], apiCount: 2, purpose: 'Displays success modal and booking/payment summary.' },
  { name: 'Payment Failed', route: 'PaymentFailed', apis: ['GET /bookings', 'POST /payments/verify'], apiCount: 2, purpose: 'Displays failed payment modal.' },
  { name: 'Live Tracking', route: 'LiveTracking', apis: ['GET /bookings/:id/tracking', 'GET /bookings', 'Socket.IO Live Events', 'External Static Maps'], apiCount: 4, purpose: 'Shows live booking tracking map, provider status, timeline, and OTP hint.' },
  { name: 'Profile', route: 'Profile', apis: ['GET /customers/profile'], apiCount: 1, purpose: 'Displays account details and navigation links.' },
  { name: 'Edit Profile', route: 'EditProfile', apis: ['GET /customers/profile', 'PUT /customers/profile'], apiCount: 2, purpose: 'Edits profile details (first name, last name, phone).' },
  { name: 'Saved Addresses', route: 'SavedAddresses', apis: ['GET /customers/addresses', 'DELETE /customers/addresses/:id'], apiCount: 2, purpose: 'Lists saved addresses and deletes selected ones.' },
  { name: 'Edit Address', route: 'EditAddress', apis: ['GET /customers/addresses', 'PUT /customers/addresses/:id'], apiCount: 2, purpose: 'Edits saved address fields.' },
  { name: 'Update Home Address', route: 'UpdateHomeAddress', apis: ['GET /customers/profile', 'POST /customers/addresses'], apiCount: 2, purpose: 'Adds a new address from profile/account flow.' },
  { name: 'Refer', route: 'Refer', apis: ['GET /customers/referral'], apiCount: 1, purpose: 'Displays referral code and referral stats.' },
  { name: 'Add Money', route: 'AddMoney', apis: ['POST /customers/wallet/add-money'], apiCount: 1, purpose: 'Captures wallet top-up amount and adds balance.' },
  { name: 'Privacy Policy', route: 'PrivacyPolicy', apis: [], apiCount: 0, purpose: 'Legal privacy policy screen.' },
  { name: 'Terms and Conditions', route: 'Terms', apis: [], apiCount: 0, purpose: 'Legal terms screen.' },
  { name: 'Report Issue', route: 'ReportIssue', apis: ['POST /support/contact'], apiCount: 1, purpose: 'Collects support issue text and routes to help.' },
  { name: 'SOS', route: 'SOS', apis: ['GET /support/helplines', 'POST /support/sos'], apiCount: 2, purpose: 'Emergency support call-to-action.' },
  { name: 'Logout', route: 'Logout', apis: ['POST /auth/logout'], apiCount: 1, purpose: 'Confirms logout action and clears session.' },
  { name: 'Confirm Delete Account', route: 'ConfirmDeleteAccount', apis: ['DELETE /customers/delete-me'], apiCount: 1, purpose: 'Confirms permanent account deletion.' },
  { name: 'AI Chat Start', route: 'AIChat', apis: [], apiCount: 0, purpose: 'Entry screen for AI support assistant.' },
  { name: 'AI Chat Conversation', route: 'AIChatConversation', apis: ['POST /support/ai-chat'], apiCount: 1, purpose: 'Sends support messages and displays AI replies.' }
];

const maidScreens = [
  { name: 'Login', route: 'Login', apis: ['POST /auth/login'], apiCount: 1, purpose: 'Authenticates the maid/partner with employee ID and password.' },
  { name: 'Selfie Verification', route: 'SelfieVerification', apis: ['POST /maids/onboarding/selfie'], apiCount: 1, purpose: 'Captures or confirms worker selfie during onboarding.' },
  { name: 'Job Type', route: 'JobType', apis: ['POST /maids/onboarding/job-type'], apiCount: 1, purpose: 'Lets the worker choose full-time or part-time preference.' },
  { name: 'Work Area', route: 'LocationPermission', apis: ['POST /maids/onboarding/work-areas', 'PATCH /maids/location'], apiCount: 2, purpose: 'Collects preferred work areas and location permission context.' },
  { name: 'Confirm Details', route: 'ConfirmDetails', apis: ['POST /maids/onboarding/confirm'], apiCount: 1, purpose: 'Reviews onboarding choices before entering main tabs.' },
  { name: 'Home', route: 'Home', apis: ['GET /maids/dashboard', 'PATCH /maids/availability', 'GET /maids/my-jobs?tab=new', 'POST /bookings/:id/respond', 'GET /maids/notifications'], apiCount: 5, purpose: 'Dashboard with availability toggle, new request card, summary counters, and notification bell.' },
  { name: 'Jobs List', route: 'Jobs', apis: ['GET /maids/my-jobs', 'POST /bookings/:id/respond'], apiCount: 2, purpose: 'Shows new, upcoming, and completed jobs.' },
  { name: 'Job Details', route: 'JobsDetails', apis: ['GET /bookings/:id', 'POST /bookings/:id/respond'], apiCount: 2, purpose: 'Displays selected job detail, customer address, and action controls.' },
  { name: 'OTP Verification', route: 'OTPVerification', apis: ['POST /bookings/:id/verify-start'], apiCount: 1, purpose: 'Verifies customer-provided OTP before starting service.' },
  { name: 'Active Job', route: 'ActiveJobView', apis: ['GET /maids/active-job', 'PATCH /bookings/:id/checklist/:index', 'POST /bookings/:id/complete', 'GET /maids/active-job/extra-time-status'], apiCount: 4, purpose: 'Tracks in-progress job, checklist, timer, extra time, and completion.' },
  { name: 'Extra Time Request', route: 'ExtraTimeRequest', apis: ['POST /bookings/:id/extra-time', 'GET /maids/active-job/extra-time-status'], apiCount: 2, purpose: 'Requests additional paid work time for active booking.' },
  { name: 'Earnings', route: 'Earnings', apis: ['GET /maids/earnings', 'GET /maids/referral-info', 'GET /maids/notifications'], apiCount: 3, purpose: 'Displays earnings breakdown, weekly trends, and referral card.' },
  { name: 'Referral', route: 'Referral', apis: ['GET /maids/referral-info'], apiCount: 1, purpose: 'Shows referral rewards, code, and referred workers.' },
  { name: 'Profile', route: 'Profile', apis: ['GET /maids/profile-info', 'GET /maids/notifications'], apiCount: 2, purpose: 'Displays partner profile summary and account settings.' },
  { name: 'Personal Information', route: 'PersonalInformation', apis: ['GET /maids/profile-info', 'PUT /maids/profile-info', 'POST /maids/onboarding/job-type', 'POST /maids/onboarding/work-areas', 'PATCH /maids/notifications/read-all'], apiCount: 5, purpose: 'Shows and edits partner name, language, job type, work area, and notifications.' },
  { name: 'Edit Personal Information', route: 'EditPersonalInformation', apis: [], apiCount: 0, purpose: 'Modal redirect for personal information editing.' },
  { name: 'Privacy Terms', route: 'PrivacyTerms', apis: [], apiCount: 0, purpose: 'Displays static partner privacy and terms text.' },
  { name: 'Support & Safety', route: 'SupportSafety', apis: ['POST /support/contact'], apiCount: 1, purpose: 'Entry point for support topics and safety issue reporting.' },
  { name: 'AI Chat Entry', route: 'AIChat', apis: [], apiCount: 0, purpose: 'Intro screen before opening AI support chat.' },
  { name: 'AI Chat Screen', route: 'AIChatScreen', apis: ['POST /support/ai-chat'], apiCount: 1, purpose: 'Partner support chat screen with AI replies.' },
  { name: 'Report Issue', route: 'ReportIssue', apis: ['POST /support/contact'], apiCount: 1, purpose: 'Collects support issue category and details.' },
  { name: 'Error Screens', route: 'ErrorScreens', apis: [], apiCount: 0, purpose: 'Shared offline, location, not-found, and unauthorized error screens.' }
];

function generateHtml() {
  const customerRows = customerScreens.map((s, idx) => `
    <tr>
      <td style="font-weight: 600;">${idx + 1}</td>
      <td style="font-weight: 600; color: #1e3a8a;">${s.name}</td>
      <td><code>${s.route}</code></td>
      <td style="text-align: center;"><span class="badge ${s.apiCount > 0 ? 'badge-blue' : 'badge-gray'}">${s.apiCount}</span></td>
      <td>${s.apis.length > 0 ? s.apis.map(api => `<div class="api-item"><code>${api}</code></div>`).join('') : '<span style="color: #9ca3af; font-style: italic;">None (Local Only)</span>'}</td>
      <td style="font-size: 11px; color: #4b5563;">${s.purpose}</td>
    </tr>
  `).join('');

  const maidRows = maidScreens.map((s, idx) => `
    <tr>
      <td style="font-weight: 600;">${idx + 1}</td>
      <td style="font-weight: 600; color: #581c87;">${s.name}</td>
      <td><code>${s.route}</code></td>
      <td style="text-align: center;"><span class="badge ${s.apiCount > 0 ? 'badge-purple' : 'badge-gray'}">${s.apiCount}</span></td>
      <td>${s.apis.length > 0 ? s.apis.map(api => `<div class="api-item"><code>${api}</code></div>`).join('') : '<span style="color: #9ca3af; font-style: italic;">None (Local Only)</span>'}</td>
      <td style="font-size: 11px; color: #4b5563;">${s.purpose}</td>
    </tr>
  `).join('');

  const totalCustomerApis = customerScreens.reduce((sum, s) => sum + s.apiCount, 0);
  const totalMaidApis = maidScreens.reduce((sum, s) => sum + s.apiCount, 0);

  return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Zaffabit Unified Screen API Mapping</title>
    <style>
      :root {
        --primary-blue: #1e40af;
        --primary-purple: #6b21a8;
        --dark-ink: #0f172a;
        --gray-text: #475569;
        --border-color: #cbd5e1;
        --soft-bg: #f8fafc;
        --blue-badge-bg: #dbeafe;
        --blue-badge-text: #1e40af;
        --purple-badge-bg: #f3e8ff;
        --purple-badge-text: #6b21a8;
        --gray-badge-bg: #f1f5f9;
        --gray-badge-text: #64748b;
      }
      body {
        margin: 0;
        padding: 40px;
        color: var(--dark-ink);
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        background: #ffffff;
      }
      .header {
        border-bottom: 3px double var(--primary-blue);
        padding-bottom: 24px;
        margin-bottom: 30px;
      }
      .app-title {
        font-size: 32px;
        font-weight: 800;
        color: var(--primary-blue);
        margin: 0;
      }
      .app-subtitle {
        font-size: 16px;
        color: var(--gray-text);
        margin: 8px 0 0 0;
        font-weight: 400;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 15px;
        margin: 24px 0;
      }
      .stat-card {
        background: var(--soft-bg);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 15px;
        text-align: center;
      }
      .stat-value {
        font-size: 28px;
        font-weight: 800;
        color: var(--primary-blue);
        margin-bottom: 4px;
      }
      .stat-value.purple {
        color: var(--primary-purple);
      }
      .stat-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--gray-text);
        letter-spacing: 0.05em;
      }
      h2 {
        font-size: 20px;
        font-weight: 700;
        color: var(--dark-ink);
        border-left: 5px solid var(--primary-blue);
        padding-left: 10px;
        margin-top: 40px;
        margin-bottom: 15px;
      }
      h2.purple {
        border-left-color: var(--primary-purple);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 10px 0 30px;
        font-size: 11px;
      }
      th {
        background: var(--soft-bg);
        border: 1px solid var(--border-color);
        padding: 10px 8px;
        text-align: left;
        font-weight: 700;
        color: var(--gray-text);
      }
      td {
        border: 1px solid var(--border-color);
        padding: 8px;
        vertical-align: top;
      }
      .badge {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 9999px;
        font-weight: 700;
        font-size: 10px;
      }
      .badge-blue {
        background: var(--blue-badge-bg);
        color: var(--blue-badge-text);
      }
      .badge-purple {
        background: var(--purple-badge-bg);
        color: var(--purple-badge-text);
      }
      .badge-gray {
        background: var(--gray-badge-bg);
        color: var(--gray-badge-text);
      }
      code {
        font-family: Menlo, Monaco, Consolas, monospace;
        font-size: 10px;
        background: #f1f5f9;
        padding: 2px 4px;
        border-radius: 4px;
      }
      .api-item {
        margin-bottom: 4px;
      }
      .api-item:last-child {
        margin-bottom: 0;
      }
      .footer {
        text-align: center;
        padding: 30px 0;
        border-top: 1px solid var(--border-color);
        margin-top: 50px;
        color: var(--gray-text);
        font-size: 10px;
      }
      @media print {
        .page-break {
          page-break-before: always;
        }
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1 class="app-title">Zaffabit Platform Audit</h1>
      <h2 class="app-subtitle" style="border: none; padding: 0; margin: 4px 0 0;">Unified Screen-to-API Mapping Report</h2>
      <p style="margin-top: 12px; color: var(--gray-text);">
        This document provides a comprehensive mapping of all UI screens to their respective backend API endpoints for the Zaffabit mobile application suite (Customer and Maid apps).
      </p>
    </div>

    <div class="meta-grid">
      <div class="stat-card">
        <div class="stat-value">${customerScreens.length}</div>
        <div class="stat-label">Customer Screens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value purple">${maidScreens.length}</div>
        <div class="stat-label">Maid Screens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalCustomerApis}</div>
        <div class="stat-label">Customer API Integrations</div>
      </div>
      <div class="stat-card">
        <div class="stat-value purple">${totalMaidApis}</div>
        <div class="stat-label">Maid API Integrations</div>
      </div>
    </div>

    <h2>1. Customer Mobile Application Screens</h2>
    <p style="color: var(--gray-text); margin-bottom: 15px;">
      Total of <strong>${customerScreens.length} screens</strong>, interacting with <strong>${totalCustomerApis} API endpoints</strong> (including internal API mappings and third-party integrations).
    </p>
    <table>
      <thead>
        <tr>
          <th style="width: 4%;">#</th>
          <th style="width: 22%;">Screen Name</th>
          <th style="width: 18%;">Route Name</th>
          <th style="width: 10%; text-align: center;">APIs Count</th>
          <th style="width: 26%;">API Endpoints Consumed</th>
          <th style="width: 20%;">Purpose</th>
        </tr>
      </thead>
      <tbody>
        ${customerRows}
      </tbody>
    </table>

    <div class="page-break"></div>

    <h2 class="purple">2. Maid Mobile Application Screens</h2>
    <p style="color: var(--gray-text); margin-bottom: 15px;">
      Total of <strong>${maidScreens.length} screens</strong>, interacting with <strong>${totalMaidApis} API endpoints</strong>.
    </p>
    <table>
      <thead>
        <tr>
          <th style="width: 4%;">#</th>
          <th style="width: 22%;">Screen Name</th>
          <th style="width: 18%;">Route Name</th>
          <th style="width: 10%; text-align: center;">APIs Count</th>
          <th style="width: 26%;">API Endpoints Consumed</th>
          <th style="width: 20%;">Purpose</th>
        </tr>
      </thead>
      <tbody>
        ${maidRows}
      </tbody>
    </table>

    <div class="footer">
      Generated automatically by Antigravity AI Assistant &bull; Zaffabit Platform Audit &bull; ${new Date().toLocaleDateString()}
    </div>
  </body>
  </html>
  `;
}

async function main() {
  const html = generateHtml();
  fs.writeFileSync(htmlPath, html);
  console.log(`Successfully generated HTML at: ${htmlPath}`);

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (fs.existsSync(chromePath)) {
    launchOptions.executablePath = chromePath;
  }

  console.log('Launching browser to print PDF...');
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 120000 });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-family:Arial,sans-serif;font-size:8px;color:#777;width:100%;padding:0 14mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: '12mm', right: '10mm', bottom: '14mm', left: '10mm' },
      timeout: 120000,
    });
    console.log(`Successfully generated PDF at: ${pdfPath}`);

    // Copy to the active conversation artifacts directory
    const sessionArtifactsDir = '/Users/renoroy/.gemini/antigravity/brain/9ce33d02-df44-4d49-a9b9-9aece960683d/artifacts';
    if (!fs.existsSync(sessionArtifactsDir)) {
      fs.mkdirSync(sessionArtifactsDir, { recursive: true });
    }
    const destinationPdfPath = path.join(sessionArtifactsDir, 'zaffabit_unified_screen_api_mapping.pdf');
    fs.copyFileSync(pdfPath, destinationPdfPath);
    console.log(`Successfully copied PDF to session artifacts directory: ${destinationPdfPath}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error occurred:', err);
  process.exit(1);
});
