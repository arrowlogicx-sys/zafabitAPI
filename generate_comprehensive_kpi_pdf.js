const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function main() {
  console.log('Initiating Zaffabit Admin KPI & Operational Blueprint PDF compilation (V2)...');

  const zaffabitDir = path.resolve(__dirname, '..', 'zaffabit');
  const screenshotsDir = path.join(zaffabitDir, 'artifacts', 'screenshots');
  const artifactsDir = path.join(zaffabitDir, 'artifacts');

  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // Load screenshots and convert to base64
  const imageBase64 = {};
  const screens = [
    { key: 'dashboard', filename: '01_dashboard.png', name: 'Dashboard Overview' },
    { key: 'users', filename: '02_users.png', name: 'User Management' },
    { key: 'maid_partners', filename: '03_maid_partners.png', name: 'Maid Partners' },
    { key: 'operations', filename: '04_operations.png', name: 'Operations Center' },
    { key: 'bookings', filename: '05_bookings.png', name: 'Bookings Management' },
    { key: 'services', filename: '06_services.png', name: 'Service Management' },
    { key: 'earnings', filename: '07_earnings.png', name: 'Earnings & Payouts' },
    { key: 'transactions', filename: '08_transactions.png', name: 'Transactions Auditor' },
    { key: 'refunds', filename: '09_refunds.png', name: 'Refunds Center' },
    { key: 'wallet', filename: '10_wallet.png', name: 'Wallet & Credits' },
    { key: 'campaigns', filename: '11_campaigns.png', name: 'Marketing Campaigns' },
    { key: 'promotions', filename: '12_promotions.png', name: 'Promotions & Coupons' },
    { key: 'content', filename: '13_content.png', name: 'App Content Management' },
    { key: 'referrals', filename: '14_referrals.png', name: 'Referral System' },
    { key: 'support', filename: '15_support.png', name: 'Support Tickets' },
    { key: 'sos', filename: '16_sos.png', name: 'Safety & SOS Incident Center' },
    { key: 'reviews', filename: '17_reviews.png', name: 'Review & Rating Auditor' },
    { key: 'analytics', filename: '18_analytics.png', name: 'Revenue Analytics' },
    { key: 'partner_analytics', filename: '19_partner_analytics.png', name: 'Partner Analytics' },
    { key: 'booking_analytics', filename: '20_booking_analytics.png', name: 'Booking Analytics' },
    { key: 'geo_heatmap', filename: '21_geo_heatmap.png', name: 'Geographical Demand Heatmap' },
    { key: 'export_data', filename: '22_export_data.png', name: 'Data Export Portal' },
    { key: 'settings', filename: '23_settings.png', name: 'System Settings' },
    {
      key: 'admin_management',
      filename: '24_admin_management.png',
      name: 'Admin Account Management',
    },
    {
      key: 'activity_logs',
      filename: '25_activity_logs.png',
      name: 'System Activity & Audit Logs',
    },
  ];

  console.log('Encoding screen screenshots to base64...');
  for (const screen of screens) {
    const imgPath = path.join(screenshotsDir, screen.filename);
    if (fs.existsSync(imgPath)) {
      const data = fs.readFileSync(imgPath);
      imageBase64[screen.key] = `data:image/png;base64,${data.toString('base64')}`;
      console.log(`- Loaded and encoded: ${screen.filename}`);
    } else {
      console.warn(`- Screenshot not found: ${imgPath}. Using empty fallback.`);
      imageBase64[screen.key] = '';
    }
  }

  // Helper function to render CSS fraction
  const frac = (num, den) =>
    `<span class="math-fraction"><span class="fraction-numerator">${num}</span><span class="fraction-denominator">${den}</span></span>`;

  // 1. Dashboard KPIs & aggregations
  const dashboardKpis = [
    {
      name: 'Total Revenue',
      staging: '₹2,48,340 (+15.8%)',
      formula: 'Sum(totalAmount) for Completed Bookings',
      simpleMath: `Revenue = &sum; R<sub>completed</sub>`,
      mongo: `const revenueData = await Booking.aggregate([\n  { $match: { status: 'completed' } },\n  { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } }\n]);`,
      desc: 'Gross financial volume processed for completed services today.',
    },
    {
      name: 'New Customers',
      staging: '282 (+8.4%)',
      formula: 'Count(Users) registered in last 24 hours',
      simpleMath: `Customers<sub>new</sub> = &sum; Users<sub>created</sub> [24h]`,
      mongo: `const customerCount = await User.countDocuments({\n  createdAt: { $gte: todayStart }\n});`,
      desc: 'Volume of customer accounts created today.',
    },
    {
      name: 'New Maids',
      staging: '42 (+12.4%)',
      formula: 'Count(Maids) registered and approved in last 24 hours',
      simpleMath: `Maids<sub>new</sub> = &sum; Maids<sub>active</sub> [24h]`,
      mongo: `const maidCount = await Maid.countDocuments({\n  createdAt: { $gte: todayStart },\n  status: 'active'\n});`,
      desc: 'Number of service partners successfully onboarded today.',
    },
    {
      name: 'Completion Rate',
      staging: '94.2% (+5.4%)',
      formula: '(Completed / Total Requested) * 100',
      simpleMath: `Completion Rate = ${frac('Bookings<sub>completed</sub>', 'Bookings<sub>total_requested</sub>')} &times; 100%`,
      mongo: `const stats = await Booking.aggregate([\n  { $group: { _id: '$status', count: { $sum: 1 } } }\n]);`,
      desc: 'Percentage of requested bookings completed.',
    },
    {
      name: 'Cancellation Rate',
      staging: '2.8% (+0.4%)',
      formula: '(Cancelled / Total Requested) * 100',
      simpleMath: `Cancellation Rate = ${frac('Bookings<sub>cancelled</sub>', 'Bookings<sub>total_requested</sub>')} &times; 100%`,
      mongo: `const cancelled = await Booking.countDocuments({ status: 'cancelled' });\nconst total = await Booking.countDocuments({});`,
      desc: 'Proportion of booking cancellations.',
    },
    {
      name: 'Refunds Issued',
      staging: '₹8,690 (+5.4%)',
      formula: 'Sum(amount) for Approved Refunds in last 24 hours',
      simpleMath: `Refunds = &sum; Refund<sub>approved</sub> [24h]`,
      mongo: `const refundsData = await Refund.aggregate([\n  { $match: { status: 'approved', createdAt: { $gte: todayStart } } },\n  { $group: { _id: null, total: { $sum: '$amount' } } }\n]);`,
      desc: 'Direct financial leakage from capital reserves back to customers.',
    },
    {
      name: 'Average Order Value (AOV)',
      staging: '₹450 (+2.1%)',
      formula: 'Total Revenue / Completed Bookings Count',
      simpleMath: `AOV = ${frac('Revenue<sub>total</sub>', 'Bookings<sub>completed</sub>')}`,
      mongo: `const aov = await Booking.aggregate([\n  { $match: { status: 'completed' } },\n  { $group: { _id: null, avgValue: { $avg: '$totalAmount' } } }\n]);`,
      desc: 'Average cart checkout size for standard cleans.',
    },
  ];

  // 2. Users KPIs
  const usersKpis = [
    {
      name: 'Total Users',
      staging: '12,482',
      formula: 'Count(All Customer accounts)',
      simpleMath: `Users<sub>total</sub> = &sum; Users`,
      mongo: 'const totalUsers = await User.countDocuments({});',
      desc: 'Total database volume of registered customer accounts.',
    },
    {
      name: 'Active Users',
      staging: '8,421',
      formula: 'Count(Users with activity in last 30 days)',
      simpleMath: `Users<sub>active</sub> = &sum; Users [Active in 30 days]`,
      mongo: `const activeUsers = await User.countDocuments({\n  lastActive: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }\n});`,
      desc: 'Customer cohort engaged with the platform monthly.',
    },
    {
      name: 'New Registrations',
      staging: '282 Today',
      formula: 'Count(Users) registered today',
      simpleMath: `Registrations = &sum; Users<sub>created</sub> [Today]`,
      mongo: `const newUsers = await User.countDocuments({ createdAt: { $gte: todayStart } });`,
      desc: 'Measures standard daily customer acquisition growth.',
    },
    {
      name: 'Banned Users',
      staging: '45',
      formula: 'Count(Users with status = banned)',
      simpleMath: `Users<sub>banned</sub> = &sum; Users [isBanned = true]`,
      mongo: `const bannedUsers = await User.countDocuments({ isBanned: true });`,
      desc: 'Accounts locked for fraud, policy violations, or chargebacks.',
    },
    {
      name: 'User Verification Rate',
      staging: '98.4%',
      formula: '(Verified / Total) * 100',
      simpleMath: `Verification Rate = ${frac('Users<sub>verified</sub>', 'Users<sub>total</sub>')} &times; 100%`,
      mongo: `const verified = await User.countDocuments({ isPhoneVerified: true });`,
      desc: 'Audits signup trust. High verification keeps platform risk low.',
    },
    {
      name: 'Daily Active Users (DAU)',
      staging: '1,248',
      formula: 'Count(Users active in last 24h)',
      simpleMath: `DAU = &sum; Users [Active in 24h]`,
      mongo: `const dau = await User.countDocuments({ lastActive: { $gte: yesterdayStart } });`,
      desc: 'Core product engagement rate on a daily basis.',
    },
  ];

  // 3. Maid Partners KPIs
  const maidKpis = [
    {
      name: 'Total Partners',
      staging: '1,248',
      formula: 'Count(All Maid accounts)',
      simpleMath: `Partners<sub>total</sub> = &sum; Partners`,
      mongo: 'const totalPartners = await Partner.countDocuments({});',
      desc: 'Registered pool of cleaners/maids on the platform.',
    },
    {
      name: 'Active Online Partners',
      staging: '842',
      formula: 'Count(Partners online in last 24h)',
      simpleMath: `Partners<sub>online</sub> = &sum; Partners [status = 'online']`,
      mongo: `const activePartners = await Partner.countDocuments({ status: 'online' });`,
      desc: 'Service provider capacity available in real time.',
    },
    {
      name: 'Pending Approvals',
      staging: '34',
      formula: 'Count(Partners in pending state)',
      simpleMath: `Partners<sub>pending</sub> = &sum; Partners [status = 'pending']`,
      mongo: `const pendingPartners = await Partner.countDocuments({ status: 'pending' });`,
      desc: 'Onboarding queue. Operators must review details within 24 hours.',
    },
    {
      name: 'Average Partner Rating',
      staging: '4.85 / 5.0',
      formula: 'Avg(rating) across active partners',
      simpleMath: `Rating<sub>avg</sub> = ${frac('&sum; Rating<sub>i</sub>', 'Ratings<sub>total</sub>')}`,
      mongo: `const avgRating = await Partner.aggregate([\n  { $group: { _id: null, avg: { $avg: '$rating' } } }\n]);`,
      desc: 'Core quality indicator representing customer review trends.',
    },
    {
      name: 'Partner Retention Rate',
      staging: '92.4%',
      formula: '(Active Month 2 / Cohort Month 1) * 100',
      simpleMath: `Retention Rate = ${frac('Partners<sub>active_M2</sub>', 'Partners<sub>cohort_M1</sub>')} &times; 100%`,
      mongo: `// Cohort match pipeline identifying partner activity over monthly periods`,
      desc: 'Percentage of partner supply that remains active Month-over-Month.',
    },
    {
      name: 'Avg Cleaners Online Density',
      staging: '84.2%',
      formula: '(Online Partners / Active Partners) * 100',
      simpleMath: `Density = ${frac('Partners<sub>online</sub>', 'Partners<sub>active</sub>')} &times; 100%`,
      mongo: `const online = await Partner.countDocuments({ status: 'online' });\nconst active = await Partner.countDocuments({ status: 'active' });`,
      desc: 'Percentage of total active partner workforce online.',
    },
  ];

  // 4. Operations KPIs
  const operationsKpis = [
    {
      name: 'Live Booking Requests',
      staging: '12',
      formula: 'Count(Bookings with status = searching)',
      simpleMath: `Queue<sub>searching</sub> = &sum; Bookings [status = 'searching']`,
      mongo: `const pendingRequests = await Booking.countDocuments({ status: 'searching' });`,
      desc: 'Pending matching queue. High values indicate search congestion.',
    },
    {
      name: 'Active Jobs',
      staging: '142',
      formula: 'Count(Bookings with status = in-progress)',
      simpleMath: `Jobs<sub>active</sub> = &sum; Bookings [status = 'in-progress']`,
      mongo: `const activeJobs = await Booking.countDocuments({ status: 'in-progress' });`,
      desc: 'Cleaning jobs actively being performed in the field.',
    },
    {
      name: 'Delayed Job Alarms',
      staging: '2 Urgent',
      formula: 'Count(Bookings accepted but delayed past scheduled start time)',
      simpleMath: `Alarms = &sum; Bookings [status = 'accepted' &amp; currentTime &gt; scheduledTime]`,
      mongo: `const delayedJobs = await Booking.countDocuments({\n  status: 'accepted',\n  scheduledTime: { $lt: new Date() }\n});`,
      desc: 'Operational alerts. Triggers manual customer outreach.',
    },
    {
      name: 'Dispatcher Avg Match Time',
      staging: '1m 45s',
      formula: 'Avg(matchedAt - createdAt)',
      simpleMath: `Match Time<sub>avg</sub> = ${frac('&sum; (Time<sub>matched</sub> - Time<sub>created</sub>)', 'Bookings<sub>matched</sub>')}`,
      mongo: `const avgMatchTime = await Booking.aggregate([\n  { $match: { matchedAt: { $exists: true } } },\n  { $group: { _id: null, avgTime: { $avg: { $subtract: ['$matchedAt', '$createdAt'] } } } }\n]);`,
      desc: 'Measure of algorithmic efficiency to dispatch a partner.',
    },
    {
      name: 'Manual Dispatch Overrides',
      staging: '8 Today',
      formula: 'Count(Bookings dispatched manually by admin override today)',
      simpleMath: `Overrides = &sum; Overrides [Today]`,
      mongo: `const manualOverrides = await Booking.countDocuments({ dispatchType: 'manual', createdAt: { $gte: todayStart } });`,
      desc: 'Percentage of dispatch actions handled manually by operations team.',
    },
  ];

  // 5. Bookings KPIs
  const bookingKpis = [
    {
      name: 'Total Bookings',
      staging: '18,421',
      formula: 'Count(All Bookings)',
      simpleMath: `Bookings<sub>total</sub> = &sum; Bookings`,
      mongo: 'const totalBookings = await Booking.countDocuments({});',
      desc: 'Total historical booking volume processed by the platform.',
    },
    {
      name: 'Active Bookings',
      staging: '142',
      formula: 'Count(Bookings in-progress)',
      simpleMath: `Bookings<sub>active</sub> = &sum; Bookings [status = 'in-progress']`,
      mongo: `const activeBookings = await Booking.countDocuments({ status: 'in-progress' });`,
      desc: 'Current active operations volume.',
    },
    {
      name: 'Pending Match',
      staging: '12',
      formula: 'Count(Bookings with status = searching)',
      simpleMath: `Bookings<sub>searching</sub> = &sum; Bookings [status = 'searching']`,
      mongo: `const pendingMatch = await Booking.countDocuments({ status: 'searching' });`,
      desc: 'Unassigned bookings.',
    },
    {
      name: 'Cancelled Bookings',
      staging: '482',
      formula: 'Count(Bookings with status = cancelled)',
      simpleMath: `Bookings<sub>cancelled</sub> = &sum; Bookings [status = 'cancelled']`,
      mongo: `const cancelled = await Booking.countDocuments({ status: 'cancelled' });`,
      desc: 'Cancelled orders. Requires review to identify reasons.',
    },
    {
      name: 'Avg Schedule Lead Time',
      staging: '2.4 Days',
      formula: 'Avg(scheduledTime - createdAt)',
      simpleMath: `Lead Time = ${frac('&sum; (Time<sub>scheduled</sub> - Time<sub>created</sub>)', 'Bookings<sub>scheduled</sub>')}`,
      mongo: `const leadTime = await Booking.aggregate([\n  { $match: { dispatchType: 'scheduled' } },\n  { $group: { _id: null, avgTime: { $avg: { $subtract: ['$scheduledTime', '$createdAt'] } } } }\n]);`,
      desc: 'Average advance warning users give before a scheduled cleaning.',
    },
  ];

  // 6. Service Management KPIs
  const serviceKpis = [
    {
      name: 'Active Services',
      staging: '18',
      formula: 'Count(Services with status = active)',
      simpleMath: `Services<sub>active</sub> = &sum; Services [isActive = true]`,
      mongo: `const activeServices = await Service.countDocuments({ isActive: true });`,
      desc: 'Number of active cleaning service variants.',
    },
    {
      name: 'Average Service Price',
      staging: '₹450',
      formula: 'Avg(basePrice) of active services',
      simpleMath: `Price<sub>avg</sub> = ${frac('&sum; BasePrice<sub>i</sub>', 'Services<sub>active</sub>')}`,
      mongo: `const avgPrice = await Service.aggregate([\n  { $group: { _id: null, avg: { $avg: '$basePrice' } } }\n]);`,
      desc: 'Base pricing index of the services catalogue.',
    },
    {
      name: 'Total Custom Packages',
      staging: '8',
      formula: 'Count(Add-on packages)',
      simpleMath: `Packages = &sum; Packages`,
      mongo: `const customPkgs = await Package.countDocuments({});`,
      desc: 'Custom configured add-ons available for standard bookings.',
    },
    {
      name: 'Category Distribution Count',
      staging: '4',
      formula: 'Count(Service categories)',
      simpleMath: `Categories = Count(Unique categories)`,
      mongo: `const categories = await Service.distinct('category');`,
      desc: 'Number of operational cleaning classes available.',
    },
    {
      name: 'Add-on Attachment Rate',
      staging: '42.4%',
      formula: '(Bookings with Add-on / Total Bookings) * 100',
      simpleMath: `Attachment Rate = ${frac('Bookings<sub>with_addons</sub>', 'Bookings<sub>total</sub>')} &times; 100%`,
      mongo: `const addonBookings = await Booking.countDocuments({ 'packages.0': { $exists: true } });\nconst total = await Booking.countDocuments({});`,
      desc: 'Proportion of bookings that purchased secondary custom add-ons.',
    },
  ];

  // 7. Earnings & Payouts KPIs
  const earningsKpis = [
    {
      name: 'Total Platform Earnings',
      staging: '₹4,82,340',
      formula: 'Sum(platformFee) for Completed Bookings',
      simpleMath: `Earnings<sub>platform</sub> = &sum; PlatformFee<sub>completed</sub>`,
      mongo: `const totalPlatformCut = await Booking.aggregate([\n  { $match: { status: 'completed' } },\n  { $group: { _id: null, platformCut: { $sum: '$platformFee' } } }\n]);`,
      desc: 'Platform commission and processing fees captured.',
    },
    {
      name: 'Partner Earnings',
      staging: '₹12,48,290',
      formula: 'Sum(partnerFee) for Completed Bookings',
      simpleMath: `Earnings<sub>partner</sub> = &sum; PartnerFee<sub>completed</sub>`,
      mongo: `const partnerEarnings = await Booking.aggregate([\n  { $match: { status: 'completed' } },\n  { $group: { _id: null, partnerCut: { $sum: '$partnerFee' } } }\n]);`,
      desc: 'Total revenue earned by cleaners before payout disbursements.',
    },
    {
      name: 'Pending Payouts',
      staging: '₹84,200',
      formula: 'Sum(amount) for Payouts with status = pending',
      simpleMath: `Payouts<sub>pending</sub> = &sum; Payout<sub>pending</sub>`,
      mongo: `const pendingPayouts = await Payout.aggregate([\n  { $match: { status: 'pending' } },\n  { $group: { _id: null, totalPending: { $sum: '$amount' } } }\n]);`,
      desc: 'Earnings verified but not yet disbursed to partner bank accounts.',
    },
    {
      name: 'Completed Payouts',
      staging: '₹11,64,090',
      formula: 'Sum(amount) for Payouts with status = completed',
      simpleMath: `Payouts<sub>completed</sub> = &sum; Payout<sub>completed</sub>`,
      mongo: `const completedPayouts = await Payout.aggregate([\n  { $match: { status: 'completed' } },\n  { $group: { _id: null, totalCompleted: { $sum: '$amount' } } }\n]);`,
      desc: 'Earnings successfully paid out to partner bank accounts.',
    },
    {
      name: 'Average Payout Per Maid',
      staging: '₹12,480',
      formula: 'Partner Earnings / Active Partners',
      simpleMath: `Payout<sub>avg</sub> = ${frac('Earnings<sub>partner</sub>', 'Partners<sub>active</sub>')}`,
      mongo: `// Evaluated by dividing partner cuts by active unique partner counts`,
      desc: 'Monthly wage indicator. Important for supply satisfaction.',
    },
    {
      name: 'Platform Commission Margin',
      staging: '27.8%',
      formula: '(Platform Earnings / Total Revenue) * 100',
      simpleMath: `Margin = ${frac('Earnings<sub>platform</sub>', 'Revenue<sub>total</sub>')} &times; 100%`,
      mongo: `// Divided total platform cuts by aggregate booking gross revenues`,
      desc: 'Ratio of platform earnings relative to gross billing volume.',
    },
  ];

  // 8. Transactions KPIs
  const transactionsKpis = [
    {
      name: 'Gross Payment Volume',
      staging: '₹14,96,630',
      formula: 'Sum(amount) of all payment records',
      simpleMath: `GPV = &sum; Payments`,
      mongo: `const grossVol = await Transaction.aggregate([\n  { $group: { _id: null, gross: { $sum: '$amount' } } }\n]);`,
      desc: 'Total financial scale handled by platform payment gateway.',
    },
    {
      name: 'Net Platform Revenue',
      staging: '₹2,48,340',
      formula: 'Sum(amount) for commissions',
      simpleMath: `Revenue<sub>net</sub> = &sum; Commissions`,
      mongo: `const netRev = await Transaction.aggregate([\n  { $match: { type: 'commission' } },\n  { $group: { _id: null, net: { $sum: '$amount' } } }\n]);`,
      desc: 'Clean platform revenue. Measures operational profitability.',
    },
    {
      name: 'Failed Transactions Count',
      staging: '18',
      formula: 'Count(Transactions with status = failed)',
      simpleMath: `Failures = &sum; Transactions [status = 'failed']`,
      mongo: `const failedCount = await Transaction.countDocuments({ status: 'failed' });`,
      desc: 'Failed payments. Spikes point to Stripe API or banking network drops.',
    },
    {
      name: 'Transaction Success Rate',
      staging: '98.8%',
      formula: '(Success / Total Attempts) * 100',
      simpleMath: `Success Rate = ${frac('Transactions<sub>success</sub>', 'Transactions<sub>attempts</sub>')} &times; 100%`,
      mongo: `const success = await Transaction.countDocuments({ status: 'success' });\nconst total = await Transaction.countDocuments({});`,
      desc: 'Payment Gateway performance SLA.',
    },
    {
      name: 'Avg Gateway Fee Paid',
      staging: '₹14.50',
      formula: 'Avg(gatewayFee) of all transactions',
      simpleMath: `Fee<sub>avg</sub> = ${frac('&sum; Fee<sub>i</sub>', 'Transactions<sub>total</sub>')}`,
      mongo: `const avgFee = await Transaction.aggregate([\n  { $group: { _id: null, avgFee: { $avg: '$gatewayFee' } } }\n]);`,
      desc: 'Average transaction commission fee paid to Stripe.',
    },
  ];

  // 9. Refunds KPIs
  const refundsKpis = [
    {
      name: 'Total Refunded',
      staging: '₹8,690',
      formula: 'Sum(amount) of approved refunds',
      simpleMath: `Refunded = &sum; Refund<sub>approved</sub>`,
      mongo: `const refunded = await Refund.aggregate([\n  { $match: { status: 'approved' } },\n  { $group: { _id: null, total: { $sum: '$amount' } } }\n]);`,
      desc: 'Total financial volume returned to customer accounts.',
    },
    {
      name: 'Pending Requests',
      staging: '4',
      formula: 'Count(Refunds with status = pending)',
      simpleMath: `Refunds<sub>pending</sub> = &sum; Refund [status = 'pending']`,
      mongo: `const pending = await Refund.countDocuments({ status: 'pending' });`,
      desc: 'Disputes awaiting operational evaluation.',
    },
    {
      name: 'Avg Refund processing time',
      staging: '1.2 Days',
      formula: 'Avg(resolvedAt - createdAt)',
      simpleMath: `Resolution Time = ${frac('&sum; (Time<sub>resolved</sub> - Time<sub>created</sub>)', 'Refunds<sub>approved</sub>')}`,
      mongo: `const avgRefundTime = await Refund.aggregate([\n  { $match: { status: 'approved' } },\n  { $group: { _id: null, avgTime: { $avg: { $subtract: ['$resolvedAt', '$createdAt'] } } } }\n]);`,
      desc: 'Average calendar time required to resolve a refund ticket.',
    },
    {
      name: 'Refund-to-Booking Ratio',
      staging: '0.8%',
      formula: '(Refunds count / Completed Bookings count) * 100',
      simpleMath: `Refund Ratio = ${frac('Refunds<sub>count</sub>', 'Bookings<sub>completed</sub>')} &times; 100%`,
      mongo: `// Evaluated by dividing the count of refunds by the count of completed bookings`,
      desc: 'Percentage of total bookings ending in a partial or full refund.',
    },
    {
      name: 'Dispute Win Rate',
      staging: '92.4%',
      formula: '(Denied Disputes / Total Dispute Claims) * 100',
      simpleMath: `Win Rate = ${frac('Disputes<sub>denied</sub>', 'Disputes<sub>total</sub>')} &times; 100%`,
      mongo: `const winRate = await Refund.countDocuments({ status: 'denied' });`,
      desc: 'Percentage of refund claims successfully denied by operations due to invalid evidence.',
    },
  ];

  // 10. Wallet KPIs
  const walletKpis = [
    {
      name: 'Total Wallet Balance',
      staging: '₹2,48,200',
      formula: 'Sum(walletBalance) of all customer profiles',
      simpleMath: `Balance<sub>total</sub> = &sum; WalletBalance`,
      mongo: `const walletTotal = await User.aggregate([\n  { $group: { _id: null, total: { $sum: '$walletBalance' } } }\n]);`,
      desc: 'Held customer cash deposits. Platform financial liability.',
    },
    {
      name: 'Credits Issued YTD',
      staging: '₹1,24,000',
      formula: 'Sum(amount) of credits issued YTD',
      simpleMath: `Credits<sub>issued</sub> = &sum; Credits [type = 'issue']`,
      mongo: `const issuedCredits = await CreditHistory.aggregate([\n  { $match: { type: 'issue' } },\n  { $group: { _id: null, total: { $sum: '$amount' } } }\n]);`,
      desc: 'Total gift and promo credit awarded to customers.',
    },
    {
      name: 'Credits Redeemed',
      staging: '₹84,200',
      formula: 'Sum(amount) of credits redeemed',
      simpleMath: `Credits<sub>redeemed</sub> = &sum; Credits [type = 'redeem']`,
      mongo: `const redeemedCredits = await CreditHistory.aggregate([\n  { $match: { type: 'redeem' } },\n  { $group: { _id: null, total: { $sum: '$amount' } } }\n]);`,
      desc: 'Credit volume converted into booked clean services.',
    },
    {
      name: 'Liability Reserves',
      staging: '₹1,64,000',
      formula: 'Total Wallet Balance - Unredeemed Promo Credits',
      simpleMath: `Reserves = Balance<sub>total</sub> - Credits<sub>unredeemed</sub>`,
      mongo: `// Calculation logic deducting active promotional credits from total cash balances`,
      desc: 'Net cash balance liability after subtracting promo-issued credits.',
    },
    {
      name: 'Avg Wallet Balance per User',
      staging: '₹19.80',
      formula: 'Total Wallet Balance / Total Users',
      simpleMath: `Wallet<sub>avg</sub> = ${frac('Balance<sub>total</sub>', 'Users<sub>total</sub>')}`,
      mongo: `const totalBalance = await User.aggregate([{ $group: { _id: null, total: { $sum: '$walletBalance' } } }]);`,
      desc: 'Average cash balance stored in a user profile wallet.',
    },
  ];

  // 11. Campaigns KPIs
  const campaignKpis = [
    {
      name: 'Active Campaigns',
      staging: '4',
      formula: 'Count(Campaigns with status = active)',
      simpleMath: `Campaigns<sub>active</sub> = &sum; Campaigns [status = 'active']`,
      mongo: `const activeCampaigns = await Campaign.countDocuments({ status: 'active' });`,
      desc: 'Live marketing campaigns active in client apps.',
    },
    {
      name: 'Promo Budget Burn',
      staging: '₹42,000',
      formula: 'Sum(amountSpent) of all campaign disbursements',
      simpleMath: `Burn<sub>promo</sub> = &sum; BudgetSpent<sub>campaign</sub>`,
      mongo: `const budgetBurn = await Campaign.aggregate([\n  { $group: { _id: null, totalBurn: { $sum: '$amountSpent' } } }\n]);`,
      desc: 'Capital spent YTD on customer promotions.',
    },
    {
      name: 'Campaign Conversion Rate',
      staging: '12.8%',
      formula: '(Signups from Campaigns / Total clicks) * 100',
      simpleMath: `Conversion = ${frac('Users<sub>campaign</sub>', 'Clicks<sub>campaign</sub>')} &times; 100%`,
      mongo: `// Matches signup paths to campaign tracking clicks`,
      desc: 'Growth marketing efficiency index.',
    },
    {
      name: 'Customer Acquisition Cost (CAC)',
      staging: '₹180',
      formula: 'Promo Budget Burn / Campaign Signups Count',
      simpleMath: `CAC = ${frac('Burn<sub>promo</sub>', 'Users<sub>campaign</sub>')}`,
      mongo: `// Divided campaign spend by corresponding signup user indices`,
      desc: 'Financial cost incurred to onboard a new customer through advertisements.',
    },
  ];

  // 12. Promotions KPIs
  const promoKpis = [
    {
      name: 'Active Coupons',
      staging: '12',
      formula: 'Count(Coupons with status = active)',
      simpleMath: `Coupons<sub>active</sub> = &sum; Coupons [status = 'active']`,
      mongo: `const activeCoupons = await Coupon.countDocuments({ status: 'active' });`,
      desc: 'Live coupons available for checkout discount.',
    },
    {
      name: 'Total Redemptions',
      staging: '1,482',
      formula: 'Count(Bookings with applied discount)',
      simpleMath: `Redemptions = &sum; Bookings [couponCode exists]`,
      mongo: `const redemptions = await Booking.countDocuments({ couponCode: { $exists: true } });`,
      desc: 'Total discount activations YTD.',
    },
    {
      name: 'Total Discounts Given',
      staging: '₹1,48,200',
      formula: 'Sum(discountAmount) on bookings',
      simpleMath: `Discounts = &sum; DiscountAmount<sub>bookings</sub>`,
      mongo: `const totalDiscounts = await Booking.aggregate([\n  { $match: { couponCode: { $exists: true } } },\n  { $group: { _id: null, total: { $sum: '$discountAmount' } } }\n]);`,
      desc: 'Gross dollar discounts given to customers.',
    },
    {
      name: 'Promotion ROI',
      staging: '3.4x',
      formula: 'Revenue Generated / Total Discounts Given',
      simpleMath: `ROI = ${frac('Revenue<sub>promoted</sub>', 'Discounts')}`,
      mongo: `// Revenue from discounted bookings / total discount value given`,
      desc: 'Measures campaign financial returns.',
    },
    {
      name: 'Discount Contribution Rate',
      staging: '8.5%',
      formula: '(Discounts Given / Gross Revenue) * 100',
      simpleMath: `Contribution = ${frac('Discounts', 'Revenue<sub>gross</sub>')} &times; 100%`,
      mongo: `// Ratio of promotional discount totals against gross revenues`,
      desc: 'Proportion of gross revenues deducted via promotional discount codes.',
    },
  ];

  // 13. Content KPIs
  const contentKpis = [
    {
      name: 'Total FAQs',
      staging: '48',
      formula: 'Count(FAQ entries)',
      simpleMath: `FAQs = &sum; FAQ`,
      mongo: 'const faqCount = await Faq.countDocuments({});',
      desc: 'Active self-service items in FAQ client directory.',
    },
    {
      name: 'Active Banners',
      staging: '4',
      formula: 'Count(Banners with status = active)',
      simpleMath: `Banners<sub>active</sub> = &sum; Banners [isActive = true]`,
      mongo: `const activeBanners = await Banner.countDocuments({ isActive: true });`,
      desc: 'Marketing banners live on customer application screens.',
    },
    {
      name: 'Terms Revision Index',
      staging: 'v3.2',
      formula: 'Latest version of policy documents',
      simpleMath: `Revision = Max(Version<sub>policy</sub>)`,
      mongo: `const latestPolicy = await ContentVersion.findOne({ type: 'policy' }).sort({ version: -1 });`,
      desc: 'Version index of legal terms.',
    },
    {
      name: 'Content View Count',
      staging: '48,200',
      formula: 'Sum(views) of FAQ items',
      simpleMath: `Views = &sum; ViewCount`,
      mongo: `const totalViews = await ContentMetric.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]);`,
      desc: 'Customer self-service metrics.',
    },
    {
      name: 'Help Article Helpful Rating',
      staging: '94.2%',
      formula: '(Positive Feedback Count / Total Feedback) * 100',
      simpleMath: `Helpful Rating = ${frac('Feedback<sub>positive</sub>', 'Feedback<sub>total</sub>')} &times; 100%`,
      mongo: `const rating = await ContentMetric.aggregate([\n  { $group: { _id: null, score: { $avg: '$helpfulScore' } } }\n]);`,
      desc: 'Percentage of users indicating an FAQ resolved their question.',
    },
  ];

  // 14. Referrals KPIs
  const referralKpis = [
    {
      name: 'Total Referrals',
      staging: '842',
      formula: 'Count(Referrals recorded)',
      simpleMath: `Referrals = &sum; Referrals`,
      mongo: 'const totalReferrals = await Referral.countDocuments({});',
      desc: 'Total customer referral events tracked.',
    },
    {
      name: 'Active Referral Codes',
      staging: '282',
      formula: 'Count(Users with active codes)',
      simpleMath: `Codes<sub>active</sub> = &sum; Users [referralCode exists]`,
      mongo: `const activeCodes = await User.countDocuments({ referralCode: { $exists: true } });`,
      desc: 'Users actively sharing referral links.',
    },
    {
      name: 'Referral Bonuses Paid',
      staging: '₹42,100',
      formula: 'Sum(amount) for referral bonuses',
      simpleMath: `Bonuses = &sum; BonusAmount`,
      mongo: `const referralBonuses = await CreditHistory.aggregate([\n  { $match: { reason: 'referral_bonus' } },\n  { $group: { _id: null, total: { $sum: '$amount' } } }\n]);`,
      desc: 'Financial pay out for referral incentives.',
    },
    {
      name: 'Referral Conversion Rate',
      staging: '18.5%',
      formula: '(Completed Referred Signups / Shared Links) * 100',
      simpleMath: `Conversion = ${frac('Signups<sub>referred</sub>', 'Links<sub>shared</sub>')} &times; 100%`,
      mongo: `// Matches signup paths to shared invitation codes`,
      desc: 'Efficiency of platform organic viral loop.',
    },
    {
      name: 'Organic Acquisition Share',
      staging: '18.5%',
      formula: '(Referral Signups / Total Signups) * 100',
      simpleMath: `Organic Share = ${frac('Signups<sub>referred</sub>', 'Signups<sub>total</sub>')} &times; 100%`,
      mongo: `const referred = await Referral.countDocuments({});\nconst total = await User.countDocuments({});`,
      desc: 'Proportion of total customers acquired through friend-to-friend invites.',
    },
  ];

  // 15. Support KPIs
  const supportKpis = [
    {
      name: 'Open Tickets',
      staging: '14',
      formula: 'Count(Tickets with status = open)',
      simpleMath: `Tickets<sub>open</sub> = &sum; Tickets [status = 'open']`,
      mongo: `const openTickets = await Ticket.countDocuments({ status: 'open' });`,
      desc: 'Active customer complaints.',
    },
    {
      name: 'Pending Tickets',
      staging: '8',
      formula: 'Count(Tickets with status = pending)',
      simpleMath: `Tickets<sub>pending</sub> = &sum; Tickets [status = 'pending']`,
      mongo: `const pendingTickets = await Ticket.countDocuments({ status: 'pending' });`,
      desc: 'Tickets awaiting info or escalation.',
    },
    {
      name: 'Resolved Tickets',
      staging: '1,248',
      formula: 'Count(Tickets with status = resolved)',
      simpleMath: `Tickets<sub>resolved</sub> = &sum; Tickets [status = 'resolved']`,
      mongo: `const resolvedTickets = await Ticket.countDocuments({ status: 'resolved' });`,
      desc: 'Completed customer support cases.',
    },
    {
      name: 'Avg First Response SLA',
      staging: '4m 12s',
      formula: 'Avg(respondedAt - createdAt)',
      simpleMath: `SLA<sub>first</sub> = ${frac('&sum; (Time<sub>responded</sub> - Time<sub>created</sub>)', 'Tickets<sub>responded</sub>')}`,
      mongo: `const avgResponseSla = await Ticket.aggregate([\n  { $match: { respondedAt: { $exists: true } } },\n  { $group: { _id: null, avgTime: { $avg: { $subtract: ['$respondedAt', '$createdAt'] } } } }\n]);`,
      desc: 'Tracks center response speeds.',
    },
    {
      name: 'CSAT Score',
      staging: '94.8%',
      formula: 'Avg(rating) of resolved support cases',
      simpleMath: `CSAT = ${frac('&sum; CSATRating<sub>i</sub>', 'CSATRatings<sub>total</sub>')}`,
      mongo: `const csat = await Ticket.aggregate([\n  { $match: { rating: { $exists: true } } },\n  { $group: { _id: null, avgRating: { $avg: '$rating' } } }\n]);`,
      desc: 'Customer satisfaction score for support operations.',
    },
    {
      name: 'First Contact Resolution (FCR)',
      staging: '84.2%',
      formula: '(Resolved with 1 interaction / Total Resolved) * 100',
      simpleMath: `FCR = ${frac('Tickets<sub>single_reply</sub>', 'Tickets<sub>resolved</sub>')} &times; 100%`,
      mongo: `const fcr = await Ticket.countDocuments({ status: 'resolved', interactionCount: 1 });`,
      desc: 'Percentage of support tickets resolved with only a single reply.',
    },
  ];

  // 16. SOS KPIs
  const sosKpis = [
    {
      name: 'Active SOS Feeds',
      staging: '1 Urgent',
      formula: 'Count(SOS alerts with status = active)',
      simpleMath: `SOS<sub>active</sub> = &sum; SOS [status = 'active']`,
      mongo: `const activeSos = await SOS.countDocuments({ status: 'active' });`,
      desc: 'Active emergency distress triggers.',
    },
    {
      name: 'Resolved Incidents',
      staging: '42',
      formula: 'Count(SOS alerts with status = resolved)',
      simpleMath: `SOS<sub>resolved</sub> = &sum; SOS [status = 'resolved']`,
      mongo: `const resolvedIncidents = await SOS.countDocuments({ status: 'resolved' });`,
      desc: 'Safety cases successfully closed.',
    },
    {
      name: 'Avg SLA Response Time',
      staging: '1m 15s',
      formula: 'Avg(respondedAt - createdAt)',
      simpleMath: `SLA<sub>SOS</sub> = ${frac('&sum; (Time<sub>responded</sub> - Time<sub>triggered</sub>)', 'SOS<sub>resolved</sub>')}`,
      mongo: `const avgResponseTime = await SOS.aggregate([\n  { $match: { status: 'resolved' } },\n  { $group: { _id: null, avgTime: { $avg: { $subtract: ['$respondedAt', '$createdAt'] } } } }\n]);`,
      desc: 'Time taken to dispatch assistance or contact customer.',
    },
    {
      name: 'Critical Severity Count',
      staging: '2',
      formula: 'Count(SOS with high severity, status != resolved)',
      simpleMath: `SOS<sub>critical</sub> = &sum; SOS [severity = 'high' &amp; status != 'resolved']`,
      mongo: `const criticalCount = await SOS.countDocuments({ severity: 'high', status: { $ne: 'resolved' } });`,
      desc: 'Urgent security issues.',
    },
    {
      name: 'Safety Incident Rate',
      staging: '0.2%',
      formula: '(SOS Alerts Count / Total Bookings) * 100',
      simpleMath: `Incident Rate = ${frac('SOS<sub>count</sub>', 'Bookings<sub>total</sub>')} &times; 100%`,
      mongo: `const incidents = await SOS.countDocuments({});\nconst bookings = await Booking.countDocuments({});`,
      desc: 'Emergency triggers relative to total cleans executed.',
    },
  ];

  // 17. Reviews KPIs
  const reviewKpis = [
    {
      name: 'Avg Platform Rating',
      staging: '4.85 / 5.0',
      formula: 'Avg(rating) of all reviews',
      simpleMath: `Rating<sub>avg</sub> = ${frac('&sum; Rating<sub>i</sub>', 'Reviews<sub>total</sub>')}`,
      mongo: `const avgRating = await Review.aggregate([\n  { $group: { _id: null, avg: { $avg: '$rating' } } }\n]);`,
      desc: 'Average score of all service reviews.',
    },
    {
      name: 'Total Reviews Submitted',
      staging: '8,421',
      formula: 'Count(Reviews submitted)',
      simpleMath: `Reviews = &sum; Reviews`,
      mongo: 'const totalReviews = await Review.countDocuments({});',
      desc: 'Total historical feedback count.',
    },
    {
      name: 'Positive Reviews',
      staging: '7,842',
      formula: 'Count(Reviews with rating >= 4)',
      simpleMath: `Reviews<sub>positive</sub> = &sum; Reviews [rating &ge; 4]`,
      mongo: `const positiveReviews = await Review.countDocuments({ rating: { $gte: 4 } });`,
      desc: 'Satisfied bookings.',
    },
    {
      name: 'Negative Reviews',
      staging: '124',
      formula: 'Count(Reviews with rating <= 2)',
      simpleMath: `Reviews<sub>negative</sub> = &sum; Reviews [rating &le; 2]`,
      mongo: `const negativeReviews = await Review.countDocuments({ rating: { $lte: 2 } });`,
      desc: 'Dissatisfied bookings. Triggers support ticketing.',
    },
    {
      name: 'Review Escalation Rate',
      staging: '1.5%',
      formula: '(Escalated / Total) * 100',
      simpleMath: `Escalation Rate = ${frac('Reviews<sub>escalated</sub>', 'Reviews<sub>total</sub>')} &times; 100%`,
      mongo: `const escalated = await Review.countDocuments({ isEscalated: true });`,
      desc: 'Percentage of reviews requiring admin escalation.',
    },
    {
      name: 'Feedback Response Rate',
      staging: '98.4%',
      formula: '(Responded Reviews / Reviews with Text) * 100',
      simpleMath: `Response Rate = ${frac('Reviews<sub>responded</sub>', 'Reviews<sub>with_text</sub>')} &times; 100%`,
      mongo: `const responded = await Review.countDocuments({ responseText: { $exists: true } });`,
      desc: 'Percentage of written feedback reviews replied to by support.',
    },
  ];

  // 18. Analytics KPIs
  const analyticsKpis = [
    {
      name: 'Total Monthly Revenue',
      staging: '₹4,82,340',
      formula: 'Sum(totalAmount) of bookings in last 30 days',
      simpleMath: `Revenue<sub>30d</sub> = &sum; R<sub>completed</sub> [30d]`,
      mongo: `const monthlyRevenue = await Booking.aggregate([\n  { $match: { status: 'completed', createdAt: { $gte: monthStart } } },\n  { $group: { _id: null, total: { $sum: '$totalAmount' } } }\n]);`,
      desc: 'Gross revenue trend tracked monthly.',
    },
    {
      name: 'Active Users (Monthly)',
      staging: '8,421',
      formula: 'Count(Users active in last 30 days)',
      simpleMath: `MAU = &sum; Users [Active in 30 days]`,
      mongo: `const activeUsersMonthly = await User.countDocuments({ lastActive: { $gte: thirtyDaysAgo } });`,
      desc: 'Platform monthly active user cohort.',
    },
    {
      name: 'App Conversion Rate',
      staging: '12.8%',
      formula: '(Bookings Completed / App Sessions) * 100',
      simpleMath: `Conversion = ${frac('Bookings<sub>completed</sub>', 'AppSessions')} &times; 100%`,
      mongo: `// Ratio of successful checkout completions against total app opens`,
      desc: 'Efficiency of platform booking funnel.',
    },
    {
      name: 'Retention Month-3',
      staging: '64.2%',
      formula: '(Users Active Month 3 / Cohort Month 1) * 100',
      simpleMath: `Retention<sub>M3</sub> = ${frac('Users<sub>active_M3</sub>', 'Users<sub>cohort_M1</sub>')} &times; 100%`,
      mongo: `// Cohort calculation tracking active user IDs across time intervals`,
      desc: 'Crucial product retention indicator.',
    },
    {
      name: 'Regional User Density',
      staging: 'Bangalore: 3,420',
      formula: 'Count(Users) grouped by city',
      simpleMath: `Density<sub>city</sub> = &sum; Users<sub>city</sub>`,
      mongo: `const regionalDensity = await Booking.aggregate([\n  { $group: { _id: '$city', count: { $sum: 1 } } }\n]);`,
      desc: 'Geographic distribution index.',
    },
    {
      name: 'Revenue by Category',
      staging: 'Deep Clean: ₹2,48,200',
      formula: 'Sum(totalAmount) grouped by service category',
      simpleMath: `Revenue<sub>cat</sub> = &sum; R<sub>cat</sub>`,
      mongo: `const revenueByCat = await Booking.aggregate([\n  { $match: { status: 'completed' } },\n  { $group: { _id: '$category', total: { $sum: '$totalAmount' } } }\n]);`,
      desc: 'Product tier breakdown.',
    },
    {
      name: 'Customer Lifetime Value (LTV)',
      staging: '₹3,450',
      formula: 'Average Revenue per User * Average Customer Lifespan',
      simpleMath: `LTV = AOV &times; Frequency<sub>avg</sub> &times; Lifespan<sub>avg</sub>`,
      mongo: `// Multiplies average user booking volumes by gross platform margin constants`,
      desc: 'Projected net revenue generated by a customer profile over their activity life.',
    },
  ];

  // 19. Partner Analytics KPIs
  const partnerAnalyticsKpis = [
    {
      name: 'Active Partners',
      staging: '842',
      formula: 'Count(Partners active in last 30 days)',
      simpleMath: `Partners<sub>active_30d</sub> = &sum; Partners [status = 'active']`,
      mongo: `const activePartners = await Partner.countDocuments({ status: 'active' });`,
      desc: 'Operational partner pool.',
    },
    {
      name: 'Online Partners (Live)',
      staging: '42',
      formula: 'Count(Partners with status = online)',
      simpleMath: `Partners<sub>online</sub> = &sum; Partners [status = 'online']`,
      mongo: `const onlinePartners = await Partner.countDocuments({ status: 'online' });`,
      desc: 'Live supply ready to receive matches.',
    },
    {
      name: 'Job Acceptance Rate',
      staging: '92.4%',
      formula: '(Jobs Accepted / Total Offered) * 100',
      simpleMath: `Acceptance Rate = ${frac('Jobs<sub>accepted</sub>', 'Jobs<sub>offered</sub>')} &times; 100%`,
      mongo: `// Acceptance rate calculations comparing partner bids against dispatch allocations`,
      desc: 'Partner willingness to accept dispatched jobs.',
    },
    {
      name: 'Avg Partner Payout',
      staging: '₹12,480 / mo',
      formula: 'Total Partner Earnings / Active Partners',
      simpleMath: `Payout<sub>avg</sub> = ${frac('Earnings<sub>partner</sub>', 'Partners<sub>active</sub>')}`,
      mongo: `// Evaluates typical monthly wages calculated for active service partners`,
      desc: 'Measures income satisfaction.',
    },
    {
      name: 'Dispatch Match Success Rate',
      staging: '98.4%',
      formula: '(Matched Jobs / Total Dispatched) * 100',
      simpleMath: `Dispatch Success = ${frac('Jobs<sub>matched</sub>', 'Jobs<sub>dispatched</sub>')} &times; 100%`,
      mongo: `// Compares successful dispatcher matches against general system requests`,
      desc: 'Efficiency of algorithmic matchmaking.',
    },
    {
      name: 'Churn Rate',
      staging: '1.8%',
      formula: '(Partners Lost in Period / Partners Start of Period) * 100',
      simpleMath: `Churn Rate = ${frac('Partners<sub>deactivated</sub>', 'Partners<sub>active_start</sub>')} &times; 100%`,
      mongo: `const deactivated = await Partner.countDocuments({ status: 'inactive', updatedAt: { $gte: monthStart } });`,
      desc: 'Rate at which active cleaners deactivate or leave the platform.',
    },
  ];

  // 20. Booking Analytics KPIs
  const bookingAnalyticsKpis = [
    {
      name: 'Total Bookings',
      staging: '18,421',
      formula: 'Count(Bookings)',
      simpleMath: `Bookings<sub>total</sub> = &sum; Bookings`,
      mongo: 'const totalBookings = await Booking.countDocuments({});',
      desc: 'Total historical bookings.',
    },
    {
      name: 'Completed Bookings',
      staging: '16,842',
      formula: 'Count(Bookings with status = completed)',
      simpleMath: `Bookings<sub>completed</sub> = &sum; Bookings [status = 'completed']`,
      mongo: `const completedBookings = await Booking.countDocuments({ status: 'completed' });`,
      desc: 'Jobs successfully delivered.',
    },
    {
      name: 'Cancelled Bookings',
      staging: '1,482',
      formula: 'Count(Bookings with status = cancelled)',
      simpleMath: `Bookings<sub>cancelled</sub> = &sum; Bookings [status = 'cancelled']`,
      mongo: `const cancelledBookings = await Booking.countDocuments({ status: 'cancelled' });`,
      desc: 'Jobs cancelled before service delivery.',
    },
    {
      name: 'Average Booking Value',
      staging: '₹450',
      formula: 'Avg(totalAmount) of completed bookings',
      simpleMath: `Booking Value<sub>avg</sub> = ${frac('&sum; Amount<sub>i</sub>', 'Bookings<sub>completed</sub>')}`,
      mongo: `const avgValue = await Booking.aggregate([\n  { $group: { _id: null, avg: { $avg: '$totalAmount' } } }\n]);`,
      desc: 'Typical order size.',
    },
    {
      name: 'Match Fulfillment Rate',
      staging: '94.2%',
      formula: '(Completed / Total Requested) * 100',
      simpleMath: `Fulfillment = ${frac('Bookings<sub>completed</sub>', 'Bookings<sub>requested</sub>')} &times; 100%`,
      mongo: `// Ratio of completed bookings to total requested bookings`,
      desc: 'Dispatch network performance index.',
    },
    {
      name: 'Average Assignment Time',
      staging: '1m 45s',
      formula: 'Avg(matchedAt - createdAt)',
      simpleMath: `Assignment Time = ${frac('&sum; (Time<sub>matched</sub> - Time<sub>created</sub>)', 'Bookings<sub>matched</sub>')}`,
      mongo: `const avgAssignmentTime = await Booking.aggregate([\n  { $match: { matchedAt: { $exists: true } } },\n  { $group: { _id: null, avg: { $avg: { $subtract: ['$matchedAt', '$createdAt'] } } } }\n]);`,
      desc: 'Avg duration between checkout and maid allocation.',
    },
    {
      name: 'Repeat Booking Frequency',
      staging: '2.8x',
      formula: 'Total Completed Bookings / Unique Booking Customers',
      simpleMath: `Frequency = ${frac('Bookings<sub>completed</sub>', 'Customers<sub>booking</sub>')}`,
      mongo: `// Ratio of monthly completed bookings against unique ordering customer IDs`,
      desc: 'Average number of cleanings a customer books per billing cycle.',
    },
  ];

  // 21. Geo Heatmap KPIs
  const geoKpis = [
    {
      name: 'Active Demand Hotspots',
      staging: '8 zones',
      formula: 'Count(Zones with active bookings >= 10)',
      simpleMath: `Hotspots = Count(Clusters [Bookings<sub>active</sub> &ge; 10])`,
      mongo: `// Aggregate query grouping active bookings by coordinate cluster neighborhood`,
      desc: 'High demand clusters.',
    },
    {
      name: 'Partner Density Index',
      staging: '1.4',
      formula: 'Active Partners / Active Bookings',
      simpleMath: `Density Index = ${frac('Partners<sub>active</sub>', 'Bookings<sub>active</sub>')}`,
      mongo: `// Ratio of online partner supply against active jobs inside zones`,
      desc: 'Evaluates supply vs demand ratio.',
    },
    {
      name: 'Average Travel Distance',
      staging: '3.4 km',
      formula: 'Avg(distance) of bookings',
      simpleMath: `Distance<sub>avg</sub> = ${frac('&sum; Distance<sub>i</sub>', 'Bookings<sub>completed</sub>')}`,
      mongo: `const avgDistance = await Booking.aggregate([\n  { $match: { status: 'completed' } },\n  { $group: { _id: null, avg: { $avg: '$distance' } } }\n]);`,
      desc: 'Average travel required by partner cleaners to reach jobs.',
    },
    {
      name: 'Surge Multiplier Factor',
      staging: '1.2x avg',
      formula: 'Surge multiplier value in dense zones',
      simpleMath: `Surge = Max(SurgeMultiplier)`,
      mongo: `const surgeFactor = await SurgeSetting.findOne({ type: 'current' });`,
      desc: 'Dynamic price surge modifier.',
    },
    {
      name: 'Peak Surge Demand Factor',
      staging: '1.4x',
      formula: 'Peak Surge Multiplier applied in last 24h',
      simpleMath: `Peak Surge = Max(SurgeMultiplier [24h])`,
      mongo: `const peakSurge = await SurgeSetting.findOne({ type: 'peak' });`,
      desc: 'Max surge rate modifier triggered in active zones.',
    },
  ];

  // 22. Export Data KPIs
  const exportKpis = [
    {
      name: 'Total Exports YTD',
      staging: '282',
      formula: 'Count(Export log records)',
      simpleMath: `Exports = &sum; ExportLogs`,
      mongo: 'const totalExports = await ExportLog.countDocuments({});',
      desc: 'Data export operations triggered by admins.',
    },
    {
      name: 'Pending Exports Queue',
      staging: '1',
      formula: 'Count(Export logs with status = pending)',
      simpleMath: `Queue<sub>pending</sub> = &sum; ExportLogs [status = 'pending']`,
      mongo: `const pendingExports = await ExportLog.countDocuments({ status: 'pending' });`,
      desc: 'Active processing datasets.',
    },
    {
      name: 'Failed Exports Rate',
      staging: '1.4%',
      formula: '(Failed Exports / Total Exports) * 100',
      simpleMath: `Failure Rate = ${frac('Exports<sub>failed</sub>', 'Exports<sub>total</sub>')} &times; 100%`,
      mongo: `const failed = await ExportLog.countDocuments({ status: 'failed' });`,
      desc: 'Data compiler health index.',
    },
    {
      name: 'Export Data Volume',
      staging: '2.8 GB',
      formula: 'Sum(fileSize) of exports',
      simpleMath: `Volume = &sum; FileSize`,
      mongo: `const totalVolume = await ExportLog.aggregate([\n  { $group: { _id: null, total: { $sum: '$fileSize' } } }\n]);`,
      desc: 'Total data compiled and downloaded.',
    },
    {
      name: 'Export Generation Time SLA',
      staging: '4.2s',
      formula: 'Avg(completedAt - createdAt) for exports',
      simpleMath: `Export SLA = ${frac('&sum; (Time<sub>completed</sub> - Time<sub>requested</sub>)', 'Exports<sub>completed</sub>')}`,
      mongo: `const avgSla = await ExportLog.aggregate([\n  { $match: { status: 'completed' } },\n  { $group: { _id: null, avgTime: { $avg: { $subtract: ['$completedAt', '$createdAt'] } } } }\n]);`,
      desc: 'Avg latency from clicking download to CSV file compilation.',
    },
  ];

  // 23. Settings KPIs
  const settingsKpis = [
    {
      name: 'Backup Status Success',
      staging: '100%',
      formula: 'Percentage of successful database backups',
      simpleMath: `Backup Rate = ${frac('Backups<sub>success</sub>', 'Backups<sub>total</sub>')} &times; 100%`,
      mongo: `const backups = await BackupLog.find({}).sort({ createdAt: -1 }).limit(7);`,
      desc: 'System safety index.',
    },
    {
      name: 'System Config Latency',
      staging: '42ms',
      formula: 'Database query response time for configurations',
      simpleMath: `Latency = Time<sub>query_response</sub>`,
      mongo: `const systemConfig = await SystemSetting.findOne({});`,
      desc: 'Config engine database speeds.',
    },
    {
      name: 'Active Webhook Subscriptions',
      staging: '4',
      formula: 'Count(Active webhook endpoints)',
      simpleMath: `Webhooks = &sum; Webhooks [isActive = true]`,
      mongo: `const webhooks = await Webhook.countDocuments({ isActive: true });`,
      desc: 'API event notification endpoints.',
    },
    {
      name: 'Rate Limit Threshold',
      staging: '10,000 req/min',
      formula: 'Maximum allowed API requests per minute',
      simpleMath: `Threshold = RateLimit<sub>limit</sub>`,
      mongo: `const rateLimit = await RateLimitSetting.findOne({});`,
      desc: 'Security thresholds to prevent DDoS.',
    },
    {
      name: 'Webhook Delivery Success Rate',
      staging: '99.8%',
      formula: '(Delivered Webhooks / Total Transmitted) * 100',
      simpleMath: `Delivery Rate = ${frac('Webhooks<sub>delivered</sub>', 'Webhooks<sub>transmitted</sub>')} &times; 100%`,
      mongo: `const deliveryStats = await WebhookLog.aggregate([\n  { $group: { _id: '$status', count: { $sum: 1 } } }\n]);`,
      desc: 'Reliability percentage of platforms outbound REST API hooks.',
    },
  ];

  // 24. Admin Management KPIs
  const adminKpis = [
    {
      name: 'Total Admins',
      staging: '12',
      formula: 'Count(Admin accounts)',
      simpleMath: `Admins = &sum; AdminAccounts`,
      mongo: 'const totalAdmins = await Admin.countDocuments({});',
      desc: 'Number of active administrative credentials.',
    },
    {
      name: 'Active Admins',
      staging: '4 (Last 24h)',
      formula: 'Count(Admins active in last 24h)',
      simpleMath: `Admins<sub>active</sub> = &sum; Admins [lastActive &ge; 24h]`,
      mongo: `const activeAdmins = await Admin.countDocuments({\n  lastActive: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }\n});`,
      desc: 'Administrators logged in today.',
    },
    {
      name: 'Pending Invites',
      staging: '2',
      formula: 'Count(Admin invites with status = pending)',
      simpleMath: `Invites<sub>pending</sub> = &sum; Invites [status = 'pending']`,
      mongo: `const pendingInvites = await AdminInvite.countDocuments({ status: 'pending' });`,
      desc: 'Unredeemed admin invitations.',
    },
    {
      name: 'Security Action Index',
      staging: '100%',
      formula: '(Resolved flags / Total security flags) * 100',
      simpleMath: `Security SLA = ${frac('Flags<sub>resolved</sub>', 'Flags<sub>total</sub>')} &times; 100%`,
      mongo: `// Ratio of solved security reports against historical alerts`,
      desc: 'Measures administrative security SLA.',
    },
    {
      name: 'MFA Activation Rate',
      staging: '100%',
      formula: '(Admins with MFA enabled / Total Admins) * 100',
      simpleMath: `MFA Rate = ${frac('Admins<sub>mfa_enabled</sub>', 'Admins<sub>total</sub>')} &times; 100%`,
      mongo: `const mfaEnabled = await Admin.countDocuments({ mfaEnabled: true });`,
      desc: 'Proportion of administrative profiles protected by multi-factor auth.',
    },
  ];

  // 25. Activity Logs KPIs
  const activityKpis = [
    {
      name: 'Total System Events Today',
      staging: '12,482',
      formula: 'Count(Audit logs created today)',
      simpleMath: `Events = &sum; AuditLogs [Today]`,
      mongo: `const todayEvents = await AuditLog.countDocuments({ createdAt: { $gte: todayStart } });`,
      desc: 'Volume of general administrative events logged.',
    },
    {
      name: 'Security Logs Count',
      staging: '142',
      formula: 'Count(Audit logs with category = security today)',
      simpleMath: `Events<sub>security</sub> = &sum; AuditLogs [category = 'security' &amp; Today]`,
      mongo: `const securityLogs = await AuditLog.countDocuments({ category: 'security', createdAt: { $gte: todayStart } });`,
      desc: 'Security related actions.',
    },
    {
      name: 'System Errors Flagged',
      staging: '8',
      formula: 'Count(Audit logs with level = error today)',
      simpleMath: `Errors = &sum; AuditLogs [level = 'error' &amp; Today]`,
      mongo: `const systemErrors = await AuditLog.countDocuments({ level: 'error', createdAt: { $gte: todayStart } });`,
      desc: 'Server exceptions logged.',
    },
    {
      name: 'Audit Trail Coverage',
      staging: '100%',
      formula: 'Ratio of system actions recorded in audit trail',
      simpleMath: `Coverage = ${frac('Endpoints<sub>logged</sub>', 'Endpoints<sub>total</sub>')} &times; 100%`,
      mongo: `// Percentage of API routes covered by audit middleware logger`,
      desc: 'Safety audit index.',
    },
    {
      name: 'Log Retention Period',
      staging: '90 Days',
      formula: 'Fixed system log retention duration',
      simpleMath: `Retention = 90 Days`,
      mongo: `// Static environment or schema index setting default audit expiry rules`,
      desc: 'Timeframe after which historical audit log collections are purged.',
    },
  ];

  const viewsConfig = [
    {
      key: 'dashboard',
      name: 'Dashboard Overview',
      num: '01',
      path: 'Root > Dashboard',
      kpis: dashboardKpis,
      why: 'Serve as the executive command cockpit, offering a 360° visual review of overall business performance, daily volume trajectory, and system margins.',
      who: 'C-Level Executives, General Managers, and Operations Directors who require instant visibility into systemic efficiency.',
      action:
        'Load this page first thing in the morning to audit growth loops, assess cancellation drops, and identify critical payment failures.',
      logic:
        'If cancellations exceed 3% or refunds spike, managers immediately coordinate with safety and dispatch managers to diagnose partner mismatches.',
    },
    {
      key: 'users',
      name: 'User Management',
      num: '02',
      path: 'Management > Users',
      kpis: usersKpis,
      why: 'Audit customer registrations, review bans/suspensions, verify user profiles, and resolve account blockages.',
      who: 'Customer Support Leads and Risk Compliance Officers.',
      action:
        'Review recently flagged customer accounts, verify telephone verification levels, and unblock accounts after payment disputes.',
      logic:
        'If registration fraud spikes in a zip code, risk officers block new signups from that region pending KYC verification.',
    },
    {
      key: 'maid_partners',
      name: 'Maid Partners',
      num: '03',
      path: 'Management > Maid Partners',
      kpis: maidKpis,
      why: 'Onboard service cleaners, check profile qualifications, verify backgrounds, audit supply feedback, and block low-rated cleaners.',
      who: 'Partner Success Managers and Supply Recruiters.',
      action:
        'Approve new background-check documents, audit low rating reviews, and coordinate training schedules for online maids.',
      logic:
        'If average rating drops below 4.5 stars, partners are automatically placed on probation and routed to retraining.',
    },
    {
      key: 'bookings',
      name: 'Bookings Management',
      num: '05',
      path: 'Management > Bookings',
      kpis: bookingKpis,
      why: 'Track historical and scheduled bookings, execute manual assignment overrides, and inspect customer clean requirements.',
      who: 'Operations Dispatchers and Booking Agents.',
      action:
        'Audit delayed cleaning starts, resolve booking cancellations, and adjust schedules at user request.',
      logic:
        'If a customer requests manual rescheduling inside 2 hours, dispatchers verify partner availability before confirming.',
    },
    {
      key: 'services',
      name: 'Service Management',
      num: '06',
      path: 'Management > Service Management',
      kpis: serviceKpis,
      why: 'Modify cleaning service catalogues, configure base prices, add subcategories, and manage promotional add-on items.',
      who: 'Catalog Managers and Marketing Coordinators.',
      action:
        'Adjust base pricing for deep cleaning, add add-on tasks (like window washing), and update service descriptions.',
      logic:
        'If deep cleaning booking volumes drop by 20%, pricing managers reduce base rates by 5% to stimulate demand.',
    },
    {
      key: 'operations',
      name: 'Operations Center',
      num: '04',
      path: 'Management > Operations',
      kpis: operationsKpis,
      why: 'Manage real-time dispatcher matching queues, resolve dispatch failures, and monitor live fields to avoid schedule overlaps.',
      who: 'Live Dispatch Matchmakers and Shift Supervisors who coordinate field logistics.',
      action:
        'Review the matching queue logs, manually assign un-dispatched booking requests, and call delayed partners.',
      logic:
        'If pending requests pile up beyond a 10-minute wait, dispatchers trigger "surge incentives" or manual matchmaking search protocols.',
    },
    {
      key: 'earnings',
      name: 'Earnings & Payouts',
      num: '07',
      path: 'Finance > Earnings & Payouts',
      kpis: earningsKpis,
      why: 'Manage outstanding wages owed to active maid partners, monitor platform cuts, and execute batch transfers.',
      who: 'Payroll officers, Financial controllers, and Billing accountants.',
      action:
        'Verify pending settlement sums, execute batch payouts, audit transfer statuses, and resolve banking errors.',
      logic:
        'If failed payout statuses exceed 5%, accountants immediately check for bank gateway drops or trigger partner UPI validation sweeps.',
    },
    {
      key: 'transactions',
      name: 'Transactions Auditor',
      num: '08',
      path: 'Finance > Transactions',
      kpis: transactionsKpis,
      why: 'Provide billing audit trails across card, UPI, and bank transfers, search individual reference IDs, and handle transaction-level support.',
      who: 'Customer billing specialists and Finance operations managers.',
      action:
        'Audit individual payment method splits, investigate failed transactions, and modify settlement states during gateway disputes.',
      logic:
        'If transaction failure rates spike above 3%, administrators immediately query stripe status endpoints to bypass gateway downtime.',
    },
    {
      key: 'refunds',
      name: 'Refunds Center',
      num: '09',
      path: 'Finance > Refunds',
      kpis: refundsKpis,
      why: 'Verify cancellation claims, evaluate booking issues, reverse double charges, and audit direct-to-card financial capital leakage.',
      who: 'Customer dispute specialists, Account reviews, and Accounting support.',
      action:
        'Audit refund ticket backlogs, review photo/text evidence submitted by users, and click to approve/deny credits.',
      logic:
        'If a specific partner exceeds a 5% customer refund rate, safety teams automatically block their matching scheduling loops.',
    },
    {
      key: 'wallet',
      name: 'Wallet & Credits',
      num: '10',
      path: 'Finance > Wallet & Credits',
      kpis: walletKpis,
      why: 'Manage customer deposited credit balances, award promotional goodwill values, monitor financial liabilities, and freeze accounts due to promo abuse.',
      who: 'Customer Experience (CX) Leads, Fraud Analysts, and Account Managers.',
      action:
        'Audit manual credit allocations, issue goodwill store credit adjustments, lock suspicious wallets, and track ledger logs.',
      logic:
        'If un-redeemed store credit balances spike, account teams trigger customer reservation campaigns to accelerate credit-to-booking conversions.',
    },
    {
      key: 'campaigns',
      name: 'Marketing Campaigns',
      num: '11',
      path: 'Marketing > Campaigns',
      kpis: campaignKpis,
      why: 'Track marketing campaign performances, verify acquisition channels, review discount budget limits, and audit CAC.',
      who: 'Growth Marketers and Product Managers.',
      action:
        'Adjust marketing budget limits, issue campaign codes, and disable underperforming advertisement links.',
      logic:
        'If CAC of a campaign channel exceeds ₹250, marketers pause ad spend and redirect budget to refer-a-friend channels.',
    },
    {
      key: 'promotions',
      name: 'Promotions & Coupons',
      num: '12',
      path: 'Marketing > Promotions',
      kpis: promoKpis,
      why: 'Manage discount coupons, edit percentage/flat rebate values, limit redemption caps, and verify promotion ROI.',
      who: 'Marketing Leads and E-commerce Analysts.',
      action:
        'Create discount coupons, monitor redemption counts, and analyze average order value impact of active promotions.',
      logic:
        'If coupons trigger average order value spikes above 15%, marketers increase the coupon usage cap per user.',
    },
    {
      key: 'content',
      name: 'App Content Management',
      num: '13',
      path: 'Marketing > App Content',
      kpis: contentKpis,
      why: 'Configure application text screens, publish FAQ entries, coordinate marketing banners, and verify privacy policies.',
      who: 'Content Managers and Customer Support Directors.',
      action:
        'Add FAQ solutions for booking issues, update app home-screen banners, and upload legal terms revisions.',
      logic:
        'If support tickets regarding "how to reschedule" increase, support teams pin a step-by-step FAQ banner on the client home screen.',
    },
    {
      key: 'referrals',
      name: 'Referral System',
      num: '14',
      path: 'Marketing > Referrals',
      kpis: referralKpis,
      why: 'Monitor organic customer acquisition, verify referral reward transactions, and audit for systemic code exploitation.',
      who: 'Fraud Analysts and Product Growth Leads.',
      action:
        'Investigate accounts triggering excessive referral bonuses, audit refer-a-friend signups, and clear verified rewards.',
      logic:
        'If multiple signups from the same IP share a referral link, fraud analysts automatically flag the account for manual audit.',
    },
    {
      key: 'support',
      name: 'Support Tickets',
      num: '15',
      path: 'Support & Safety > Support ticket',
      kpis: supportKpis,
      why: 'Manage user complaints, resolve booking issues, track CSAT trends, and ensure administrative support SLA is met.',
      who: 'Support Specialists and Helpdesk Managers.',
      action:
        'Resolve open support tickets, reply to customer billing inquiries, and tag critical complaints for development teams.',
      logic:
        'If first response SLA exceeds 10 minutes, helpdesk managers allocate emergency agents to clear the support backlog.',
    },
    {
      key: 'sos',
      name: 'Safety & SOS Incident Center',
      num: '16',
      path: 'Support & Safety > SOS & Incidents',
      kpis: sosKpis,
      why: 'Critical life-safety center created to respond instantly to active partner/customer emergency panic button triggers in the field.',
      who: 'High-SLA Safety Response Teams and Physical Security Operators.',
      action:
        'Monitor flashing red distress grids, telephone users in distress, coordinate with local authorities, and log resolutions.',
      logic:
        'If an active SOS alert flashes, operators have exactly 30 seconds to initiate phone protocols. Failures trigger immediate supervisor alarms.',
    },
    {
      key: 'reviews',
      name: 'Review & Rating Auditor',
      num: '17',
      path: 'Support & Safety > Review & Rating',
      kpis: reviewKpis,
      why: 'Monitor platform review scores, identify low performance ratings, inspect comment logs, and issue goodwill refunds.',
      who: 'Quality Assurance Teams and Support Supervisors.',
      action:
        'Analyze negative review text, contact customers complaining about services, and flag low-rated partners.',
      logic:
        'If a cleaning partner receives a 1-star review claiming damaged items, QA locks their profile pending security reviews.',
    },
    {
      key: 'analytics',
      name: 'Revenue Analytics',
      num: '18',
      path: 'Reports > Analytics',
      kpis: analyticsKpis,
      why: 'Identify monthly revenue trajectories, track seasonal demand scaling, analyze customer retention cohorts, and define geo expansions.',
      who: 'Growth Marketers, Financial Analysts, and Business Development Directors.',
      action:
        'Filter cohort ranges, review regional city performance graphs, and assess service category popularity splits.',
      logic:
        'If Month-3 cohort retention drops below 50%, the growth team initiates push notification loyalty vouchers or discount campaigns.',
    },
    {
      key: 'partner_analytics',
      name: 'Partner Analytics',
      num: '19',
      path: 'Reports > Partner Analytics',
      kpis: partnerAnalyticsKpis,
      why: 'Track partner acceptance ratios, evaluate active workforce sizes, verify payout levels, and optimize dispatch parameters.',
      who: 'Operations Supervisors and Supply Analysts.',
      action:
        'Analyze daily acceptance trends, monitor online partner sizes, and identify geographical dispatch bottlenecks.',
      logic:
        'If acceptance rates drop below 80% in Chennai, operations increase partner booking commission cuts by 5.',
    },
    {
      key: 'booking_analytics',
      name: 'Booking Analytics',
      num: '20',
      path: 'Reports > Booking Analytics',
      kpis: bookingAnalyticsKpis,
      why: 'Audit general booking trends, compare scheduled vs instant bookings, inspect cancellation metrics, and verify fulfillment rates.',
      who: 'Business Analysts and Operations Directors.',
      action:
        'Generate weekly volume files, compare scheduled booking fulfillment times, and review average assignment speeds.',
      logic:
        'If assignment times exceed 5 minutes for instant bookings, operations alter candidate queue timeouts.',
    },
    {
      key: 'geo_heatmap',
      name: 'Geographical Demand Heatmap',
      num: '21',
      path: 'Reports > Geo Heatmap',
      kpis: geoKpis,
      why: 'Track live geographical booking hotspots, verify supply location density, and activate surge configurations to balance demand.',
      who: 'Supply Analysts and Dispatch Logistics Managers.',
      action:
        'Review coordinate density circles, identify unserved neighborhood zones, and toggle surge pricing maps.',
      logic:
        'If booking requests exceed partner density in Bangalore by 2.0x, surge multiplier maps trigger a 1.3x price multiplier.',
    },
    {
      key: 'export_data',
      name: 'Data Export Portal',
      num: '22',
      path: 'Reports > Export Data',
      kpis: exportKpis,
      why: 'Compile CSV and Excel spreadsheets of transactions, partners, and bookings, and audit historical download actions.',
      who: 'Data Analysts, Financial Controllers, and Security Audits.',
      action:
        'Initiate batch downloads of monthly ledger details, verify export formats, and approve data requests.',
      logic:
        'If non-admin profiles attempt custom data exports of customer phone directories, security locks access.',
    },
    {
      key: 'settings',
      name: 'System Settings',
      num: '23',
      path: 'System > Settings',
      kpis: settingsKpis,
      why: 'Configure general booking limits, edit API integration keys, verify webhook configs, and review database backups.',
      who: 'System Administrators and DevOps Engineers.',
      action:
        'Configure client rate limits, replace Stripe webhook keys, and verify nightly database backup logs.',
      logic:
        'If database backup logs record failures, DevOps administrators initiate secondary manual cluster dumps.',
    },
    {
      key: 'admin_management',
      name: 'Admin Account Management',
      num: '24',
      path: 'System > Admin management',
      kpis: adminKpis,
      why: 'Invite new administrators, manage account roles (Super Admin, Editor, Billing), and audit admin login activities.',
      who: 'Security Directors and Super Administrators.',
      action:
        'Issue admin email invitation tokens, modify account access permissions, and revoke keys for deactivated personnel.',
      logic:
        'If admin logins are recorded from unauthorized countries, security teams block the credentials and force MFA resets.',
    },
    {
      key: 'activity_logs',
      name: 'System Activity & Audit Logs',
      num: '25',
      path: 'System > Activity Logs',
      kpis: activityKpis,
      why: 'Main security audit log. Stores timestamped action trails for all administrative database modifications to ensure accountability.',
      who: 'Compliance Officers and Security Directors.',
      action:
        'Search log trails for specific changes, investigate failed login attempts, and compile compliance files.',
      logic:
        'If multiple failed admin logins are logged on an account within 2 minutes, security locks the user account.',
    },
  ];

  let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zaffabit Admin Panel — KPI & Operational Blueprint Directory</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #6c5ce7;
      --primary-light: #8f82f3;
      --bg-dark: #0f1431;
      --bg-deep: #070910;
      --bg-body: #f8fafc;
      --card-border: #e2e8f0;
      --slate-800: #1e293b;
      --slate-600: #475569;
      --slate-400: #94a3b8;
      --green: #10b981;
      --red: #ef4444;
      --purple: #8b5cf6;
      --teal: #14b8a6;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-body);
      color: var(--slate-800);
      line-height: 1.5;
      padding: 0;
      margin: 0;
    }

    h1, h2, h3, h4, h5, h6 {
      font-family: 'Outfit', sans-serif;
      font-weight: 700;
    }

    /* Print styling rules */
    @media print {
      body {
        background-color: #ffffff;
      }
      .page-break {
        page-break-before: always;
      }
      .page-container {
        border: none !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding: 8mm 8mm !important;
        width: 100% !important;
        max-width: 100% !important;
      }
      .screenshot-container {
        border-color: #cbd5e1 !important;
      }
      code {
        background-color: #f1f5f9 !important;
        border-color: #cbd5e1 !important;
      }
      .equation-box {
        border-left: 3px solid var(--primary) !important;
      }
    }

    /* Document Wrapper */
    .page-container {
      background-color: #ffffff;
      max-width: 800px;
      margin: 30px auto;
      padding: 20mm;
      box-shadow: 0 10px 25px rgba(0,0,0,0.05);
      border: 1px solid #e2e8f0;
      position: relative;
    }

    /* Cover Page styling */
    .cover-container {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 257mm; /* Full page A4 minus margins approx */
      padding: 40px 20px;
    }

    .cover-header {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .cover-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background-color: var(--primary);
      color: #ffffff;
      font-size: 24px;
      font-weight: 800;
      font-family: 'Outfit', sans-serif;
    }

    .cover-subtitle {
      text-transform: uppercase;
      font-size: 11px;
      font-weight: 800;
      color: var(--slate-400);
      letter-spacing: 2px;
      margin-top: 2px;
    }

    .cover-title-section {
      margin-top: 100px;
    }

    .cover-title {
      font-size: 38px;
      line-height: 1.15;
      color: var(--bg-dark);
      margin-bottom: 20px;
    }

    .cover-divider {
      width: 80px;
      height: 5px;
      background-color: var(--primary);
      border-radius: 3px;
      margin-bottom: 30px;
    }

    .cover-desc {
      font-size: 15px;
      color: var(--slate-600);
      max-width: 550px;
    }

    .cover-meta {
      border-top: 1px solid var(--card-border);
      padding-top: 30px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    .meta-item {
      font-size: 12px;
    }

    .meta-label {
      color: var(--slate-400);
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 1px;
      margin-bottom: 5px;
    }

    .meta-val {
      font-weight: 600;
      color: var(--slate-800);
    }

    /* Screen Page header */
    .screen-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--card-border);
      padding-bottom: 12px;
      margin-bottom: 20px;
    }

    .screen-num {
      font-size: 13px;
      text-transform: uppercase;
      font-weight: 800;
      color: var(--primary);
      letter-spacing: 1.5px;
    }

    .screen-title {
      font-size: 22px;
      color: var(--bg-dark);
      margin-top: 4px;
    }

    .screen-path {
      font-size: 11px;
      color: var(--slate-400);
      background-color: #f1f5f9;
      padding: 3px 8px;
      border-radius: 5px;
      font-weight: 600;
      font-family: 'Inter', sans-serif;
    }

    /* Screenshot container styling */
    .screenshot-container {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.04);
      margin-bottom: 24px;
      background-color: #f1f5f9;
    }

    .screenshot-img {
      width: 100%;
      display: block;
    }

    /* Operational blueprint block */
    .blueprint-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
      background-color: #f8fafc;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #f1f5f9;
    }

    .blueprint-item h4 {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--slate-400);
      letter-spacing: 1px;
      margin-bottom: 4px;
    }

    .blueprint-item p {
      font-size: 12px;
      color: var(--slate-800);
      font-weight: 500;
      line-height: 1.4;
    }

    /* KPI table styling */
    .kpi-section-title {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--slate-400);
      margin-bottom: 12px;
      border-left: 3px solid var(--primary);
      padding-left: 8px;
    }

    .kpi-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }

    .kpi-table th {
      background-color: #f1f5f9;
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--slate-600);
      padding: 8px 12px;
      border-bottom: 2px solid var(--card-border);
    }

    .kpi-table td {
      font-size: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }

    .kpi-table tr:last-child td {
      border-bottom: none;
    }

    .kpi-name {
      font-weight: 700;
      color: var(--slate-800);
    }

    .kpi-value {
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
      color: var(--primary);
      white-space: nowrap;
    }

    .equation-box {
      background-color: #f8fafc;
      padding: 6px 10px;
      border-radius: 6px;
      border-left: 2px solid var(--primary);
      font-family: monospace;
      font-size: 10.5px;
      color: #0f172a;
      overflow-x: auto;
      margin-top: 4px;
    }

    .kpi-desc {
      color: var(--slate-600);
      font-size: 11.5px;
      margin-top: 4px;
    }

    /* Simple Math notation styling */
    .math-expr {
      font-family: 'Outfit', sans-serif;
      font-size: 13.5px;
      background-color: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 6px 12px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #0f172a;
      margin-top: 5px;
      margin-bottom: 5px;
      font-weight: 600;
    }

    .math-fraction {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      vertical-align: middle;
      padding: 0 4px;
    }

    .fraction-numerator {
      border-bottom: 1.5px solid #0f172a;
      padding-bottom: 1px;
      text-align: center;
      font-size: 11px;
      line-height: 1.1;
    }

    .fraction-denominator {
      padding-top: 1px;
      text-align: center;
      font-size: 11px;
      line-height: 1.1;
    }

    /* Footer pagination */
    .page-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 30px;
      padding-top: 10px;
      border-top: 1px solid #f1f5f9;
      font-size: 10px;
      color: var(--slate-400);
      font-weight: 600;
    }

    /* Table of contents page */
    .toc-title {
      font-size: 26px;
      color: var(--bg-dark);
      margin-bottom: 30px;
      border-bottom: 3px solid var(--primary);
      padding-bottom: 10px;
      width: fit-content;
    }

    .toc-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px 40px;
      margin-bottom: 40px;
    }

    .toc-item {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 500;
      border-bottom: 1px dotted var(--card-border);
      padding-bottom: 4px;
    }

    .toc-name {
      color: var(--slate-800);
    }

    .toc-page {
      color: var(--primary);
      font-weight: 700;
    }

    /* Code style block */
    pre {
      margin: 0;
    }
  </style>
