const fs = require('fs');
const path = require('path');

const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zafabit Admin Panel: KPI & Backend API Alignment Blueprint</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      margin: 0;
      padding: 40px;
      background-color: #ffffff;
      -webkit-print-color-adjust: exact;
    }
    
    .header {
      border-bottom: 3px solid #0f172a;
      padding-bottom: 24px;
      margin-bottom: 40px;
    }
    
    .header-logo {
      font-size: 28px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.03em;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
    }
    
    .header-logo span {
      background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-left: 6px;
    }
    
    .header-tagline {
      font-size: 14px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 600;
    }
    
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 0;
      margin-bottom: 8px;
    }
    
    h2 {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 8px;
      margin-top: 48px;
      margin-bottom: 24px;
    }
    
    h3 {
      font-size: 15px;
      font-weight: 600;
      color: #334155;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    
    p {
      margin-top: 0;
      margin-bottom: 16px;
      font-size: 14px;
      color: #475569;
    }
    
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .kpi-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px;
      background-color: #f8fafc;
      page-break-inside: avoid;
    }
    
    .kpi-card-title {
      font-size: 13px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }
    
    .kpi-card-value {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
    }
    
    .kpi-card-api {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #4f46e5;
      background-color: #eeebff;
      padding: 6px 10px;
      border-radius: 4px;
      display: inline-block;
      font-weight: 500;
    }
    
    .table-container {
      margin-bottom: 35px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    
    th {
      background-color: #f1f5f9;
      color: #334155;
      font-weight: 600;
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
    }
    
    td {
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
      color: #475569;
      vertical-align: top;
    }
    
    tr:last-child td {
      border-bottom: none;
    }
    
    .code-block {
      font-family: 'JetBrains Mono', monospace;
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
      color: #334155;
      overflow-x: auto;
      margin: 10px 0;
      page-break-inside: avoid;
    }
    
    .http-method {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      color: #ffffff;
      text-transform: uppercase;
      margin-right: 6px;
    }
    
    .method-get { background-color: #10b981; }
    .method-post { background-color: #3b82f6; }
    .method-put { background-color: #f59e0b; }
    .method-patch { background-color: #8b5cf6; }
    .method-delete { background-color: #ef4444; }
    
    .kpi-mapping-section {
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }
    
    .kpi-mapping-section h3 {
      margin-top: 0;
      font-size: 16px;
      color: #0f172a;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 8px;
    }
    
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      background-color: #e2e8f0;
      color: #334155;
    }
    
    .badge-green { background-color: #dcfce7; color: #15803d; }
    .badge-blue { background-color: #dbeafe; color: #1d4ed8; }

    .print-btn {
      display: block;
      width: 100%;
      padding: 15px;
      background: #4f46e5;
      color: white;
      text-align: center;
      text-decoration: none;
      font-size: 16px;
      font-weight: bold;
      border-radius: 6px;
      margin-bottom: 30px;
      cursor: pointer;
      border: none;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
      transition: background-color 0.2s;
    }

    .print-btn:hover {
      background: #4338ca;
    }
    
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none;
      }
      .page-break {
        page-break-before: always;
      }
    }
  </style>
</head>
<body>

  <button class="print-btn no-print" onclick="window.print()">🖨️ Click Here to Print or Save as PDF Blueprint Document</button>

  <div class="header">
    <div class="header-logo">Zafabit<span>Platform Alignment Blueprint</span></div>
    <div class="header-tagline">Exhaustive KPI-to-API Specification & Integration Document</div>
  </div>

  <h1>Admin Panel Key Performance Indicators (KPIs) & API Mapping</h1>
  <p>
    This blueprint bridges the frontend client dashboard panel views (<b>zaffabit</b>) and the Express backend server (<b>zafabitAPI</b>). 
    It details every Key Performance Indicator (KPI) rendered on the client dashboard, identifying its exact backend API endpoint, Mongoose database schema models, and the query aggregation logic required to feed the UI with production database content.
  </p>

  <h2>1. Primary Dashboard Overview KPIs (DashboardView.tsx)</h2>
  <p>
    The primary dashboard view utilizes five essential metrics cards at the top of the interface. These are served by a single centralized administrative statistics endpoint.
  </p>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-card-title">Total Revenue KPI</div>
      <div class="kpi-card-value">₹1,45,000.00</div>
      <div style="margin-bottom:10px;">
        <span class="http-method method-get">GET</span>
        <span class="kpi-card-api">/api/v1/admin/dashboard</span>
      </div>
      <h3>Mongoose Code Implementation</h3>
      <div class="code-block">
const revenueData = await Booking.aggregate([
  { $match: { status: 'completed' } },
  { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } }
]);
const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card-title">Total Bookings KPI</div>
      <div class="kpi-card-value">156 Bookings</div>
      <div style="margin-bottom:10px;">
        <span class="http-method method-get">GET</span>
        <span class="kpi-card-api">/api/v1/admin/dashboard</span>
      </div>
      <h3>Mongoose Code Implementation</h3>
      <div class="code-block">
const totalBookings = await Booking.countDocuments();
// Optionally group or filter:
// const activeBookings = await Booking.countDocuments({ 
//   status: { $in: ['pending', 'assigned', 'in-progress'] } 
// });
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card-title">Active Maid Partners KPI</div>
      <div class="kpi-card-value">42 Maid Partners</div>
      <div style="margin-bottom:10px;">
        <span class="http-method method-get">GET</span>
        <span class="kpi-card-api">/api/v1/admin/dashboard</span>
      </div>
      <h3>Mongoose Code Implementation</h3>
      <div class="code-block">
const activeMaids = await MaidProfile.countDocuments({ 
  activeStatus: 'active' 
});
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card-title">Active Customer Profiles KPI</div>
      <div class="kpi-card-value">118 Customers</div>
      <div style="margin-bottom:10px;">
        <span class="http-method method-get">GET</span>
        <span class="kpi-card-api">/api/v1/admin/dashboard</span>
      </div>
      <h3>Mongoose Code Implementation</h3>
      <div class="code-block">
const activeCustomers = await CustomerProfile.countDocuments();
      </div>
    </div>
  </div>

  <div class="kpi-mapping-section">
    <h3>Customer Sentiment & Review Rating KPI</h3>
    <p>Displays overall platform service satisfaction based on reviews left by customers after booking completions.</p>
    <div style="margin-bottom: 12px;">
      <span class="http-method method-get">GET</span>
      <span class="kpi-card-api">/api/v1/admin/dashboard</span>
    </div>
    <div class="code-block">
const maidKPI = await Review.aggregate([
  { $group: { _id: null, avgRating: { $avg: '$rating' } } }
]);
const ratingAverage = maidKPI.length > 0 ? maidKPI[0].avgRating.toFixed(2) : 0;
    </div>
  </div>

  <div class="page-break"></div>

  <h2>2. Operational, Financial & Marketing View KPIs</h2>
  <p>
    Beyond the core dashboard, specific dashboard views analyze performance metrics for operations dispatcher teams, marketing channels, and finance managers.
  </p>

  <div class="kpi-mapping-section">
    <h3>Operations Center KPIs (OperationsCenterView.tsx)</h3>
    <p>Provides live ticket queues and counts for assigned, in-progress, completed, and delayed bookings.</p>
    <table style="margin-top: 10px;">
      <thead>
        <tr>
          <th>KPI Widget in Frontend</th>
          <th>Backend Endpoint</th>
          <th>Database Query Logic</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Live Incoming Requests Roster</td>
          <td><span class="http-method method-get">GET</span><code>/api/v1/bookings</code></td>
          <td><code>Booking.find({ status: 'pending' }).populate('customer')</code></td>
        </tr>
        <tr>
          <td>Active In-Progress Jobs Count</td>
          <td><span class="http-method method-get">GET</span><code>/api/v1/bookings</code></td>
          <td><code>Booking.countDocuments({ status: 'in-progress' })</code></td>
        </tr>
        <tr>
          <td>Delayed Job Alarms</td>
          <td><span class="http-method method-get">GET</span><code>/api/v1/bookings</code></td>
          <td>Calculated by checking ongoing jobs where <code>scheduledTime</code> has passed current time without completion.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="kpi-mapping-section">
    <h3>Business & Financial Growth KPIs (AnalyticsView.tsx)</h3>
    <p>Draws revenue grids over time and tracks customer conversion trends.</p>
    <table style="margin-top: 10px;">
      <thead>
        <tr>
          <th>KPI Widget in Frontend</th>
          <th>Backend Endpoint</th>
          <th>Mongoose Aggregation Pipeline</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Monthly Revenue Graph</td>
          <td><span class="http-method method-get">GET</span><code>/api/v1/admin/reports/financial</code></td>
          <td>
            <pre style="margin:0; font-size:11px;">
Booking.aggregate([
  { $match: { status: 'completed' } },
  { $group: { 
      _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
      revenue: { $sum: "$totalAmount" },
      count: { $sum: 1 }
  }},
  { $sort: { "_id": -1 } }
])</pre>
          </td>
        </tr>
        <tr>
          <td>Service Frequency Distribution</td>
          <td><span class="http-method method-get">GET</span><code>/api/v1/bookings</code></td>
          <td><code>Booking.aggregate([{ $group: { _id: "$service", count: { $sum: 1 } } }])</code></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="kpi-mapping-section">
    <h3>Marketing & Promotional Campaign KPIs (CampaignsView.tsx)</h3>
    <p>Measures budget conversion, referral system registrations, and push notification CTR values.</p>
    <table style="margin-top: 10px;">
      <thead>
        <tr>
          <th>KPI Widget in Frontend</th>
          <th>Backend Endpoint</th>
          <th>Database Integration Status & Code</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Referral registrations count</td>
          <td><span class="http-method method-get">GET</span><code>/api/v1/admin/reports/campaigns</code></td>
          <td>
            <pre style="margin:0; font-size:11px;">
User.aggregate([
  { $match: { referredBy: { $exists: true, $ne: null } } },
  { $group: { 
      _id: '$referredBy', 
      totalReferrals: { $sum: 1 },
      verifiedCount: { $sum: { $cond: ['$isVerified', 1, 0] } } 
  }}
])</pre>
          </td>
        </tr>
        <tr>
          <td>Agent commissions performance</td>
          <td><span class="http-method method-get">GET</span><code>/api/v1/admin/reports/campaigns</code></td>
          <td>Pulls all registered agents from DB: <code>Agent.find().select('name agentCode earnings status')</code></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="page-break"></div>

  <h2>3. Backend PDF Generation System</h2>
  <p>
    Your backend <b>zafabitAPI</b> includes <b>Puppeteer</b> (v25.1.0) and <b>Marked</b> (v18.0.1) in its dependencies. This setup lets you dynamically render beautiful HTML reports into PDF sheets automatically.
  </p>
  
  <h3>3.1 Programmatic PDF Export Controller Setup</h3>
  <p>
    You can easily expose an administrative route to trigger on-demand KPI downloads as PDFs. Implement this controller script directly on the Express server:
  </p>

  <div class="code-block">
const puppeteer = require('puppeteer');
const fs = require('fs');

exports.exportKpiPdf = async (req, res, next) => {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    // 1. Fetch statistics
    const stats = await getDashboardStatsData(); // retrieves aggregate objects
    
    // 2. Generate target HTML Template
    const htmlTemplate = renderKpiTemplate(stats);
    
    // 3. Set content and compile PDF
    await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });
    
    await browser.close();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=platform_kpi_report.pdf');
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};
  </div>

  <h2>4. Blueprint Conclusion</h2>
  <p>
    This technical alignment documents all active routes and details a structured approach for connecting stateful data structures between your admin client and database controllers. Utilizing these specified query hooks ensures maximum stability and reliability for your production environment.
  </p>

  <script>
    // Automatically trigger print dialog when opened
    window.onload = function() {
      setTimeout(() => {
        // Only trigger if not already inside a print preview
        if (!window.matchMedia('print').matches) {
          window.print();
        }
      }, 600);
    };
  </script>

</body>
</html>
`;

function main() {
  console.log('Starting programmatic HTML/PDF documentation generation...');

  // Ensure the artifacts folder exists
  const artifactsDir = path.join(__dirname, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // Save the HTML wrapper
  const htmlPath = path.join(artifactsDir, 'admin_panel_kpi_api_documentation.html');
  fs.writeFileSync(htmlPath, htmlContent);
  console.log(`Saved beautifully-styled print document at: ${htmlPath}`);
  console.log('Done!');
}

main();
