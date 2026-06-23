/**
 * Backfill translations for all existing documents that are missing them.
 * Run once with: node scripts/backfill_translations.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Service = require('../src/models/Service');
const { HeroBanner, SplashContent, FeaturedService } = require('../src/models/AppContent');
const {
  translateService,
  translateBanner,
  translateSplash,
  translateFeaturedService,
} = require('../src/utils/translate');

async function backfill() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // ── Services ──────────────────────────────────────────────
  const services = await Service.find({});
  console.log(`\n🔄 Processing ${services.length} services...`);
  for (const svc of services) {
    if (svc.translations && svc.translations.name) {
      console.log(`  ⏭  Skipped (already has translations): ${svc.name}`);
      continue;
    }
    try {
      const translations = await translateService(svc);
      if (translations) {
        svc.translations = translations;
        svc.markModified('translations');
        await svc.save();
        console.log(`  ✅ Translated: ${svc.name}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${svc.name} —`, err.message);
    }
  }

  // ── Hero Banners ───────────────────────────────────────────
  const banners = await HeroBanner.find({});
  console.log(`\n🔄 Processing ${banners.length} banners...`);
  for (const b of banners) {
    if (b.translations && b.translations.title) {
      console.log(`  ⏭  Skipped: ${b.title}`);
      continue;
    }
    try {
      const translations = await translateBanner(b);
      if (translations) {
        b.translations = translations;
        b.markModified('translations');
        await b.save();
        console.log(`  ✅ Translated: ${b.title}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${b.title} —`, err.message);
    }
  }

  // ── Splash Content ─────────────────────────────────────────
  const splashes = await SplashContent.find({});
  console.log(`\n🔄 Processing ${splashes.length} splash items...`);
  for (const s of splashes) {
    if (s.translations && s.translations.title) {
      console.log(`  ⏭  Skipped: ${s.title}`);
      continue;
    }
    try {
      const translations = await translateSplash(s);
      if (translations) {
        s.translations = translations;
        s.markModified('translations');
        await s.save();
        console.log(`  ✅ Translated: ${s.title}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${s.title} —`, err.message);
    }
  }

  // ── Featured Services ──────────────────────────────────────
  const featured = await FeaturedService.find({});
  console.log(`\n🔄 Processing ${featured.length} featured services...`);
  for (const f of featured) {
    if (f.translations && f.translations.label) {
      console.log(`  ⏭  Skipped: ${f.label}`);
      continue;
    }
    try {
      const translations = await translateFeaturedService(f);
      if (translations) {
        f.translations = translations;
        f.markModified('translations');
        await f.save();
        console.log(`  ✅ Translated: ${f.label}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${f.label} —`, err.message);
    }
  }

  console.log('\n🎉 Backfill complete!');
  await mongoose.disconnect();
}

backfill().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