</head>
<body>

  <!-- ================= COVER PAGE ================= -->
  <div class="page-container">
    <div class="cover-container">
      <div class="cover-header">
        <div class="cover-logo">Z</div>
        <div>
          <h3 style="font-size: 16px; color: var(--bg-dark); font-family: 'Outfit';">Zafabit Technologies</h3>
          <p class="cover-subtitle">Enterprise Suite</p>
        </div>
      </div>

      <div class="cover-title-section">
        <div class="cover-divider"></div>
        <h1 class="cover-title">Admin Panel KPI &amp; Operational Blueprint Directory</h1>
        <p class="cover-desc">
          A fully comprehensive operational, mathematical, and technical directory documenting all Key Performance Indicators configured in the Zafabit Admin Panel and their Express/Mongoose backend calculations.
        </p>
      </div>

      <div class="cover-meta">
        <div class="meta-item">
          <p class="meta-label">Prepared For</p>
          <p class="meta-val">Operations &amp; Engineering Teams</p>
        </div>
        <div class="meta-item">
          <p class="meta-label">Document Version</p>
          <p class="meta-val">v2.1 (Expanded Math &amp; Data)</p>
        </div>
        <div class="meta-item">
          <p class="meta-label">Date of Issue</p>
          <p class="meta-val">June 10, 2026</p>
        </div>
        <div class="meta-item">
          <p class="meta-label">Active Screens</p>
          <p class="meta-val">25 Admin Views</p>
        </div>
      </div>
    </div>
  </div>

  <!-- ================= TABLE OF CONTENTS ================= -->
  <div class="page-container page-break">
    <h2 class="toc-title">Table of Contents</h2>
    <div class="toc-grid">
