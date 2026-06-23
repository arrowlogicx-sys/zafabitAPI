const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function main() {
  console.log('Initiating KPI HTML to PDF conversion...');

  const artifactsDir = path.join(__dirname, 'artifacts');
  const htmlPath = path.join(artifactsDir, 'admin_panel_kpi_api_documentation.html');
  const pdfPath = path.join(artifactsDir, 'admin_panel_kpi_api_documentation.pdf');

  if (!fs.existsSync(htmlPath)) {
    console.error(`Error: Source HTML file not found at ${htmlPath}`);
    process.exit(1);
  }

  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Launching the macOS Google Chrome application directly to bypass local binary permissions
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  console.log(`Launching Google Chrome from: ${chromePath}`);

  try {
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    console.log('Browser launched successfully. Rendering KPI document...');
    const page = await browser.newPage();

    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    console.log('Generating A4 PDF sheet...');
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        bottom: '20mm',
        left: '15mm',
        right: '15mm',
      },
    });

    await browser.close();
    console.log(`KPI PDF compiled successfully! Saved at: ${pdfPath}`);
  } catch (error) {
    console.error('Failed to convert HTML to PDF:', error);
    process.exit(1);
  }
}

main();
