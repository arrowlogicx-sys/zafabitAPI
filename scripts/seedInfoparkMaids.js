/**
 * Seed Script: 3 Available Maids near Vennala + Infopark
 * ─────────────────────────────────────────────────────────
 * Places 3 maids within 2–4 km of Vennala, Ernakulam
 * (the customer's current saved address: 9.9816, 76.3213)
 * AND 3 near Infopark for broader coverage.
 *
 * Run:  node scripts/seedInfoparkMaids.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const MaidProfile = require('../src/models/MaidProfile');

// Customer address is Vennala, Ernakulam (9.9816, 76.3213)
// Infopark Phase 1 gate: 10.0260, 76.3291

const MAIDS = [
  // ── Near Vennala / Thrippunithura (within 2-4 km of 9.9816, 76.3213) ──────
  {
    firstName: 'Asha',
    lastName: 'Nair',
    phone: '+918891001001',
    email: 'asha.nair.maid@zaffabit.com',
    rating: 4.8,
    // ~1.3 km N of Vennala (Vyttila hub area)
    lat: 9.9683,
    lng: 76.318,
    zone: 'Vyttila',
  },
  {
    firstName: 'Meenu',
    lastName: 'Thomas',
    phone: '+918891001002',
    email: 'meenu.thomas.maid@zaffabit.com',
    rating: 4.6,
    // ~900 m E of Vennala (Palarivattom side)
    lat: 9.9872,
    lng: 76.331,
    zone: 'Vennala',
  },
  {
    firstName: 'Latha',
    lastName: 'Krishnan',
    phone: '+918891001003',
    email: 'latha.krishnan.maid@zaffabit.com',
    rating: 4.9,
    // ~2.1 km SE of Vennala (Tripunithura border)
    lat: 9.962,
    lng: 76.338,
    zone: 'Vennala',
  },
  // ── Near Infopark, Kakkanad ───────────────────────────────────────────────
  {
    firstName: 'Divya',
    lastName: 'Menon',
    phone: '+918891001004',
    email: 'divya.menon.maid@zaffabit.com',
    rating: 4.7,
    // Thrikkakara, 800m NW of Infopark
    lat: 10.0308,
    lng: 76.3241,
    zone: 'Kakkanad',
  },
  {
    firstName: 'Suma',
    lastName: 'Rajan',
    phone: '+918891001005',
    email: 'suma.rajan.maid@zaffabit.com',
    rating: 4.5,
    // Infopark Phase 2 area
    lat: 10.0271,
    lng: 76.3382,
    zone: 'Kakkanad',
  },
  {
    firstName: 'Anjali',
    lastName: 'Pillai',
    phone: '+918891001006',
    email: 'anjali.pillai.maid@zaffabit.com',
    rating: 4.8,
    // Rajagiri Valley, 1.2km S of Infopark
    lat: 10.0148,
    lng: 76.3318,
    zone: 'Kakkanad',
  },
];

async function seed() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected\n');

  const passwordHash = await bcrypt.hash('Zafabit@123', 10);
  const results = [];

  for (const m of MAIDS) {
    const fullName = `${m.firstName} ${m.lastName}`;

    // ── Upsert User ──────────────────────────────────────────────────────────
    let user = await User.findOne({ email: m.email });
    if (!user) {
      user = await User.collection.insertOne({
        firstName: m.firstName,
        lastName: m.lastName,
        name: fullName,
        email: m.email,
        phone: m.phone,
        role: 'maid',
        password: passwordHash,
        isVerified: true,
        isBlocked: false,
        referralCode: `MAID-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        walletBalance: 0,
        rewardPoints: 0,
        referralCredits: 0,
        isReferralRewardClaimed: false,
        language: 'en',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      user = { _id: user.insertedId };
      console.log(`  ➕ Created User: ${fullName}`);
    } else {
      console.log(`  ♻️  User exists: ${fullName} (${user._id})`);
    }

    // ── Upsert MaidProfile ───────────────────────────────────────────────────
    const profileData = {
      activeStatus: 'active',
      isIdentityVerified: true,
      isAvailable: true,
      isOnline: true,
      rating: m.rating,
      reviewCount: Math.floor(Math.random() * 80) + 20,
      zone: m.zone,
      onboardingStep: 4,
      jobType: 'full_time',
      workAreas: [m.zone, 'Kochi'],
      totalEarnings: 0,
      referralIncentives: 0,
      lastLocation: {
        lat: m.lat,
        lng: m.lng,
        lastUpdated: new Date(),
      },
      currentLocation: {
        type: 'Point',
        coordinates: [m.lng, m.lat], // GeoJSON: [longitude, latitude]
      },
      lastLocationUpdatedAt: new Date(), // marks as ONLINE right now
      updatedAt: new Date(),
    };

    const existing = await MaidProfile.findOne({ user: user._id });
    if (!existing) {
      await MaidProfile.create({ user: user._id, ...profileData });
      await User.findByIdAndUpdate(user._id, { maidProfile: user._id });
      console.log(`  ➕ MaidProfile: ${fullName} @ (${m.lat}, ${m.lng})`);
    } else {
      await MaidProfile.findByIdAndUpdate(existing._id, { $set: profileData });
      console.log(`  ♻️  MaidProfile updated: ${fullName} @ (${m.lat}, ${m.lng})`);
    }

    results.push({ name: fullName, zone: m.zone, lat: m.lat, lng: m.lng });
  }

  console.log('\n🎉 All maids seeded:');
  console.table(results);

  // ── Verify both zones ──────────────────────────────────────────────────────
  const { findAvailableMaids } = require('../src/utils/maidAvailability');

  const ZONES = [
    { name: 'Vennala (customer address)', lat: 9.9816, lng: 76.3213 },
    { name: 'Infopark, Kakkanad', lat: 10.026, lng: 76.3291 },
  ];

  for (const zone of ZONES) {
    console.log(`\n🔍 Checking availability near ${zone.name}...`);
    const av = await findAvailableMaids({
      lat: zone.lat,
      lng: zone.lng,
      radiusMeters: 5000,
      limit: 5,
    });
    console.log(`   Available: ${av.available}  |  Count: ${av.count}`);
    av.maids.forEach((md) =>
      console.log(
        `   • ${md.name}  ${md.distanceMeters}m away  ETA ${md.etaMinutes}min  ⭐${md.rating}`,
      ),
    );
  }

  await mongoose.disconnect();
  console.log('\n🔌 Done');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