`;

  // Render Table of Contents items
  for (let i = 0; i < viewsConfig.length; i++) {
    const vc = viewsConfig[i];
    const pageNum = i + 3; // Cover is page 1, TOC is page 2, views start on page 3
    htmlContent += `
      <div class="toc-item">
        <span class="toc-name">${vc.num}. ${vc.name}</span>
        <span class="toc-page">Page ${pageNum}</span>
      </div>
    `;
  }

  htmlContent += `
    </div>
    <div class="blueprint-grid" style="margin-top: 60px; grid-template-columns: 1fr;">
      <div class="blueprint-item">
        <h4>Directory Overview &amp; Alignment Statement</h4>
        <p style="font-size: 13px; line-height: 1.6; color: var(--slate-600);">
          This document serves as the single source of truth for administrative KPIs on the Zafabit platform. 
          By aligning each frontend KPI widget with its exact mathematical logic, algebraic notation, and Mongoose backend aggregation query, 
          engineering teams can verify that dashboard analytics match underlying ledger database states with 100% accuracy.
        </p>
      </div>
    </div>
    <div class="page-footer">
      <span>Zafabit Enterprise Admin Suite</span>
      <span>Page 2</span>
    </div>
  </div>
`;

  // Render each view page
  for (let i = 0; i < viewsConfig.length; i++) {
    const vc = viewsConfig[i];
    const pageNum = i + 3;
    const base64Img = imageBase64[vc.key] || '';

    htmlContent += `
  <!-- ================= ${vc.name.toUpperCase()} ================= -->
  <div class="page-container page-break">
    <div class="screen-header">
      <div>
        <span class="screen-num">Screen ${vc.num} of 25</span>
        <h2 class="screen-title">${vc.name}</h2>
      </div>
      <span class="screen-path">${vc.path}</span>
    </div>

    <!-- Screenshot -->
    <div class="screenshot-container">
      ${base64Img ? `<img src="${base64Img}" class="screenshot-img" alt="${vc.name} Screenshot">` : `<div style="padding: 100px; text-align: center; color: var(--slate-400);">Screenshot Missing</div>`}
    </div>

    <!-- Operational Blueprint -->
    <div class="blueprint-grid">
      <div class="blueprint-item">
        <h4>The "Why" (Purpose)</h4>
        <p>${vc.why}</p>
      </div>
      <div class="blueprint-item">
        <h4>The "Who" (Primary Operator)</h4>
        <p>${vc.who}</p>
      </div>
      <div class="blueprint-item" style="grid-column: span 2; margin-top: 10px;">
        <h4>Daily Action &amp; Decisions</h4>
        <p><strong>Actions:</strong> ${vc.action}</p>
        <p style="margin-top: 5px;"><strong>Decision Logic:</strong> ${vc.logic}</p>
      </div>
    </div>

    <!-- KPI Table -->
    <h3 class="kpi-section-title">Configured Key Performance Indicators</h3>
    <table class="kpi-table">
      <thead>
        <tr>
          <th style="width: 25%;">KPI Metric &amp; Target</th>
          <th style="width: 75%;">Mathematical Equations &amp; Backend Sync Code</th>
        </tr>
      </thead>
      <tbody>
