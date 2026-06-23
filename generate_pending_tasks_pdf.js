const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function main() {
  console.log('🚀 Starting Updated Pending Tasks & API Gaps PDF Generation...');

  const artifactsDir = path.join(__dirname, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const htmlPath = path.join(artifactsDir, 'pending_tasks_report.html');
  const pdfPath = path.join(artifactsDir, 'pending_tasks_report.pdf');

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zaffabit API & Screen Gaps Roadmap</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap');

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      color: #1e293b;
      background-color: #ffffff;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* Page container setup for A4 printing */
    .page {
      width: 210mm;
      height: 297mm;
      padding: 20mm 20mm 20mm 20mm;
      position: relative;
      background: #ffffff;
      overflow: hidden;
    }

    @media print {
      body {
        background: #ffffff;
      }
      .page {
        margin: 0;
        border: none;
        box-shadow: none;
        page-break-after: always;
        break-after: page;
      }
      .page:last-child {
        page-break-after: avoid;
        break-after: avoid;
      }
    }

    /* Header Styling */
    .header-container {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 5mm;
      margin-bottom: 5mm;
    }

    .meta-tag {
      display: inline-block;
      background: #eff6ff;
      color: #3b82f6;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 1.2mm 3mm;
      border-radius: 9999px;
      margin-bottom: 2.5mm;
    }

    h1 {
      font-size: 18pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.025em;
      line-height: 1.2;
    }

    .subtitle {
      font-size: 9.5pt;
      color: #64748b;
      margin-top: 1mm;
      font-weight: 400;
    }

    .section-title {
      font-size: 12pt;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 3.5mm;
      display: flex;
      align-items: center;
      gap: 2mm;
      margin-top: 2mm;
    }

    .section-title::before {
      content: '';
      display: inline-block;
      width: 3mm;
      height: 4.5mm;
      background: #3b82f6;
      border-radius: 1mm;
    }

    /* Task Card Grid */
    .tasks-grid {
      display: flex;
      flex-direction: column;
      gap: 3.2mm;
    }

    .task-card {
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 2mm;
      padding: 3.5mm 4mm;
      border-left: 4px solid #3b82f6;
    }

    .task-card.priority-high {
      border-left-color: #ef4444;
      background: #fef2f2;
    }

    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5mm;
    }

    .task-name {
      font-size: 10pt;
      font-weight: 700;
      color: #0f172a;
    }

    .route-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 8.2pt;
      font-weight: 700;
      color: #0f172a;
      background: #e2e8f0;
      padding: 0.5mm 1.8mm;
      border-radius: 1mm;
    }

    .http-method {
      color: #ffffff;
      background: #3b82f6;
      padding: 0.3mm 1.2mm;
      border-radius: 0.5mm;
      margin-right: 1mm;
      font-size: 7.5pt;
    }

    .http-method.get { background: #10b981; }
    .http-method.post { background: #6366f1; }
    .http-method.delete { background: #ef4444; }

    .task-desc {
      font-size: 8.8pt;
      color: #334155;
      line-height: 1.4;
    }

    .task-meta {
      font-size: 8pt;
      color: #64748b;
      margin-top: 1mm;
    }

    /* Page Footer styling */
    .page-footer {
      position: absolute;
      bottom: 15mm;
      left: 20mm;
      right: 20mm;
      border-top: 1px solid #e2e8f0;
      padding-top: 3.5mm;
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #94a3b8;
    }

    /* Roadmap Timeline & sign-off */
    .timeline-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 2mm;
      margin-bottom: 5mm;
    }

    .timeline-table th, .timeline-table td {
      border: 1px solid #e2e8f0;
      padding: 2mm 3mm;
      font-size: 8.5pt;
      text-align: left;
    }

    .timeline-table th {
      background: #f1f5f9;
      font-weight: 700;
      color: #0f172a;
    }

    .timeline-table td {
      color: #334155;
    }

    .sign-off-container {
      display: flex;
      justify-content: space-between;
      margin-top: 6mm;
      gap: 10mm;
    }

    .signature-box {
      flex: 1;
      border-top: 1.5px dashed #cbd5e1;
      padding-top: 2mm;
      font-size: 8.5pt;
      color: #64748b;
      margin-top: 6mm;
    }

    .signature-title {
      font-weight: 600;
      color: #334155;
      margin-bottom: 1mm;
    }

  </style>
</head>
<body>

  <!-- ================= PAGE 1 ================= -->
  <div class="page">
    <div class="header-container">
      <span class="meta-tag">Screen Integration & Gap Analysis</span>
      <h1>Zaffabit Mobile App Screen Gaps Roadmap</h1>
      <p class="subtitle">A list of missing backend API endpoints required by Customer & Maid screens (Page 1 of 2)</p>
    </div>

    <div class="section-title">Missing Required APIs (Integration Gaps)</div>

    <div class="tasks-grid">
      <div class="task-card priority-high">
        <div class="task-header">
          <span class="task-name">1. Dynamic Location Autocomplete Search</span>
          <span class="route-badge"><span class="http-method get">GET</span>/api/v1/locations/search</span>
        </div>
        <p class="task-desc">Provide real-time location suggestion and geocoding services. Connect the search bar directly to Google Places or Mapbox API via this backend proxy route, rather than relying on hardcoded location items in the mobile client.</p>
        <p class="task-meta"><strong>Needed By Screen:</strong> <code>LocationSearch</code> | <strong>Status:</strong> Mocked in Mobile</p>
      </div>

      <div class="task-card priority-high">
        <div class="task-header">
          <span class="task-name">2. Operational Area Serviceability Guard</span>
          <span class="route-badge"><span class="http-method get">GET</span>/api/v1/locations/serviceability</span>
        </div>
        <p class="task-desc">Verify if a selected coordinate is within coordinates serviced by maids. Gate the customer checkout flow to prevent users from placing bookings in unserviceable regions.</p>
        <p class="task-meta"><strong>Needed By Screens:</strong> <code>Location</code>, <code>LocationNotFound</code> | <strong>Status:</strong> Missing</p>
      </div>

      <div class="task-card priority-high">
        <div class="task-header">
          <span class="task-name">3. Dynamic Scheduled Time Slots</span>
          <span class="route-badge"><span class="http-method get">GET</span>/api/v1/bookings/available-slots</span>
        </div>
        <p class="task-desc">Calculate and return dynamic scheduling slots for bookings. This endpoint must check slot conflicts, capacity constraints, and operational windows instead of displaying static time intervals.</p>
        <p class="task-meta"><strong>Needed By Screens:</strong> <code>Schedule</code>, <code>OneHourSchedule</code> | <strong>Status:</strong> Hardcoded</p>
      </div>

      <div class="task-card priority-high">
        <div class="task-header">
          <span class="task-name">4. Real-time Maid Location Tracking & ETA</span>
          <span class="route-badge"><span class="http-method get">GET</span>/api/v1/bookings/:id/tracking</span>
        </div>
        <p class="task-desc">Expose current coordinate records, estimated time of arrival (ETA), current route geometry, and the unique start OTP for transit or arrived states of active bookings.</p>
        <p class="task-meta"><strong>Needed By Screen:</strong> <code>LiveTracking</code> | <strong>Status:</strong> Missing</p>
      </div>

      <div class="task-card priority-high">
        <div class="task-header">
          <span class="task-name">5. Permanent Account Deletion</span>
          <span class="route-badge"><span class="http-method delete">DELETE</span>/api/v1/auth/me</span>
        </div>
        <p class="task-desc">Enforce privacy policies by deleting user credentials, active profiles, and anonymizing history in the database. Currently, the client app only deletes the local auth token to sign out.</p>
        <p class="task-meta"><strong>Needed By Screens:</strong> <code>ConfirmDeleteAccount</code>, <code>Profile</code> | <strong>Status:</strong> Missing</p>
      </div>

      <div class="task-card priority-high">
        <div class="task-header">
          <span class="task-name">6. AI Assistant Chat Integration</span>
          <span class="route-badge"><span class="http-method post">POST</span>/api/v1/support/ai-chat</span>
        </div>
        <p class="task-desc">Receive customer messages and call the AI/support agent model to return helpful responses. This endpoint processes conversational queries regarding service policies and booking support.</p>
        <p class="task-meta"><strong>Needed By Screens:</strong> <code>AIChat</code>, <code>AIChatConversation</code> | <strong>Status:</strong> Mocked in Mobile</p>
      </div>
    </div>

    <div class="page-footer">
      <span>Zaffabit API Screen Gaps Roadmap</span>
      <span>Page 1 of 2</span>
    </div>
  </div>

  <!-- ================= PAGE 2 ================= -->
  <div class="page">
    <div class="header-container">
      <span class="meta-tag">Screen Integration & Hardening</span>
      <h1>Zaffabit Mobile App Screen Gaps Roadmap</h1>
      <p class="subtitle">Recommended client features, non-payment optimizations, and timeline (Page 2 of 2)</p>
    </div>

    <div class="section-title">Recommended Auxiliary Screen APIs</div>

    <div class="tasks-grid">
      <div class="task-card">
        <div class="task-header">
          <span class="task-name">7. Chat History Restoration</span>
          <span class="route-badge"><span class="http-method get">GET</span>/api/v1/support/ai-chat/:conversationId</span>
        </div>
        <p class="task-desc">Fetch and return historical chat details between the customer and support assistant. This allows conversational persistence when switching screens or restarting the app.</p>
        <p class="task-meta"><strong>Needed By Screen:</strong> <code>AIChatConversation</code> | <strong>Status:</strong> Missing</p>
      </div>

      <div class="task-card">
        <div class="task-header">
          <span class="task-name">8. Wallet Points Redemption</span>
          <span class="route-badge"><span class="http-method post">POST</span>/api/v1/customers/wallet/redeem</span>
        </div>
        <p class="task-desc">Process requests when a user clicks the "Redeem" action on their profile wallet screen, converting promotional points into credit balance.</p>
        <p class="task-meta"><strong>Needed By Screen:</strong> <code>WalletTab</code> | <strong>Status:</strong> Missing</p>
      </div>
    </div>

    <div class="section-title" style="margin-top: 4mm;">Core Non-Payment Backend Hardening</div>
    <div class="tasks-grid">
      <div class="task-card" style="border-left-color: #f59e0b; background: #fffbeb;">
        <div class="task-header">
          <span class="task-name">9. Redis-Backed Queue Worker (BullMQ) & WebSocket Scale</span>
          <span class="route-badge">Infrastructure</span>
        </div>
        <p class="task-desc">Replace CPU-intensive MongoDB polling with Redis-backed BullMQ for job assignments. Bind Socket.io with the Redis Adapter to enable clean coordination of maid live locations across server instances.</p>
      </div>
      <div class="task-card" style="border-left-color: #f59e0b; background: #fffbeb;">
        <div class="task-header">
          <span class="task-name">10. Push Notifications & Cloud Media Storage</span>
          <span class="route-badge">Notifications & Media</span>
        </div>
        <p class="task-desc">Implement FCM notification delivery for incoming offers. Move local document uploads to AWS S3/Cloudinary to support distributed cloud environments.</p>
      </div>
    </div>

    <div class="section-title" style="margin-top: 4mm;">Roadmap Execution & Verification</div>
    <table class="timeline-table">
      <thead>
        <tr>
          <th>Phase</th>
          <th>Work Description</th>
          <th>Est. Duration</th>
          <th>Target State</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Phase 1</td>
          <td>Core Missing APIs (Location, Slots, Live Tracking, Account Deletion)</td>
          <td>5 Days</td>
          <td>Verified E2E</td>
        </tr>
        <tr>
          <td>Phase 2</td>
          <td>AI Assistant Chat & Conversation History Integration</td>
          <td>3 Days</td>
          <td>Tested via Swagger</td>
        </tr>
        <tr>
          <td>Phase 3</td>
          <td>Core Scaling Hardening (BullMQ, WebSockets Redis, Push Notifications)</td>
          <td>5 Days</td>
          <td>Production Ready</td>
        </tr>
      </tbody>
    </table>

    <div class="sign-off-container">
      <div class="signature-box">
        <div class="signature-title">Prepared By</div>
        <div>Zaffabit Development Team</div>
      </div>
      <div class="signature-box">
        <div class="signature-title">Approved By</div>
        <div>Project Stakeholder / Client</div>
      </div>
    </div>

    <div class="page-footer">
      <span>Zaffabit API Screen Gaps Roadmap</span>
      <span>Page 2 of 2</span>
    </div>
  </div>

</body>
</html>
  `;

  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  console.log(`HTML report created at: ${htmlPath}`);

  // Launching Puppeteer to compile the HTML into the PDF
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  console.log(`Launching Google Chrome: ${chromePath}`);

  try {
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Render A4 PDF sheet
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm',
        bottom: '0mm',
        left: '0mm',
        right: '0mm',
      },
    });

    await browser.close();
    console.log(`✅ PDF successfully generated! Saved at: ${pdfPath}`);

    // Copy PDF to parent directory for convenience
    const parentPdfPath = path.join(__dirname, '..', 'pending_tasks_report.pdf');
    fs.copyFileSync(pdfPath, parentPdfPath);
    console.log(`✅ PDF copied to workspace root: ${parentPdfPath}`);
  } catch (err) {
    console.error('❌ Failed to compile PDF via Puppeteer:', err);
    process.exit(1);
  }
}

main();
