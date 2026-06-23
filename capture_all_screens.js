const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function main() {
  console.log('Initiating Zaffabit Admin Panel Screenshot Capture...');

  const zaffabitDir = path.resolve(__dirname, '..', 'zaffabit');
  const screenshotsDir = path.join(zaffabitDir, 'artifacts', 'screenshots');

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    console.log(`Created screenshots directory at: ${screenshotsDir}`);
  }

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  console.log(`Using Chrome binary from: ${chromePath}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to local dev server http://localhost:5173...');
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (err) {
    console.error(
      'Failed to load http://localhost:5173. Make sure the Vite dev server is running.',
    );
    console.error(err);
    await browser.close();
    process.exit(1);
  }

  // List of views to capture
  const screens = [
    { label: 'Dashboard', filename: '01_dashboard.png' },
    { label: 'Users', filename: '02_users.png' },
    { label: 'Maid Partners', filename: '03_maid_partners.png' },
    { label: 'Operations', filename: '04_operations.png' },
    { label: 'Bookings', filename: '05_bookings.png' },
    { label: 'Service Management', filename: '06_services.png' },
    { label: 'Earnings & Payouts', filename: '07_earnings.png' },
    { label: 'Transactions', filename: '08_transactions.png' },
    { label: 'Refunds', filename: '09_refunds.png' },
    { label: 'Wallet & Credits', filename: '10_wallet.png' },
    { label: 'Campaigns', filename: '11_campaigns.png' },
    { label: 'Promotions', filename: '12_promotions.png' },
    { label: 'App Content', filename: '13_content.png' },
    { label: 'Referrals', filename: '14_referrals.png' },
    { label: 'Support ticket', filename: '15_support.png' },
    { label: 'SOS & Incidents', filename: '16_sos.png' },
    { label: 'Review & Rating', filename: '17_reviews.png' },
    { label: 'Analytics', filename: '18_analytics.png' },
    { label: 'Partner Analytics', filename: '19_partner_analytics.png' },
    { label: 'Booking Analytics', filename: '20_booking_analytics.png' },
    { label: 'Geo Heatmap', filename: '21_geo_heatmap.png' },
    { label: 'Export Data', filename: '22_export_data.png' },
    { label: 'Settings', filename: '23_settings.png' },
    { label: 'Admin management', filename: '24_admin_management.png' },
    { label: 'Activity Logs', filename: '25_activity_logs.png' },
  ];

  for (let i = 0; i < screens.length; i++) {
    const screen = screens[i];
    console.log(`[${i + 1}/${screens.length}] Capturing: ${screen.label}...`);

    try {
      // Find button in the sidebar that contains the text
      const clicked = await page.evaluate(async (labelText) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const targetBtn = buttons.find((btn) => {
          const text = btn.textContent || '';
          return text.trim().toLowerCase().includes(labelText.toLowerCase());
        });
        if (targetBtn) {
          targetBtn.click();
          return true;
        }
        return false;
      }, screen.label);

      if (!clicked) {
        console.warn(`⚠️ Warning: Could not find button for label: "${screen.label}"`);
      }

      // Wait for the view transition and potential data fetches
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Take screenshot
      const outputPath = path.join(screenshotsDir, screen.filename);
      await page.screenshot({ path: outputPath, fullPage: false });
      console.log(`✅ Saved screenshot to ${outputPath}`);
    } catch (error) {
      console.error(`❌ Failed to capture ${screen.label}:`, error);
    }
  }

  await browser.close();
  console.log('All screenshots captured successfully!');
}

main();
