const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/User');
const PromoCode = require('../src/models/PromoCode');
const NotificationLog = require('../src/models/NotificationLog');

async function seed() {
  try {
    console.log('Connecting to database...');
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not defined in the environment variables.');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    // ----------------------------------------------------
    // CLEANUP OLD SEED DATA ONLY
    // ----------------------------------------------------
    console.log('Cleaning up old seed marketing data...');
    await User.deleteMany({ email: { $regex: '@seed-marketing.com$' } });
    await PromoCode.deleteMany({
      code: { $in: ['WELCOME150', 'FESTIVE250', 'MONSOON20', 'CLEAN50'] },
    });
    await NotificationLog.deleteMany({ title: { $regex: '^\[SEED\]' } });

    // ----------------------------------------------------
    // SEED MOCK REFERRERS (THE INVITERS)
    // ----------------------------------------------------
    console.log('Seeding mock referrers...');
    const referrers = await User.create([
      {
        name: 'Rahul Sharma',
        email: 'rahul@seed-marketing.com',
        phone: '9876543210',
        role: 'customer',
        referralCode: 'RAHUL-777',
        walletBalance: 400,
        referralCredits: 400,
        isVerified: true,
      },
      {
        name: 'Safna K',
        email: 'safna@seed-marketing.com',
        phone: '9876543211',
        role: 'customer',
        referralCode: 'SAFNA-888',
        walletBalance: 200,
        referralCredits: 200,
        isVerified: true,
      },
      {
        name: 'Alan Kurian',
        email: 'alan@seed-marketing.com',
        phone: '9876543212',
        role: 'customer',
        referralCode: 'ALAN-999',
        walletBalance: 600,
        referralCredits: 600,
        isVerified: true,
      },
    ]);

    console.log(`Seeded ${referrers.length} referrers.`);

    // ----------------------------------------------------
    // SEED REFERRED USERS (THE INVITEES)
    // ----------------------------------------------------
    console.log('Seeding referred users log...');
    const referredUsers = await User.create([
      {
        name: 'Priya Nair',
        email: 'priya@seed-marketing.com',
        phone: '9876543220',
        role: 'customer',
        referredBy: 'RAHUL-777',
        walletBalance: 150,
        isVerified: true, // Completed conversion
        isReferralRewardClaimed: true,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      },
      {
        name: 'John Doe',
        email: 'john@seed-marketing.com',
        phone: '9876543221',
        role: 'customer',
        referredBy: 'RAHUL-777',
        walletBalance: 150,
        isVerified: true, // Completed conversion
        isReferralRewardClaimed: true,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      },
      {
        name: 'Anjali Menon',
        email: 'anjali@seed-marketing.com',
        phone: '9876543222',
        role: 'customer',
        referredBy: 'SAFNA-888',
        walletBalance: 150,
        isVerified: true, // Completed conversion
        isReferralRewardClaimed: true,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      },
      {
        name: 'Bibin George',
        email: 'bibin@seed-marketing.com',
        phone: '9876543223',
        role: 'customer',
        referredBy: 'ALAN-999',
        walletBalance: 150,
        isVerified: false, // Pending conversion
        isReferralRewardClaimed: false,
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      },
      {
        name: 'Devika S',
        email: 'devika@seed-marketing.com',
        phone: '9876543224',
        role: 'customer',
        referredBy: 'ALAN-999',
        walletBalance: 150,
        isVerified: false, // Pending conversion
        isReferralRewardClaimed: false,
        createdAt: new Date(), // Just joined
      },
    ]);

    console.log(`Seeded ${referredUsers.length} referred customer logs.`);

    // ----------------------------------------------------
    // SEED PROMO CODES
    // ----------------------------------------------------
    console.log('Seeding active promo codes...');
    const promoCodes = await PromoCode.create([
      {
        code: 'WELCOME150',
        description: 'Flat ₹150 off on your first home cleaning service booking',
        type: 'flat',
        discountValue: 150,
        minBookingAmount: 499,
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days expiry
        usageLimit: 500,
        redemptionsCount: 42,
        status: 'active',
      },
      {
        code: 'FESTIVE250',
        description: 'Get ₹250 off on deep cleaning services above ₹999',
        type: 'flat',
        discountValue: 250,
        minBookingAmount: 999,
        expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days expiry
        usageLimit: 200,
        redemptionsCount: 8,
        status: 'active',
      },
      {
        code: 'MONSOON20',
        description: 'Get 20% discount on regular cleaning services',
        type: 'percentage',
        discountValue: 20,
        maxDiscount: 100,
        minBookingAmount: 300,
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days expiry
        usageLimit: 1000,
        redemptionsCount: 89,
        status: 'active',
      },
    ]);
    console.log(`Seeded ${promoCodes.length} promo codes.`);

    // ----------------------------------------------------
    // SEED CAMPAIGNS (NOTIFICATION LOGS)
    // ----------------------------------------------------
    console.log('Seeding push campaign logs...');
    const campaigns = await NotificationLog.create([
      {
        title: '[SEED] Monsoon Home Clean Promotion',
        message:
          'Get your home sparkling clean this monsoon! Flat 20% off all deep cleaning services.',
        recipientType: 'customers',
        totalRecipients: 150,
        successCount: 146,
        failureCount: 4,
        sentAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      },
      {
        title: '[SEED] Partner Onboarding Bonus Alert',
        message:
          'Earn double payout bonuses for all bookings completed in Kakkanad zone this weekend!',
        recipientType: 'maids',
        totalRecipients: 40,
        successCount: 40,
        failureCount: 0,
        sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ]);
    console.log(`Seeded ${campaigns.length} campaigns.`);

    console.log('\nSeed operations completed successfully!');
  } catch (error) {
    console.error('Seed execution failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database disconnected.');
  }
}

seed();
