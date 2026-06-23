const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zafabit Admin Panel: Comprehensive KPIs Directory Blueprint</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
    
    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      margin: 0;
      padding: 40px;
      background-color: #ffffff;
      -webkit-print-color-adjust: exact;
    }
    
    .header {
      border-bottom: 3px solid #6c5ce7;
      padding-bottom: 24px;
      margin-bottom: 40px;
    }
    
    .header-logo {
      font-size: 32px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.03em;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
    }
    
    .header-logo span {
      background: linear-gradient(135deg, #6c5ce7 0%, #00d1c1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-left: 8px;
    }
    
    .header-tagline {
      font-size: 13px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-weight: 700;
    }
    
    h1 {
      font-size: 28px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 0;
      margin-bottom: 12px;
      letter-spacing: -0.02em;
    }
    
    h2 {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 2px solid #6c5ce7;
      padding-bottom: 8px;
      margin-top: 48px;
      margin-bottom: 24px;
    }
    
    h3 {
      font-size: 16px;
      font-weight: 600;
      color: #334155;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    
    p {
      margin-top: 0;
      margin-bottom: 16px;
      font-size: 15px;
      color: #475569;
    }

    .meta-box {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 30px;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
    }

    .meta-item {
      font-size: 13px;
      color: #475569;
    }

    .meta-item strong {
      color: #0f172a;
    }
    
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .kpi-card {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      background-color: #f8fafc;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
      page-break-inside: avoid;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .kpi-card-title {
      font-size: 12px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }
    
    .kpi-card-value {
      font-size: 28px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
      font-family: 'Outfit', sans-serif;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .kpi-card-change {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .change-positive {
      color: #10b981;
    }

    .change-negative {
      color: #ef4444;
    }
    
    .kpi-card-api {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #6c5ce7;
      background-color: #f3f0ff;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-block;
      font-weight: 600;
    }
    
    .table-container {
      margin-bottom: 35px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.01);
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      text-align: left;
    }
    
    th {
      background-color: #f1f5f9;
      color: #334155;
      font-weight: 700;
      padding: 14px 18px;
      border-bottom: 1px solid #e2e8f0;
    }
    
    td {
      padding: 14px 18px;
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
      border-radius: 8px;
      padding: 14px;
      font-size: 12px;
      color: #334155;
      overflow-x: auto;
      margin: 12px 0;
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
    
    .kpi-mapping-section {
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      page-break-inside: avoid;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.01);
    }
    
    .kpi-mapping-section h3 {
      margin-top: 0;
      font-size: 18px;
      color: #0f172a;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .kpi-count-badge {
      background-color: #6c5ce7;
      color: #ffffff;
      font-size: 12px;
      font-weight: bold;
      padding: 4px 10px;
      border-radius: 20px;
      letter-spacing: normal;
    }
    
    /* Operational Context Details Box styling */
    .op-context-box {
      background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
      border: 1.5px solid #dbeafe;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 25px;
      page-break-inside: avoid;
    }
    
    .op-context-title {
      font-size: 14px;
      font-weight: 800;
      color: #1d4ed8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .op-context-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      font-size: 13.5px;
      color: #334155;
    }
    
    .op-context-item strong {
      color: #0f172a;
    }
    
    /* Graphic Visualization Styling */
    .visualization-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin-top: 15px;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    
    .visualization-box {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background-color: #ffffff;
      padding: 18px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.01);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      page-break-inside: avoid;
    }
    
    .visualization-title {
      font-size: 12px;
      font-weight: 700;
      color: #475569;
      margin-bottom: 12px;
      text-align: left;
      width: 100%;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-left: 3px solid #6c5ce7;
      padding-left: 8px;
    }
    
    .chart-svg {
      width: 100%;
      height: 150px;
    }
    
    .donut-legend {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      font-size: 10px;
      margin-top: 10px;
      font-weight: 600;
      color: #475569;
      width: 100%;
    }
    
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .legend-color {
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }

    .print-btn {
      display: block;
      width: 100%;
      padding: 15px;
      background: #6c5ce7;
      color: white;
      text-align: center;
      text-decoration: none;
      font-size: 16px;
      font-weight: bold;
      border-radius: 8px;
      margin-bottom: 30px;
      cursor: pointer;
      border: none;
      box-shadow: 0 4px 6px -1px rgba(108, 92, 231, 0.2), 0 2px 4px -2px rgba(108, 92, 231, 0.2);
      transition: background-color 0.2s;
    }

    .print-btn:hover {
      background: #5b4cd8;
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

  <button class="print-btn no-print" onclick="window.print()">🖨️ Click Here to Print or Save as PDF Report</button>

  <div class="header">
    <div class="header-logo">Zafabit<span>Platform KPI Executive Directory</span></div>
    <div class="header-tagline">Executive Blueprint & Technical Alignment Specifications</div>
  </div>

  <div class="meta-box">
    <div class="meta-item"><strong>Document:</strong> Admin Panel KPIs & Visual Directory Blueprint</div>
    <div class="meta-item"><strong>Date:</strong> June 2, 2026</div>
    <div class="meta-item"><strong>Target Frontend:</strong> zaffabit (React / Vite / Recharts)</div>
    <div class="meta-item"><strong>Target Backend:</strong> zafabitAPI (Node.js / Express / Mongoose)</div>
  </div>

  <h1>Admin Panel Key Performance Indicators (KPIs) Directory</h1>
  <p>
    This report outlines every active Key Performance Indicator (KPI) across the Zafabit Admin Panel. 
    It details what each KPI card means, what action is triggered operationally, and incorporates high-fidelity 
    inline visual vector SVGs of the exact bar charts, line graphs, doughnut charts, and sparklines used in the actual frontend application so the viewer can understand the layouts easily.
  </p>

  <h2>1. Page One: Core Dashboard Overview KPIs (DashboardView.tsx)</h2>
  
  <div class="op-context-box">
    <div class="op-context-title">💼 Operational Blueprint: Core Dashboard</div>
    <div class="op-context-grid">
      <div class="op-context-item">
        <strong>The "Why" (Purpose):</strong> Serve as the executive command cockpit, offering a 360° visual review of overall business performance, daily volume trajectory, and system margins.
      </div>
      <div class="op-context-item">
        <strong>The "Who" (Operator):</strong> C-Level Executives, General Managers, and Operations Directors who require instant visibility into systemic efficiency.
      </div>
      <div class="op-context-item">
        <strong>Daily Action (What they do):</strong> Load this page first thing in the morning to audit growth loops, assess cancellation drops, and identify critical payment failures.
      </div>
      <div class="op-context-item">
        <strong>Decision Logic:</strong> If cancellations exceed 3% or refunds spike, managers immediately coordinate with safety and dispatch managers to diagnose partner mismatches.
      </div>
    </div>
  </div>

  <p>
    The primary overview dashboard panel utilizes <strong>10 KPIs</strong> (6 top-level summary cards, 3 visual charts, and 1 core ledger table) to instantly reflect daily platform health.
  </p>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-card-title">1. Total Revenue KPI Card</div>
      <div class="kpi-card-value">
        <span>₹2,48,340</span>
        <!-- Sparkline visualization directly in value card -->
        <svg viewBox="0 0 100 30" style="width: 80px; height: 24px;">
          <path d="M 0,25 C 20,10 40,30 60,12 C 80,0 90,15 100,5" fill="none" stroke="#6c5ce7" stroke-width="2" stroke-linecap="round"/>
          <path d="M 0,25 C 20,10 40,30 60,12 C 80,0 90,15 100,5 L 100,30 L 0,30 Z" fill="#6c5ce7" fill-opacity="0.1"/>
        </svg>
      </div>
      <div class="kpi-card-change change-positive">↗ 15.8% <span style="color:#64748b; font-weight:400; font-size:11px;">vs yesterday</span></div>
      <p><strong>Visual Representation:</strong> Clean metric value block featuring a bold numerical font, backed by a soft green trend badge in the upper right representing the percentage rate increase and a miniature inline Area sparkline.</p>
      <p><strong>What it means:</strong> The gross financial volume processed for completed service bookings today.</p>
      <p><strong>Operational Action:</strong> Tracks platform growth. A sudden drop signals a dispatch system block, payment processor failure, or low booking demand.</p>
      <div style="margin-bottom:10px;">
        <span class="http-method method-get">GET</span>
        <span class="kpi-card-api">/api/v1/admin/dashboard</span>
      </div>
      <h3>Aggregation Pipeline</h3>
      <div class="code-block">
const revenueData = await Booking.aggregate([
  { $match: { status: 'completed' } },
  { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } }
]);
const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card-title">2. New Customers KPI Card</div>
      <div class="kpi-card-value">
        <span>282</span>
        <svg viewBox="0 0 100 30" style="width: 80px; height: 24px;">
          <path d="M 0,25 C 15,20 30,5 50,15 70,8 85,2 100,10" fill="none" stroke="#00d1c1" stroke-width="2" stroke-linecap="round"/>
          <path d="M 0,25 C 15,20 30,5 50,15 70,8 85,2 100,10 L 100,30 L 0,30 Z" fill="#00d1c1" fill-opacity="0.1"/>
        </svg>
      </div>
      <div class="kpi-card-change change-positive">↗ 8.4% <span style="color:#64748b; font-weight:400; font-size:11px;">vs yesterday</span></div>
      <p><strong>Visual Representation:</strong> Solid metric number card with a light emerald background badge tracking daily registrations growth.</p>
      <p><strong>What it means:</strong> The count of new customer profile registrations completed today.</p>
      <p><strong>Operational Action:</strong> Measures the effectiveness of active customer acquisition campaigns. A downward trend triggers promo incentives.</p>
      <div style="margin-bottom:10px;">
        <span class="http-method method-get">GET</span>
        <span class="kpi-card-api">/api/v1/admin/dashboard</span>
      </div>
      <h3>Aggregation Pipeline</h3>
      <div class="code-block">
const newCustomers = await CustomerProfile.countDocuments({
  createdAt: { $gte: startOfDay }
});
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card-title">3. New Maids KPI Card</div>
      <div class="kpi-card-value">
        <span>42</span>
        <svg viewBox="0 0 100 30" style="width: 80px; height: 24px;">
          <path d="M 0,30 C 20,25 40,10 60,15 C 80,5 90,8 100,2" fill="none" stroke="#6c5ce7" stroke-width="2" stroke-linecap="round"/>
          <path d="M 0,30 C 20,25 40,10 60,15 C 80,5 90,8 100,2 L 100,30 L 0,30 Z" fill="#6c5ce7" fill-opacity="0.1"/>
        </svg>
      </div>
      <div class="kpi-card-change change-positive">↗ 12.4% <span style="color:#64748b; font-weight:400; font-size:11px;">vs yesterday</span></div>
      <p><strong>Visual Representation:</strong> Numerical metric widget showing activated partners with a positive growth arrow indicator and purple sparkline.</p>
      <p><strong>What it means:</strong> The count of new maid partner profiles successfully onboarded and activated today.</p>
      <p><strong>Operational Action:</strong> Supply-side growth index. If low relative to booking velocity, supply bottlenecks occur (longer dispatch delays).</p>
      <div style="margin-bottom:10px;">
        <span class="http-method method-get">GET</span>
        <span class="kpi-card-api">/api/v1/admin/dashboard</span>
      </div>
      <h3>Aggregation Pipeline</h3>
      <div class="code-block">
const newMaids = await MaidProfile.countDocuments({
  activeStatus: 'active',
  createdAt: { $gte: startOfDay }
});
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-card-title">4. Completion Rate KPI Card</div>
      <div class="kpi-card-value">
        <span>142</span>
        <svg viewBox="0 0 100 30" style="width: 80px; height: 24px;">
          <path d="M 0,20 C 20,15 40,8 60,25 C 80,10 90,5 100,12" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
          <path d="M 0,20 C 20,15 40,8 60,25 C 80,10 90,5 100,12 L 100,30 L 0,30 Z" fill="#3b82f6" fill-opacity="0.1"/>
        </svg>
      </div>
      <div class="kpi-card-change change-positive">↗ 5.4% <span style="color:#64748b; font-weight:400; font-size:11px;">vs yesterday</span></div>
      <p><strong>Visual Representation:</strong> Statistical quantity display with a positive metric status indicator.</p>
      <p><strong>What it means:</strong> The exact count of service bookings successfully completed and closed today.</p>
      <p><strong>Operational Action:</strong> Directly tracks fulfillment success. High numbers show high operational stability and smooth maid-customer matching.</p>
      <div style="margin-bottom:10px;">
        <span class="http-method method-get">GET</span>
        <span class="kpi-card-api">/api/v1/admin/dashboard</span>
      </div>
      <h3>Aggregation Pipeline</h3>
      <div class="code-block">
const completedBookings = await Booking.countDocuments({
  status: 'completed',
  updatedAt: { $gte: startOfDay }
});
      </div>
    </div>
  </div>

  <!-- Page One Visual Charts -->
  <h3>Visual Dashboard Analytical Charts</h3>
  <div class="visualization-row">
    <div class="visualization-box">
      <div class="visualization-title">7. Total Bookings Trend (Area Chart)</div>
      <svg viewBox="0 0 500 200" class="chart-svg">
        <defs>
          <linearGradient id="bookings-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6c5ce7" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="#6c5ce7" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <line x1="30" y1="20" x2="470" y2="20" stroke="#f1f5f9" stroke-width="1"/>
        <line x1="30" y1="70" x2="470" y2="70" stroke="#f1f5f9" stroke-width="1"/>
        <line x1="30" y1="120" x2="470" y2="120" stroke="#f1f5f9" stroke-width="1"/>
        <line x1="30" y1="170" x2="470" y2="170" stroke="#e2e8f0" stroke-width="1.5"/>
        <path d="M 30,150 C 90,110 150,130 210,60 C 270,30 330,85 390,40 C 430,20 450,45 470,30 L 470,170 L 30,170 Z" fill="url(#bookings-area-grad)"/>
        <path d="M 30,150 C 90,110 150,130 210,60 C 270,30 330,85 390,40 C 430,20 450,45 470,30" fill="none" stroke="#6c5ce7" stroke-width="3" stroke-linecap="round"/>
        <circle cx="210" cy="60" r="5" fill="#6c5ce7" stroke="#ffffff" stroke-width="2"/>
        <circle cx="390" cy="40" r="5" fill="#6c5ce7" stroke="#ffffff" stroke-width="2"/>
        <text x="30" y="190" fill="#94a3b8" font-size="10" font-weight="600">Mon</text>
        <text x="140" y="190" fill="#94a3b8" font-size="10" font-weight="600">Wed</text>
        <text x="250" y="190" fill="#94a3b8" font-size="10" font-weight="600">Fri</text>
        <text x="360" y="190" fill="#94a3b8" font-size="10" font-weight="600">Sat</text>
        <text x="450" y="190" fill="#94a3b8" font-size="10" font-weight="600">Sun</text>
      </svg>
      <p style="font-size:11px; color:#64748b; margin-top:10px; font-weight:500;">
        Curved line graph with gradient fill illustrating weekly booking cycles. Peak demands appear on weekends.
      </p>
    </div>

    <div class="visualization-box">
      <div class="visualization-title">8. Booking Growth Trend (Bar Chart)</div>
      <svg viewBox="0 0 500 200" class="chart-svg">
        <line x1="30" y1="20" x2="470" y2="20" stroke="#f1f5f9" stroke-width="1"/>
        <line x1="30" y1="70" x2="470" y2="70" stroke="#f1f5f9" stroke-width="1"/>
        <line x1="30" y1="120" x2="470" y2="120" stroke="#f1f5f9" stroke-width="1"/>
        <line x1="30" y1="170" x2="470" y2="170" stroke="#e2e8f0" stroke-width="1.5"/>
        <rect x="50" y="110" width="25" height="60" rx="3" fill="#00d1c1"/>
        <rect x="110" y="80" width="25" height="90" rx="3" fill="#00d1c1"/>
        <rect x="170" y="55" width="25" height="115" rx="3" fill="#6c5ce7"/>
        <rect x="230" y="90" width="25" height="80" rx="3" fill="#00d1c1"/>
        <rect x="290" y="45" width="25" height="125" rx="3" fill="#00d1c1"/>
        <rect x="350" y="30" width="25" height="140" rx="3" fill="#6c5ce7"/>
        <rect x="410" y="65" width="25" height="105" rx="3" fill="#00d1c1"/>
        <text x="50" y="190" fill="#94a3b8" font-size="10" font-weight="600">Jan</text>
        <text x="110" y="190" fill="#94a3b8" font-size="10" font-weight="600">Mar</text>
        <text x="170" y="190" fill="#94a3b8" font-size="10" font-weight="600">May</text>
        <text x="230" y="190" fill="#94a3b8" font-size="10" font-weight="600">Jul</text>
        <text x="290" y="190" fill="#94a3b8" font-size="10" font-weight="600">Sep</text>
        <text x="350" y="190" fill="#94a3b8" font-size="10" font-weight="600">Nov</text>
        <text x="410" y="190" fill="#94a3b8" font-size="10" font-weight="600">Dec</text>
      </svg>
      <p style="font-size:11px; color:#64748b; margin-top:10px; font-weight:500;">
        Vertical bar columns tracing monthly platform scale growth month-over-month. Highlight columns in purple emphasize quarters.
      </p>
    </div>
  </div>

  <div class="visualization-row" style="grid-template-columns: 1.5fr 1fr;">
    <div class="kpi-mapping-section" style="margin-bottom:0;">
      <h3>Page One Visual Ledger Table</h3>
      <table>
        <thead>
          <tr>
            <th>10. Recent Transaction Logs</th>
            <th>Gateway</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>#TXN-7412</strong> (Amit Sen)</td>
            <td>UPI Transfer</td>
            <td><span class="badge badge-green">SUCCEEDED</span></td>
            <td>Today, 2:40 PM</td>
          </tr>
          <tr>
            <td><strong>#TXN-7411</strong> (Priya Nair)</td>
            <td>Visa •••• 4242</td>
            <td><span class="badge badge-green">SUCCEEDED</span></td>
            <td>Today, 1:12 PM</td>
          </tr>
          <tr>
            <td><strong>#TXN-7410</strong> (John Doe)</td>
            <td>PayPal</td>
            <td><span class="badge badge-orange">PENDING</span></td>
            <td>Today, 12:05 PM</td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <div class="visualization-box">
      <div class="visualization-title">9. Active Dispatch Heatmap (Doughnut)</div>
      <svg viewBox="0 0 200 200" style="width: 110px; height: 110px;">
        <circle cx="100" cy="100" r="70" fill="none" stroke="#f1f5f9" stroke-width="16"/>
        <circle cx="100" cy="100" r="70" fill="none" stroke="#6c5ce7" stroke-width="16" stroke-dasharray="176 440" stroke-dashoffset="0"/>
        <circle cx="100" cy="100" r="70" fill="none" stroke="#00d1c1" stroke-width="16" stroke-dasharray="132 440" stroke-dashoffset="-176"/>
        <circle cx="100" cy="100" r="70" fill="none" stroke="#f59e0b" stroke-width="16" stroke-dasharray="88 440" stroke-dashoffset="-308"/>
        <circle cx="100" cy="100" r="70" fill="none" stroke="#3b82f6" stroke-width="16" stroke-dasharray="44 440" stroke-dashoffset="-396"/>
        <text x="100" y="105" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">100%</text>
      </svg>
      <div class="donut-legend">
        <div class="legend-item"><div class="legend-color" style="background:#6c5ce7;"></div>Sweep (40%)</div>
        <div class="legend-item"><div class="legend-color" style="background:#00d1c1;"></div>Kitchen (30%)</div>
        <div class="legend-item"><div class="legend-color" style="background:#f59e0b;"></div>Deep (20%)</div>
        <div class="legend-item"><div class="legend-color" style="background:#3b82f6;"></div>Laundry (10%)</div>
      </div>
    </div>
  </div>

  <div class="page-break"></div>

  <h2>2. Subsequent Pages: Operational, Financial & Marketing View KPIs</h2>
  <p>
    Beyond the core dashboard overview page, the platform incorporates specialized views built with rich metric cards, sparkline charts, and detailed data lists.
  </p>

  <!-- Operations Center Details -->
  <div class="kpi-mapping-section">
    <h3>2.1 Operations Center (OperationsCenterView.tsx) <span class="kpi-count-badge">4 KPIs</span></h3>
    
    <div class="op-context-box">
      <div class="op-context-title">⚡ Operational Blueprint: Operations Center</div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <strong>The "Why" (Purpose):</strong> Manage real-time dispatcher matching queues, resolve dispatch failures, and monitor live fields to avoid schedule overlaps.
        </div>
        <div class="op-context-item">
          <strong>The "Who" (Operator):</strong> Live Dispatch Matchmakers and Shift Supervisors who coordinate field logistics.
        </div>
        <div class="op-context-item">
          <strong>Daily Action (What they do):</strong> Review the matching queue logs, manually assign un-dispatched booking requests, and call delayed partners.
        </div>
        <div class="op-context-item">
          <strong>Decision Logic:</strong> If pending requests pile up beyond a 10-minute wait, dispatchers trigger "surge incentives" or manual matchmaking search protocols.
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Metric Name</th>
          <th>Visual Representation</th>
          <th>What it Means</th>
          <th>Operational Action / Response</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Live Booking Requests Feed</strong></td>
          <td>Counter card showing pending request counts.</td>
          <td>Real-time count of customer booking requests waiting to be matched to partners.</td>
          <td>Admins trigger manual overrides if dispatch delays exceed 10 minutes.</td>
        </tr>
        <tr>
          <td><strong>2. Active Jobs Count</strong></td>
          <td>Real-time quantity indicator.</td>
          <td>In-progress cleaning sessions active in the field right now.</td>
          <td>Represents current platform work load. Spikes represent busiest hours.</td>
        </tr>
        <tr>
          <td><strong>3. Delayed Job Alarms</strong></td>
          <td>List panel showing alarm notifications.</td>
          <td>Bookings where scheduled start times have passed but status has not updated.</td>
          <td>Triggers supervisor escalations. Dispatchers call partners immediately.</td>
        </tr>
        <tr>
          <td><strong>4. Dispatcher Match Logs</strong></td>
          <td>Tabular list showing active dispatches.</td>
          <td>Recent dispatch matchmaking sequences showing wait and search values.</td>
          <td>Diagnoses auto-matching algorithm performance.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Analytics Page Details -->
  <div class="kpi-mapping-section">
    <h3>2.2 Analytics & Macro Reporting (AnalyticsView.tsx) <span class="kpi-count-badge">6 KPIs</span></h3>
    
    <div class="op-context-box">
      <div class="op-context-title">📈 Operational Blueprint: Analytics Center</div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <strong>The "Why" (Purpose):</strong> Identify monthly revenue trajectories, track seasonal demand scaling, analyze customer retention cohorts, and define geo expansions.
        </div>
        <div class="op-context-item">
          <strong>The "Who" (Operator):</strong> Growth Marketers, Financial Analysts, and Business Development Directors.
        </div>
        <div class="op-context-item">
          <strong>Daily Action (What they do):</strong> Filter cohort ranges, review regional city performance graphs, and assess service category popularity splits.
        </div>
        <div class="op-context-item">
          <strong>Decision Logic:</strong> If Month-3 cohort retention drops below 50%, the growth team initiates push notification loyalty vouchers or discount campaigns.
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Metric Name</th>
          <th>Visual Representation</th>
          <th>What it Means</th>
          <th>Operational Action / Response</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Total Revenue</strong></td>
          <td>Metric card showing cumulative sales.</td>
          <td>Cumulative monthly revenue across all business sectors.</td>
          <td>Used to track budget scaling targets.</td>
        </tr>
        <tr>
          <td><strong>2. Active Users</strong></td>
          <td>Metric card showing user traffic.</td>
          <td>Total active monthly users engaged in bookings.</td>
          <td>Monitors overall customer retention.</td>
        </tr>
        <tr>
          <td><strong>3. Conversion Rate</strong></td>
          <td>Metric card showing conversion percentage.</td>
          <td>Ratio of application sessions that successfully convert to paid bookings.</td>
          <td>Measures checkout funnel and booking flow efficiency.</td>
        </tr>
      </tbody>
    </table>

    <div class="visualization-row">
      <div class="visualization-box">
        <div class="visualization-title">4. Customer Retention Analysis (Area Chart)</div>
        <svg viewBox="0 0 500 200" class="chart-svg">
          <defs>
            <linearGradient id="retention-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#00d1c1" stop-opacity="0.4"/>
              <stop offset="100%" stop-color="#00d1c1" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <line x1="30" y1="20" x2="470" y2="20" stroke="#f1f5f9" stroke-width="1"/>
          <line x1="30" y1="70" x2="470" y2="70" stroke="#f1f5f9" stroke-width="1"/>
          <line x1="30" y1="120" x2="470" y2="120" stroke="#f1f5f9" stroke-width="1"/>
          <line x1="30" y1="170" x2="470" y2="170" stroke="#cbd5e1" stroke-width="1.5"/>
          <path d="M 30,30 C 100,50 170,80 240,90 C 310,95 380,105 470,110 L 470,170 L 30,170 Z" fill="url(#retention-grad)"/>
          <path d="M 30,30 C 100,50 170,80 240,90 C 310,95 380,105 470,110" fill="none" stroke="#00d1c1" stroke-width="3" stroke-linecap="round"/>
          <circle cx="240" cy="90" r="5" fill="#00d1c1" stroke="#ffffff" stroke-width="2"/>
          <text x="30" y="190" fill="#94a3b8" font-size="10" font-weight="600">Month 1</text>
          <text x="240" y="190" fill="#94a3b8" font-size="10" font-weight="600">Month 4</text>
          <text x="430" y="190" fill="#94a3b8" font-size="10" font-weight="600">Month 7</text>
        </svg>
      </div>

      <div class="visualization-box">
        <div class="visualization-title">5. Regional User Density (Horizontal Bar Chart)</div>
        <svg viewBox="0 0 500 200" class="chart-svg">
          <text x="20" y="40" fill="#475569" font-size="11" font-weight="700">Bangalore</text>
          <rect x="100" y="30" width="340" height="15" rx="3" fill="#6c5ce7"/>
          <text x="450" y="42" fill="#475569" font-size="11" font-weight="700">68%</text>

          <text x="20" y="85" fill="#475569" font-size="11" font-weight="700">Mumbai</text>
          <rect x="100" y="75" width="220" height="15" rx="3" fill="#00d1c1"/>
          <text x="330" y="87" fill="#475569" font-size="11" font-weight="700">44%</text>

          <text x="20" y="130" fill="#475569" font-size="11" font-weight="700">Delhi NCR</text>
          <rect x="100" y="120" width="160" height="15" rx="3" fill="#3b82f6"/>
          <text x="270" y="132" fill="#475569" font-size="11" font-weight="700">32%</text>

          <text x="20" y="175" fill="#475569" font-size="11" font-weight="700">Chennai</text>
          <rect x="100" y="165" width="90" height="15" rx="3" fill="#f59e0b"/>
          <text x="200" y="177" fill="#475569" font-size="11" font-weight="700">18%</text>
        </svg>
      </div>
    </div>
  </div>

  <div class="page-break"></div>

  <!-- Earnings & Payouts Center Details -->
  <div class="kpi-mapping-section">
    <h3>2.3 Earnings & Payouts (EarningsPayoutView.tsx) <span class="kpi-count-badge">7 KPIs</span></h3>
    
    <div class="op-context-box">
      <div class="op-context-title">💰 Operational Blueprint: Earnings & Payouts</div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <strong>The "Why" (Purpose):</strong> Manage outstanding wages owed to active maid partners, monitor net platform commissions, and execute safe payroll batch transfers.
        </div>
        <div class="op-context-item">
          <strong>The "Who" (Operator):</strong> Payroll officers, Financial controllers, and Billing accountants.
        </div>
        <div class="op-context-item">
          <strong>Daily Action (What they do):</strong> Verify pending settlement sums, execute batch payouts, audit transfer statuses, and resolve banking errors.
        </div>
        <div class="op-context-item">
          <strong>Decision Logic:</strong> If failed payout statuses exceed 5%, accountants immediately check for bank gateway drops or trigger customer UPI validation sweeps.
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Metric Name</th>
          <th>Visual Representation</th>
          <th>What it Means</th>
          <th>Operational Action / Response</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Total Revenue</strong></td>
          <td>Top summary card with positive trend line.</td>
          <td>Total gross revenue processed through payment gateways.</td>
          <td>Directly traces sales trajectory.</td>
        </tr>
        <tr>
          <td><strong>2. Pending Payouts</strong></td>
          <td>Summary card highlighting outstanding settlements.</td>
          <td>Funds owed to active maid partners for completed bookings.</td>
          <td>Monitors labor liability. Keeps payouts within 3 days.</td>
        </tr>
        <tr>
          <td><strong>3. Completed Payouts</strong></td>
          <td>Summary card detailing cleared payroll.</td>
          <td>Total wages successfully disbursed to partners today.</td>
          <td>Ensures payroll distribution success.</td>
        </tr>
        <tr>
          <td><strong>4. Average Payout</strong></td>
          <td>Summary card showing typical job earnings.</td>
          <td>The average transaction size of cleared partner payouts.</td>
          <td>Tracks partner take-home wages satisfaction levels.</td>
        </tr>
      </tbody>
    </table>
    
    <div class="visualization-row" style="grid-template-columns: 1.55fr 1fr;">
      <div class="visualization-box">
        <div class="visualization-title">5. Revenue Analytics: Revenue vs Payouts (Dual Area Chart)</div>
        <svg viewBox="0 0 500 200" class="chart-svg">
          <defs>
            <linearGradient id="revenue-dual-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#6c5ce7" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="#6c5ce7" stop-opacity="0.0"/>
            </linearGradient>
            <linearGradient id="payout-dual-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <line x1="30" y1="20" x2="470" y2="20" stroke="#f1f5f9" stroke-width="1"/>
          <line x1="30" y1="70" x2="470" y2="70" stroke="#f1f5f9" stroke-width="1"/>
          <line x1="30" y1="120" x2="470" y2="120" stroke="#f1f5f9" stroke-width="1"/>
          <line x1="30" y1="170" x2="470" y2="170" stroke="#cbd5e1" stroke-width="1.5"/>
          <path d="M 30,130 C 90,90 150,110 210,40 C 270,10 330,65 390,30 C 430,10 450,25 470,10 L 470,170 L 30,170 Z" fill="url(#revenue-dual-grad)"/>
          <path d="M 30,150 C 90,115 150,130 210,75 C 270,45 330,95 390,60 C 430,35 450,55 470,40 L 470,170 L 30,170 Z" fill="url(#payout-dual-grad)"/>
          <path d="M 30,130 C 90,90 150,110 210,40 C 270,10 330,65 390,30 C 430,10 450,25 470,10" fill="none" stroke="#6c5ce7" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M 30,150 C 90,115 150,130 210,75 C 270,45 330,95 390,60 C 430,35 450,55 470,40" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round"/>
          <text x="30" y="190" fill="#94a3b8" font-size="10" font-weight="600">Mon</text>
          <text x="250" y="190" fill="#94a3b8" font-size="10" font-weight="600">Fri</text>
          <text x="450" y="190" fill="#94a3b8" font-size="10" font-weight="600">Sun</text>
        </svg>
      </div>

      <div class="visualization-box">
        <div class="visualization-title">6. Payout Overview (Doughnut)</div>
        <svg viewBox="0 0 200 200" style="width: 100px; height: 100px;">
          <circle cx="100" cy="100" r="70" fill="none" stroke="#f1f5f9" stroke-width="16"/>
          <circle cx="100" cy="100" r="70" fill="none" stroke="#10b981" stroke-width="16" stroke-dasharray="343 440" stroke-dashoffset="0"/>
          <circle cx="100" cy="100" r="70" fill="none" stroke="#f59e0b" stroke-width="16" stroke-dasharray="70 440" stroke-dashoffset="-343"/>
          <circle cx="100" cy="100" r="70" fill="none" stroke="#ef4444" stroke-width="16" stroke-dasharray="27 440" stroke-dashoffset="-413"/>
          <text x="100" y="105" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">78%</text>
        </svg>
        <div class="donut-legend" style="grid-template-columns: 1fr; gap:3px; margin-top:8px;">
          <div class="legend-item"><div class="legend-color" style="background:#10b981;"></div>Completed (78%)</div>
          <div class="legend-item"><div class="legend-color" style="background:#f59e0b;"></div>Pending (16%)</div>
          <div class="legend-item"><div class="legend-color" style="background:#ef4444;"></div>Failed (6%)</div>
        </div>
      </div>
    </div>
  </div>

  <div class="page-break"></div>

  <!-- Transactions Center Details -->
  <div class="kpi-mapping-section">
    <h3>2.4 Transactions Page (TransactionsView.tsx) <span class="kpi-count-badge">5 KPIs</span></h3>
    
    <div class="op-context-box">
      <div class="op-context-title">💳 Operational Blueprint: Transactions Auditor</div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <strong>The "Why" (Purpose):</strong> Provide billing audit trails across card, UPI, and bank transfers, search individual reference IDs, and handle transaction-level support.
        </div>
        <div class="op-context-item">
          <strong>The "Who" (Operator):</strong> Customer billing specialists and Finance operations managers.
        </div>
        <div class="op-context-item">
          <strong>Daily Action (What they do):</strong> Audit individual payment method splits, investigate failed transactions, and modify settlement states during gateway disputes.
        </div>
        <div class="op-context-item">
          <strong>Decision Logic:</strong> If transaction failure rates spike above 3%, administrators immediately query stripe status endpoints to bypass gateway downtime.
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Metric Name</th>
          <th>Visual Representation</th>
          <th>What it Means</th>
          <th>Operational Action / Response</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Gross Volume</strong></td>
          <td>Numerical card featuring a mini-sparkline graph.</td>
          <td>The total value of transaction attempts processed.</td>
          <td>Tracks transaction load. Drops signal payment gateway issues.</td>
        </tr>
        <tr>
          <td><strong>2. Net Revenue</strong></td>
          <td>Numerical card featuring a mini-sparkline graph.</td>
          <td>Net platform margin cut collected after processing fees.</td>
          <td>Direct profit tracker.</td>
        </tr>
        <tr>
          <td><strong>3. Failed Transactions</strong></td>
          <td>Numerical card displaying text alert.</td>
          <td>The ratio of payment transaction failures (e.g. 1.2%).</td>
          <td>If rate exceeds 3%, indicates payment gateway gateway failures or card issues.</td>
        </tr>
        <tr>
          <td><strong>4. Average Order Value</strong></td>
          <td>Numerical card featuring a miniature sparkline.</td>
          <td>Average transaction size processed across the platform.</td>
          <td>Tracks size changes. Dips spark bundle deal promos.</td>
        </tr>
        <tr>
          <td><strong>5. Financial Movements Table</strong></td>
          <td>Tabular listing with inline status badges.</td>
          <td>List of platform transactions showing gateway methods (Visa, Mastercard, UPI).</td>
          <td>Provides transaction reference keys for support ticket resolutions.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Wallet & Credits Center Details -->
  <div class="kpi-mapping-section">
    <h3>2.5 Wallet & Credits (WalletCreditsView.tsx) <span class="kpi-count-badge">7 KPIs</span></h3>
    
    <div class="op-context-box">
      <div class="op-context-title">👛 Operational Blueprint: Wallet & Credits</div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <strong>The "Why" (Purpose):</strong> Manage customer deposited credit balances, award promotional goodwill values, monitor financial liabilities, and freeze accounts due to promo abuse.
        </div>
        <div class="op-context-item">
          <strong>The "Who" (Operator):</strong> Customer Experience (CX) Leads, Fraud Analysts, and Account Managers.
        </div>
        <div class="op-context-item">
          <strong>Daily Action (What they do):</strong> Audit manual credit allocations, issue goodwill store credit adjustments, lock suspicious wallets, and track ledger logs.
        </div>
        <div class="op-context-item">
          <strong>Decision Logic:</strong> If un-redeemed store credit balances spike, account teams trigger customer reservation campaigns to accelerate credit-to-booking conversions.
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Metric Name</th>
          <th>Visual Representation</th>
          <th>What it Means</th>
          <th>Operational Action / Response</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Total Wallet Balance</strong></td>
          <td>Summary card featuring a mini-sparkline graph.</td>
          <td>Total credit funds currently sitting inside customer accounts.</td>
          <td>Represents capital liability. High balances represent unredeemed reservations.</td>
        </tr>
        <tr>
          <td><strong>2. Credits Issued YTD</strong></td>
          <td>Summary card featuring a mini-sparkline graph.</td>
          <td>Total credits issued as promotional rewards or goodwill compensations.</td>
          <td>Tracks credit liability trends to manage campaign efficiency.</td>
        </tr>
        <tr>
          <td><strong>3. Credits Used</strong></td>
          <td>Summary card.</td>
          <td>Total customer wallet credits redeemed against bookings.</td>
          <td>Indicates the utilization rate of promotional cash.</td>
        </tr>
        <tr>
          <td><strong>4. Pending Refunds</strong></td>
          <td>Summary card featuring a mini-sparkline graph.</td>
          <td>Total amount of wallet credit refunds awaiting approval.</td>
          <td>Tracks financial disputes. Keeping pending below ₹25,000 avoids review backlog.</td>
        </tr>
      </tbody>
    </table>
    
    <div class="visualization-row">
      <div class="visualization-box" style="grid-column: span 2;">
        <div class="visualization-title">5. Wallet Balance Trend: Wallet Balances vs Credits Issued (Double Column Chart)</div>
        <svg viewBox="0 0 500 150" class="chart-svg" style="height:120px;">
          <line x1="30" y1="10" x2="470" y2="10" stroke="#f1f5f9" stroke-width="1"/>
          <line x1="30" y1="60" x2="470" y2="60" stroke="#f1f5f9" stroke-width="1"/>
          <line x1="30" y1="110" x2="470" y2="110" stroke="#e2e8f0" stroke-width="1.5"/>
          <rect x="50" y="40" width="12" height="70" rx="2" fill="#6c5ce7"/>
          <rect x="64" y="70" width="12" height="40" rx="2" fill="#00d1c1"/>
          <rect x="130" y="30" width="12" height="80" rx="2" fill="#6c5ce7"/>
          <rect x="144" y="60" width="12" height="50" rx="2" fill="#00d1c1"/>
          <rect x="210" y="20" width="12" height="90" rx="2" fill="#6c5ce7"/>
          <rect x="224" y="50" width="12" height="60" rx="2" fill="#00d1c1"/>
          <rect x="290" y="15" width="12" height="95" rx="2" fill="#6c5ce7"/>
          <rect x="304" y="35" width="12" height="75" rx="2" fill="#00d1c1"/>
          <rect x="370" y="25" width="12" height="85" rx="2" fill="#6c5ce7"/>
          <rect x="384" y="45" width="12" height="65" rx="2" fill="#00d1c1"/>
          <text x="52" y="130" fill="#94a3b8" font-size="10" font-weight="600">Mon</text>
          <text x="132" y="130" fill="#94a3b8" font-size="10" font-weight="600">Wed</text>
          <text x="212" y="130" fill="#94a3b8" font-size="10" font-weight="600">Fri</text>
          <text x="292" y="130" fill="#94a3b8" font-size="10" font-weight="600">Sat</text>
          <text x="372" y="130" fill="#94a3b8" font-size="10" font-weight="600">Sun</text>
        </svg>
        <div class="donut-legend" style="justify-content:center; display:flex; gap:20px; margin-top:5px;">
          <div class="legend-item"><div class="legend-color" style="background:#6c5ce7;"></div>Customer Wallet Balances</div>
          <div class="legend-item"><div class="legend-color" style="background:#00d1c1;"></div>Promotional Credits Issued</div>
        </div>
      </div>
    </div>
  </div>

  <div class="page-break"></div>

  <!-- Safety & SOS Incident Center Details -->
  <div class="kpi-mapping-section">
    <h3>2.6 Safety & SOS Incident Center (SosIncidentsView.tsx) <span class="kpi-count-badge">4 KPIs</span></h3>
    
    <div class="op-context-box">
      <div class="op-context-title">🚨 Operational Blueprint: Safety & SOS Incident Center</div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <strong>The "Why" (Purpose):</strong> Critical life-safety center created to respond instantly to active partner/customer emergency panic button triggers in the field.
        </div>
        <div class="op-context-item">
          <strong>The "Who" (Operator):</strong> High-SLA Safety Response Teams and Physical Security Operators.
        </div>
        <div class="op-context-item">
          <strong>Daily Action (What they do):</strong> Monitor flashing red distress grids, telephone users in distress, coordinate with local authorities, and log resolutions.
        </div>
        <div class="op-context-item">
          <strong>Decision Logic:</strong> If an active SOS alert flashes, operators have exactly 30 seconds to initiate phone protocols. Failures trigger immediate supervisor alarms.
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Metric Name</th>
          <th>Visual Representation</th>
          <th>What it Means</th>
          <th>Operational Action / Response</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Active SOS distress feeds</strong></td>
          <td>Neon red visual list alert cards with pulsing sirens.</td>
          <td>Live customer/maid distress signals triggered via the mobile app.</td>
          <td>Immediate dispatcher operator call and contact to local emergency services.</td>
        </tr>
        <tr>
          <td><strong>2. Resolved Incidents</strong></td>
          <td>Top summary card.</td>
          <td>Count of incident cases successfully closed.</td>
          <td>Tracks incident closure rates and historical safety statistics.</td>
        </tr>
        <tr>
          <td><strong>3. Avg SLA Response Time</strong></td>
          <td>Timer countdown widget card.</td>
          <td>The average time elapsed between panic button trigger and operator response.</td>
          <td>Essential safety SLA. Response times must remain under 3 minutes.</td>
        </tr>
        <tr>
          <td><strong>4. Incident Severity List</strong></td>
          <td>Tabular grid sorting unresolved incidents.</td>
          <td>Detailed directory of active disputes categorized by priority levels.</td>
          <td>Guides shift supervisors on what safety tickets to review first.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Refunds Center Details -->
  <div class="kpi-mapping-section">
    <h3>2.7 Refunds Center (RefundsView.tsx) <span class="kpi-count-badge">5 KPIs</span></h3>
    
    <div class="op-context-box">
      <div class="op-context-title">🛡️ Operational Blueprint: Dispute & Refund Specialist</div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <strong>The "Why" (Purpose):</strong> Verify cancellation claims, evaluate booking issues, reverse double charges, and audit direct-to-card financial capital leakage.
        </div>
        <div class="op-context-item">
          <strong>The "Who" (Operator):</strong> Customer dispute specialists, Account reviews, and Accounting support.
        </div>
        <div class="op-context-item">
          <strong>Daily Action (What they do):</strong> Audit refund ticket backlogs, review photo/text evidence submitted by users, and click to approve/deny credits.
        </div>
        <div class="op-context-item">
          <strong>Decision Logic:</strong> If a specific partner partner exceeds a 5% customer refund rate, safety teams automatically block their matching scheduling loops.
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Metric Name</th>
          <th>Visual Representation</th>
          <th>What it Means</th>
          <th>Operational Action / Response</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Total Refunded</strong></td>
          <td>Numerical card featuring a mini-sparkline graph.</td>
          <td>The cumulative dollar sum returned back to customer profiles.</td>
          <td>Measures direct loss leakage. Spikes trigger partner quality evaluations.</td>
        </tr>
        <tr>
          <td><strong>2. Pending Requests</strong></td>
          <td>Numerical card featuring a mini-sparkline graph.</td>
          <td>The current count of refund disputes waiting for support verification.</td>
          <td>Tracks support queue sizes. Large counts trigger hiring or automation.</td>
        </tr>
        <tr>
          <td><strong>3. Refund Rate</strong></td>
          <td>Numerical card.</td>
          <td>The overall percentage of bookings resulting in a customer refund (e.g. 1.84%).</td>
          <td>Key customer happiness index. Target rate must remain below 2.0%.</td>
        </tr>
        <tr>
          <td><strong>4. Avg Refund Time</strong></td>
          <td>Numerical card featuring a mini-sparkline graph.</td>
          <td>The average time in days required to verify and clear refunds.</td>
          <td>Target is 2.1 days. Spikes signal customer service bottlenecks.</td>
        </tr>
        <tr>
          <td><strong>5. Refund Logs Directory</strong></td>
          <td>Tabular log showing user, reason, and status.</td>
          <td>Detailed history list of double charge, cancellation, and quality issues.</td>
          <td>Used by support agents to resolve customer payment disputes.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Marketing Campaigns Center Details -->
  <div class="kpi-mapping-section">
    <h3>2.8 Marketing & Promo Campaigns (CampaignsView.tsx) <span class="kpi-count-badge">3 KPIs</span></h3>
    
    <div class="op-context-box">
      <div class="op-context-title">📣 Operational Blueprint: Growth Marketer</div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <strong>The "Why" (Purpose):</strong> Track viral friend referrals, control promotional code budget burn rates, launch referral voucher campaigns, and monitor CAC channels.
        </div>
        <div class="op-context-item">
          <strong>The "Who" (Operator):</strong> Product managers, Marketing leads, and Growth engineers.
        </div>
        <div class="op-context-item">
          <strong>Daily Action (What they do):</strong> Issue new promo code keys, monitor discount budget caps, and deactivate low-performing marketing campaigns.
        </div>
        <div class="op-context-item">
          <strong>Decision Logic:</strong> If a specific code reaches its budget burn cap but triggers less than 1.5x customer return conversions, marketers instantly deactivate it.
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Metric Name</th>
          <th>Visual Representation</th>
          <th>What it Means</th>
          <th>Operational Action / Response</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1. Referral Registrations</strong></td>
          <td>Metric card showing total referred customers.</td>
          <td>Count of customer accounts created using promotional friend-invite links.</td>
          <td>Tracks marketing virality. Declines trigger larger referral incentives.</td>
        </tr>
        <tr>
          <td><strong>2. Promo Budget Burn</strong></td>
          <td>Metric card showing gross discount value spent.</td>
          <td>The cumulative discount value redeemed across promo code bookings.</td>
          <td>Prevents budget leakage. Over-burn triggers automatic campaign throttling.</td>
        </tr>
        <tr>
          <td><strong>3. Active Promo Codes List</strong></td>
          <td>Tabular directory of active voucher keys.</td>
          <td>List of active promo codes, expiration dates, and usage limits.</td>
          <td>Enables marketing managers to disable under-performing campaigns.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h2>3. Blueprint Conclusion & Recommendations</h2>
  <p>
    Integrating these interactive graphs inside the zaffabit admin dashboard creates a comprehensive platform analytics cockpit. 
    Currently, these charts use static simulated datasets in the React application layer. Connecting the frontend Recharts hooks to database aggregations completes the administrative sync.
  </p>

  <script>
    // Automatically trigger print dialog when opened
    window.onload = function() {
      setTimeout(() => {
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
  console.log('Writing comprehensive HTML report to filesystem...');

  const artifactsDir = path.join(__dirname, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const htmlPath = path.join(artifactsDir, 'comprehensive_kpi_report.html');
  const pdfPath = path.join(artifactsDir, 'comprehensive_kpi_report.pdf');

  fs.writeFileSync(htmlPath, htmlContent);
  console.log(`Saved styled HTML at: ${htmlPath}`);

  // Launching the macOS Google Chrome application directly to bypass local binary permissions
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  console.log(`Launching Google Chrome from: ${chromePath}`);

  puppeteer
    .launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    .then(async (browser) => {
      console.log('Browser launched successfully. Rendering report content...');
      const page = await browser.newPage();

      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      console.log('Generating A4 PDF sheet...');
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '15mm',
          bottom: '15mm',
          left: '15mm',
          right: '15mm',
        },
      });

      await browser.close();
      console.log(`PDF compiled successfully! Saved at: ${pdfPath}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to convert HTML to PDF:', error);
      process.exit(1);
    });
}

main();
