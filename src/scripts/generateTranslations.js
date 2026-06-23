const fs = require('fs');
const path = require('path');
const { translateText } = require('../utils/translate');

// Export translations from locales.js if not already done, or read the file
const LOCALES_PATH = path.join(__dirname, '../utils/locales.js');

function parseExistingLocales() {
  const content = fs.readFileSync(LOCALES_PATH, 'utf8');
  // Match the translations object block
  const startIdx = content.indexOf('const translations = {');
  if (startIdx === -1) {
    throw new Error('Could not find translations object in locales.js');
  }

  // A simple way to get the object is to require a temporary modified version, or evaluate it safely
  // Let's create a temporary file that exports the translations object
  const tempPath = path.join(__dirname, 'temp_locales.js');
  let tempContent = content.replace('module.exports = {', 'module.exports = {\n  translations,\n');
  fs.writeFileSync(tempPath, tempContent, 'utf8');
  const { translations } = require(tempPath);
  fs.unlinkSync(tempPath);
  return translations;
}

function scanForMessages() {
  const directories = [
    path.join(__dirname, '../controllers'),
    path.join(__dirname, '../middleware'),
    path.join(__dirname, '../utils'),
    path.join(__dirname, '../app.js'),
  ];

  const messages = new Set();
  const sendResponseRegex = /sendResponse\s*\(\s*res\s*,\s*[^,]+,\s*(['"`])((?:\\.|[^\\])*?)\1/g;
  const sendErrorRegex = /sendError\s*\(\s*res\s*,\s*[^,]+,\s*(['"`])((?:\\.|[^\\])*?)\1/g;

  function scanFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(filePath);
      for (const file of files) {
        scanFile(path.join(filePath, file));
      }
    } else if (stat.isFile() && filePath.endsWith('.js')) {
      const content = fs.readFileSync(filePath, 'utf8');
      let match;

      // Reset regex state
      sendResponseRegex.lastIndex = 0;
      sendErrorRegex.lastIndex = 0;

      while ((match = sendResponseRegex.exec(content)) !== null) {
        const msg = match[2].trim();
        if (msg && !msg.startsWith('$') && !msg.includes('${')) {
          messages.add(msg);
        }
      }

      while ((match = sendErrorRegex.exec(content)) !== null) {
        const msg = match[2].trim();
        if (msg && !msg.startsWith('$') && !msg.includes('${')) {
          messages.add(msg);
        }
      }
    }
  }

  for (const dir of directories) {
    scanFile(dir);
  }

  return Array.from(messages);
}

async function run() {
  console.log('--- Starting Translation Generator ---');

  // 1. Parse existing locales
  const existing = parseExistingLocales();
  console.log(`Loaded existing translations. Current counts:`);
  console.log(`  Malayalam (ml): ${Object.keys(existing.ml || {}).length}`);
  console.log(`  Tamil (ta): ${Object.keys(existing.ta || {}).length}`);
  console.log(`  Hindi (hi): ${Object.keys(existing.hi || {}).length}`);

  // 2. Scan controllers for messages
  const scanned = scanForMessages();
  console.log(`Scanned codebase. Found ${scanned.length} unique API response string literals.`);

  // 3. Find untranslated messages
  const untranslated = scanned.filter((msg) => {
    return !existing.ml[msg] || !existing.ta[msg] || !existing.hi[msg];
  });
  console.log(`Found ${untranslated.length} untranslated messages.`);

  if (untranslated.length === 0) {
    console.log('All scanned messages are already translated!');
    return;
  }

  // 4. Translate untranslated messages
  console.log(
    'Translating missing messages (this uses free Google Translate and may take a moment)...',
  );

  const mlNew = { ...existing.ml };
  const taNew = { ...existing.ta };
  const hiNew = { ...existing.hi };

  let count = 0;
  for (const msg of untranslated) {
    count++;
    try {
      console.log(`[${count}/${untranslated.length}] Translating: "${msg}"`);

      if (!mlNew[msg]) {
        mlNew[msg] = await translateText(msg, 'ml');
      }
      if (!taNew[msg]) {
        taNew[msg] = await translateText(msg, 'ta');
      }
      if (!hiNew[msg]) {
        hiNew[msg] = await translateText(msg, 'hi');
      }
    } catch (err) {
      console.error(`Failed to translate "${msg}":`, err.message);
    }
  }

  // 5. Write back to locales.js
  const newContent = `/**
 * Centralized Dictionary for Backend API Responses
 * Auto-generated and updated by src/scripts/generateTranslations.js
 */
const translations = {
  // English (Default fallback)
  en: {},

  // Malayalam
  ml: ${JSON.stringify(mlNew, null, 4)},

  // Tamil
  ta: ${JSON.stringify(taNew, null, 4)},
  
  // Hindi
  hi: ${JSON.stringify(hiNew, null, 4)}
};

/**
 * Translates a given English string to the requested locale.
 * Falls back to English if the locale or translation is not found.
 * 
 * @param {String} message - The original English message
 * @param {String} locale - The requested language code (e.g., 'en', 'ml')
 * @returns {String} - The translated message
 */
const translateMessage = (message, locale) => {
  if (!message) return message;
  
  // Standardize locale to lowercase
  const targetLocale = (locale || 'en').toLowerCase();

  // If translation exists, return it; otherwise return original message
  if (translations[targetLocale] && translations[targetLocale][message]) {
    return translations[targetLocale][message];
  }

  return message;
};

module.exports = {
  translateMessage,
  translations
};
`;

  fs.writeFileSync(LOCALES_PATH, newContent, 'utf8');
  console.log('Successfully updated locales.js with all translations!');
  console.log(`New counts:`);
  console.log(`  Malayalam (ml): ${Object.keys(mlNew).length}`);
  console.log(`  Tamil (ta): ${Object.keys(taNew).length}`);
  console.log(`  Hindi (hi): ${Object.keys(hiNew).length}`);
}

run().catch(console.error);