`;

    for (const kpi of vc.kpis) {
      htmlContent += `
        <tr>
          <td>
            <div class="kpi-name">${kpi.name}</div>
            <div class="kpi-value">${kpi.staging}</div>
          </td>
          <td>
            <div style="margin-bottom: 8px;">
              <strong>Algebraic Formula:</strong><br>
              <span class="math-expr">${kpi.simpleMath}</span>
            </div>
            <div style="margin-bottom: 4px;"><strong>Technical Definition:</strong> <code>${kpi.formula}</code></div>
            <div class="kpi-desc"><strong>Operational Interpretation:</strong> ${kpi.desc}</div>
            <div class="equation-box"><pre>${kpi.mongo}</pre></div>
          </td>
        </tr>
      `;
    }

    htmlContent += `
      </tbody>
    </table>

    <div class="page-footer">
      <span>Zafabit Enterprise Admin Suite</span>
      <span>Page ${pageNum}</span>
    </div>
  </div>
`;
  }

  htmlContent += `
</body>
</html>
`;

  // Write HTML file to disk
  const htmlPath = path.join(artifactsDir, 'admin_panel_kpi_directory.html');
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  console.log(`✅ HTML directory compiled successfully: ${htmlPath}`);

  // Compile PDF via Puppeteer
  const pdfPath = path.join(artifactsDir, 'admin_panel_kpi_directory.pdf');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  console.log(`Launching Google Chrome for PDF printing: ${chromePath}`);

  try {
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    console.log('Rendering content in PDF environment...');
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    console.log('Generating A4 PDF...');
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
    console.log(`🚀 Comprehensive PDF Report successfully compiled: ${pdfPath}`);
  } catch (err) {
    console.error('Failed to compile PDF:', err);
    process.exit(1);
  }
}

main();
