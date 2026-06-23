const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zaffabit - React Native Mobile API Gap Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
    
    :root {
      --indigo: #6366f1;
      --indigo-soft: #eef2ff;
      --emerald: #10b981;
      --emerald-soft: #ecfdf5;
      --rose: #ef4444;
      --rose-soft: #fef2f2;
      --amber: #f59e0b;
      --amber-soft: #fffbeb;
      --ink: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
      --bg: #ffffff;
      --bg-soft: #f8fafc;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      color: #334155;
      margin: 0;
      padding: 40px;
      background-color: var(--bg);
      -webkit-print-color-adjust: exact;
    }
    
    .header {
      border-bottom: 2px solid var(--ink);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    
    .header-logo {
      font-size: 24px;
      font-weight: 800;
      color: var(--ink);
      letter-spacing: -0.03em;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
    }
    
    .header-logo span {
      background: linear-gradient(135deg, var(--indigo) 0%, var(--emerald) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-left: 6px;
    }
    
    .header-tagline {
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 700;
    }
    
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: var(--ink);
      margin-top: 0;
      margin-bottom: 12px;
    }
    
    h2 {
      font-size: 16px;
      font-weight: 700;
      color: var(--ink);
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
      margin-top: 30px;
      margin-bottom: 15px;
      page-break-after: avoid;
    }

    p {
      margin-top: 0;
      margin-bottom: 14px;
      font-size: 13px;
      color: #475569;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-bottom: 25px;
    }

    .meta-card {
      background: var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 16px;
    }

    .meta-card h3 {
      margin: 0 0 6px 0;
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .meta-card p {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: var(--ink);
    }
    
    .table-container {
      margin-bottom: 25px;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      page-break-inside: avoid;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }
    
    th {
      background-color: #f1f5f9;
      color: #334155;
      font-weight: 600;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      color: #475569;
      vertical-align: top;
    }
    
    tr:last-child td {
      border-bottom: none;
    }
    
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .priority-required { background-color: var(--rose-soft); color: var(--rose); }
    .priority-recommended { background-color: var(--amber-soft); color: var(--amber); }
    
    .http-method {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      color: #ffffff;
      text-transform: uppercase;
      margin-right: 4px;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .method-get { background-color: var(--emerald); }
    .method-post { background-color: var(--indigo); }
    .method-put { background-color: var(--amber); }
    .method-patch { background-color: #8b5cf6; }
    .method-delete { background-color: var(--rose); }

    .route-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--ink);
    }

    .source-list {
      background-color: var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 25px;
    }

    .source-list h4 {
      margin: 0 0 6px 0;
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
    }

    .source-list ul {
      margin: 0;
      padding-left: 20px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      color: var(--ink);
    }

    .source-list li {
      margin-bottom: 4px;
    }

    .notes-box {
      background-color: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 15px 20px;
      margin-top: 25px;
      page-break-inside: avoid;
    }

    .notes-box h3 {
      margin-top: 0;
      margin-bottom: 10px;
      color: #15803d;
      font-size: 14px;
      font-weight: 700;
    }

    .notes-box ul {
      margin: 0;
      padding-left: 20px;
      font-size: 12px;
      color: #166534;
    }

    .notes-box li {
      margin-bottom: 6px;
    }

    .page-break {
      page-break-before: always;
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-logo">Zaffabit<span>Mobile API Gap Report</span></div>
    <div class="header-tagline">Generated for the Customer React Native App in ZaffabitApp</div>
  </div>

  <h1>React Native Mobile API Gap Report</h1>
  <p>
    This report outlines the integration validation, active route groups, and missing backend API endpoints identified during the mobile integration audit.
  </p>

  <h2>✅ Verification Metrics</h2>
  <div class="meta-grid">
    <div class="meta-card">
      <h3>Jest Test Coverage</h3>
      <p>55 / 55 Passed (All exported screens render)</p>
    </div>
    <div class="meta-card">
      <h3>TypeScript Status</h3>
      <p>npx tsc --noEmit Passed (0 Errors)</p>
    </div>
  </div>

  <div class="source-list">
    <h4>Core Integration Source Files</h4>
    <ul>
      <li>src/api/client.ts</li>
      <li>src/api/mobileApi.ts</li>
      <li>src/api/mobileApiContract.ts</li>
    </ul>
  </div>

  <h2>📦 Integrated Backend Route Groups</h2>
  <p>
    The mobile application currently implements a typed API wrapper matching the following functional route groups in the backend:
  </p>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th style="width: 25%;">Group</th>
          <th style="width: 75%;">Configured Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><b>Auth</b></td>
          <td>OTP send/verify, current user, logout, profile update, push token.</td>
        </tr>
        <tr>
          <td><b>Customer & Addresses</b></td>
          <td>Get/update profile, list/create/update/delete saved addresses, get/save home details (property profile).</td>
        </tr>
        <tr>
          <td><b>Wallet & Referral</b></td>
          <td>Retrieve wallet details, add money, referral stats, apply referral code.</td>
        </tr>
        <tr>
          <td><b>Services & Cart</b></td>
          <td>List services, details, duration/pricing estimates, policies, cart CRUD.</td>
        </tr>
        <tr>
          <td><b>Bookings & Payments</b></td>
          <td>Booking estimation, create direct/from-cart bookings, cancel booking, approve extra time, initiate/verify payment.</td>
        </tr>
        <tr>
          <td><b>Reviews & Support</b></td>
          <td>Submit completed reviews, raise issues, list maid reviews, helplines, contact, SOS panic route.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="page-break"></div>

  <h2>🚨 Missing Required APIs (Integration Gaps)</h2>
  <p>
    These endpoints are currently expected/needed by the React Native screen flows but do not exist in the Express backend (<code>zafabitAPI</code>):
  </p>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th style="width: 10%;">Method</th>
          <th style="width: 30%;">Missing Endpoint</th>
          <th style="width: 20%;">Needed By</th>
          <th style="width: 40%;">Reason / Detail</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="http-method method-get">GET</span></td>
          <td><span class="route-code">/api/v1/locations/search</span></td>
          <td>LocationSearch</td>
          <td>Location search/autocomplete is hardcoded in the app.</td>
        </tr>
        <tr>
          <td><span class="http-method method-get">GET</span></td>
          <td><span class="route-code">/api/v1/locations/serviceability</span></td>
          <td>Location, LocationNotFound</td>
          <td>Needs to confirm whether selected customer location is serviceable.</td>
        </tr>
        <tr>
          <td><span class="http-method method-get">GET</span></td>
          <td><span class="route-code">/api/v1/bookings/available-slots</span></td>
          <td>Schedule, OneHourSchedule</td>
          <td>Booking slots are hardcoded; needs dynamic slots checker.</td>
        </tr>
        <tr>
          <td><span class="http-method method-get">GET</span></td>
          <td><span class="route-code">/api/v1/bookings/:id/tracking</span></td>
          <td>LiveTracking</td>
          <td>No endpoint provides maid live location, ETA, timeline, or start OTP.</td>
        </tr>
        <tr>
          <td><span class="http-method method-delete">DELETE</span></td>
          <td><span class="route-code">/api/v1/auth/me</span></td>
          <td>ConfirmDeleteAccount, Profile</td>
          <td>Account removal currently signs out only; backend deletion logic missing.</td>
        </tr>
        <tr>
          <td><span class="http-method method-post">POST</span></td>
          <td><span class="route-code">/api/v1/support/ai-chat</span></td>
          <td>AIChat, AIChatConversation</td>
          <td>AI/support assistant chat is locally mocked.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h2>⚡ Recommended APIs</h2>
  <p>
    These are not critical blockers but are recommended to support concepts presented in the mobile UI:
  </p>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th style="width: 10%;">Method</th>
          <th style="width: 30%;">Endpoint</th>
          <th style="width: 20%;">Needed By</th>
          <th style="width: 40%;">Reason / Detail</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="http-method method-get">GET</span></td>
          <td><span class="route-code">/api/v1/support/ai-chat/:conversationId</span></td>
          <td>AIChatConversation</td>
          <td>Restore previous assistant chat history.</td>
        </tr>
        <tr>
          <td><span class="http-method method-get">GET</span></td>
          <td><span class="route-code">/api/v1/customers/payment-methods</span></td>
          <td>Profile, BillDetails</td>
          <td>Payment methods list endpoint to display saved credentials.</td>
        </tr>
        <tr>
          <td><span class="http-method method-post">POST</span></td>
          <td><span class="route-code">/api/v1/customers/payment-methods</span></td>
          <td>BillDetails</td>
          <td>Save card/UPI token details for future quick checkouts.</td>
        </tr>
        <tr>
          <td><span class="http-method method-delete">DELETE</span></td>
          <td><span class="route-code">/api/v1/customers/payment-methods/:id</span></td>
          <td>BillDetails</td>
          <td>Remove a saved payment method.</td>
        </tr>
        <tr>
          <td><span class="http-method method-post">POST</span></td>
          <td><span class="route-code">/api/v1/customers/wallet/redeem</span></td>
          <td>WalletTab</td>
          <td>Wallet screen has a "Redeem" button.</td>
        </tr>
        <tr>
          <td><span class="http-method method-post">POST</span></td>
          <td><span class="route-code">/api/v1/customers/wallet/top-up/initiate</span></td>
          <td>AddMoney</td>
          <td>Production top-up should initiate gateway payment order rather than direct credit.</td>
        </tr>
        <tr>
          <td><span class="http-method method-post">POST</span></td>
          <td><span class="route-code">/api/v1/customers/wallet/top-up/verify</span></td>
          <td>AddMoney</td>
          <td>Gateway verify transaction signature check for top-ups.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="notes-box">
    <h3>💡 Critical Integration Notes</h3>
    <ul>
      <li><b>Routing Conflict:</b> <code>GET /api/v1/bookings/available-slots</code> would currently be swallowed by the dynamic <code>GET /api/v1/bookings/:id</code> route. Static bookings routes must be mounted <b>before</b> dynamic parameters in Express.</li>
      <li><b>Cart Structure:</b> Cart quantity is duration-based. <code>PUT /api/v1/cart/items/:itemId</code> updates duration and deletes items when duration is less than or equal to 0.</li>
      <li><b>Legal Copy:</b> <code>GET /api/v1/services/policy</code> only returns cancellation policies. Detailed Privacy/Terms content remains static in the mobile app.</li>
    </ul>
  </div>

</body>
</html>
`;

async function main() {
  console.log('Initiating HTML generation...');
  const artifactsDir = path.join(__dirname, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const htmlPath = path.join(artifactsDir, 'react_native_mobile_api_gap_report.html');
  const pdfPath = path.join(artifactsDir, 'react_native_mobile_api_gap_report.pdf');

  fs.writeFileSync(htmlPath, htmlContent);
  console.log(`HTML report written successfully to ${htmlPath}`);

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  console.log(`Launching Google Chrome from: ${chromePath}`);

  try {
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    console.log('Browser launched. Rendering report...');
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    console.log('Compiling PDF...');
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        bottom: '15mm',
        left: '12mm',
        right: '12mm'
      }
    });

    await browser.close();
    console.log(`PDF compiled successfully! Saved at: ${pdfPath}`);
    
    // Copy to the active conversation artifacts directory
    const sessionArtifactsDir = '/Users/renoroy/.gemini/antigravity/brain/aa86db2c-fc9a-49e8-9a00-c1b4f6bc5a76/artifacts';
    if (fs.existsSync(sessionArtifactsDir)) {
      const destinationPdfPath = path.join(sessionArtifactsDir, 'react_native_mobile_api_gap_report.pdf');
      fs.copyFileSync(pdfPath, destinationPdfPath);
      console.log(`Successfully copied PDF to session artifacts directory: ${destinationPdfPath}`);
    }

  } catch (error) {
    console.error('Failed to convert HTML to PDF:', error);
    process.exit(1);
  }
}

main();
