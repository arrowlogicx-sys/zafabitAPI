const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/User');
const Booking = require('../src/models/Booking');
const BookingConfig = require('../src/models/BookingConfig');
const PromoCode = require('../src/models/PromoCode');
const Service = require('../src/models/Service');
const NotificationLog = require('../src/models/NotificationLog');
const { getActiveBookingConfig } = require('../src/utils/billingConfig');

async function run() {
  try {
    console.log('Connecting to database...');
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not defined in the environment variables.');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    // ----------------------------------------------------
    // SETUP CONFIGURATION
    // ----------------------------------------------------
    console.log('\n--- 1. FETCHING CURRENT CONFIGURATION ---');
    let config = await getActiveBookingConfig();
    console.log(`Current Referral Welcome Bonus: ₹${config.referralWelcomeBonus}`);
    console.log(`Current Referrer Reward Amount: ₹${config.referrerReward}`);

    // Update dynamically for the simulation
    config.referralWelcomeBonus = 150;
    config.referrerReward = 200;
    await config.save();
    console.log(`Updated dynamically for simulation: Welcome Bonus = ₹150, Referrer Reward = ₹200`);

    // ----------------------------------------------------
    // CREATE USERS AND SERVICES FOR SIMULATION
    // ----------------------------------------------------
    console.log('\n--- 2. SETTING UP TEST USERS & SERVICES ---');

    // Cleanup previous simulation run
    await User.deleteMany({
      email: { $in: ['referrer@test.com', 'newcustomer@test.com', 'maid@test.com'] },
    });
    await Booking.deleteMany({ 'billingDetails.notes': 'SIMULATION_BOOKING' });
    await Service.deleteMany({ name: 'Simulated Cleaning Service' });

    // Temp Service
    const testService = await Service.create({
      name: 'Simulated Cleaning Service',
      description: 'Temporary service for simulation purposes',
      category: 'Deep Cleaning',
      price: 300,
    });
    console.log(`Created Temp Service: ${testService.name}`);

    // Referrer Bob
    const referrer = await User.create({
      name: 'Referrer Bob',
      email: 'referrer@test.com',
      password: 'password123',
      phone: '9999999901',
      role: 'customer',
      referralCode: 'BOB-999',
      walletBalance: 0,
      referralCredits: 0,
    });
    console.log(
      `Created Referrer: ${referrer.name} (Code: ${referrer.referralCode}), Balance: ₹${referrer.walletBalance}`,
    );

    // New Customer Alice
    const newCustomer = await User.create({
      name: 'New Friend Alice',
      email: 'newcustomer@test.com',
      password: 'password123',
      phone: '9999999902',
      role: 'customer',
      referralCode: 'ALICE-123',
      walletBalance: 0,
      referralCredits: 0,
    });
    console.log(
      `Created New Customer: ${newCustomer.name}, Balance: ₹${newCustomer.walletBalance}`,
    );

    // Test Maid Maria
    const testMaid = await User.create({
      name: 'Maid Maria',
      email: 'maid@test.com',
      password: 'password123',
      phone: '9999999903',
      role: 'maid',
      referralCode: 'MARIA-456',
    });
    console.log(`Created Test Maid: ${testMaid.name}`);

    // ----------------------------------------------------
    // SIMULATE WELCOME BONUS
    // ----------------------------------------------------
    console.log('\n--- 3. SIMULATING APPLY REFERRAL CODE ---');
    // Alice applies Bob's code 'BOB-999'
    const appliedCode = 'BOB-999';
    const foundReferrer = await User.findOne({ referralCode: appliedCode });
    if (!foundReferrer) throw new Error('Referrer not found');

    newCustomer.referredBy = appliedCode;
    const welcomeBonus = config.referralWelcomeBonus;
    newCustomer.walletBalance += welcomeBonus;
    newCustomer.walletTransactions.push({
      amount: welcomeBonus,
      type: 'credit',
      reason: `Welcome bonus using referral code ${appliedCode}. Referrer will be rewarded after your first booking.`,
    });
    await newCustomer.save();
    console.log(`Alice successfully applied Bob's code '${appliedCode}'.`);
    console.log(
      `Alice received Welcome Bonus: +₹${welcomeBonus}. Alice's Wallet: ₹${newCustomer.walletBalance}`,
    );

    // ----------------------------------------------------
    // SIMULATE PROMO CODE VALIDATION
    // ----------------------------------------------------
    console.log('\n--- 4. SIMULATING PROMO CODE VALIDATION ---');
    // Delete existing simulation promo if any
    await PromoCode.deleteOne({ code: 'SAVE50' });
    const promo = await PromoCode.create({
      code: 'SAVE50',
      description: 'Get flat 50 off on first cleaning',
      type: 'flat',
      discountValue: 50,
      minBookingAmount: 200,
      expiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
      usageLimit: 10,
      status: 'active',
    });
    console.log(
      `Created Promo Code: ${promo.code} (Flat ₹${promo.discountValue} off, min spend ₹${promo.minBookingAmount})`,
    );

    // Validate
    const bookingAmount = 350;
    console.log(`Validating promo 'SAVE50' against booking subtotal ₹${bookingAmount}...`);
    const isValid =
      promo.status === 'active' &&
      new Date() < promo.expiryDate &&
      bookingAmount >= promo.minBookingAmount &&
      promo.redemptionsCount < promo.usageLimit;

    if (isValid) {
      const discount = promo.discountValue;
      console.log(
        `[VALID] Promo code applied successfully! Discount: -₹${discount}, Total Net Amount: ₹${bookingAmount - discount}`,
      );
    } else {
      console.log(`[INVALID] Promo validation failed.`);
    }

    // ----------------------------------------------------
    // SIMULATE BOOKING COMPLETION & REFERRER BONUS
    // ----------------------------------------------------
    console.log('\n--- 5. SIMULATING BOOKING COMPLETION & REFERRER REWARD ---');
    // Create first completed booking for Alice
    const booking = await Booking.create({
      customer: newCustomer._id,
      maid: testMaid._id,
      service: testService._id,
      items: [
        { service: testService._id, name: 'Simulated Cleaning Service', price: 300, duration: 120 },
      ],
      subtotal: 300,
      taxAmount: 27,
      platformFee: 29,
      totalAmount: 356,
      status: 'completed', // Simulate completion
      scheduleDate: new Date(),
      date: '2026-06-15',
      timeSlot: '10:00 AM',
      address: {
        street: '123 Test Street',
        city: 'Kochi',
        state: 'Kerala',
        postalCode: '682030',
      },
      billingDetails: {
        notes: 'SIMULATION_BOOKING',
      },
    });
    console.log(`Alice completed her first booking of amount ₹${booking.totalAmount}.`);

    // Check referrer reward logic
    if (newCustomer.referredBy && !newCustomer.isReferralRewardClaimed) {
      const completedCount = await Booking.countDocuments({
        customer: newCustomer._id,
        status: 'completed',
      });

      console.log(`Alice completed job count: ${completedCount}`);
      if (completedCount === 1) {
        const referrerToReward = await User.findOne({ referralCode: newCustomer.referredBy });
        if (referrerToReward) {
          const reward = config.referrerReward;
          referrerToReward.walletBalance += reward;
          referrerToReward.referralCredits += reward;
          referrerToReward.walletTransactions.push({
            amount: reward,
            type: 'credit',
            reason: `Referral bonus from friend Alice's first booking.`,
          });
          newCustomer.isReferralRewardClaimed = true;

          await referrerToReward.save();
          await newCustomer.save();

          console.log(`[REWARDED] Referrer Bob received his Referral Bonus: +₹${reward}!`);
          console.log(`Bob's updated Wallet Balance: ₹${referrerToReward.walletBalance}`);
          console.log(
            `Alice's isReferralRewardClaimed status set to: ${newCustomer.isReferralRewardClaimed}`,
          );
        }
      }
    }

    // ----------------------------------------------------
    // SIMULATE CAMPAIGN BROADCAST
    // ----------------------------------------------------
    console.log('\n--- 6. SIMULATING PUSH NOTIFICATION CAMPAIGN ---');
    const campaignTitle = 'Rainy Season Mega Discount!';
    const campaignBody = 'Get flat 20% off all cleaning services this week! Use promo: MONSOON20';
    const recipientType = 'customers';

    const campaignLog = await NotificationLog.create({
      title: campaignTitle,
      message: campaignBody,
      recipientType: recipientType,
      totalRecipients: 2,
      successCount: 2,
      failureCount: 0,
    });

    console.log(`Admin sent push campaign: "${campaignTitle}"`);
    console.log(`Campaign Target: ${recipientType}`);
    console.log(`Log created successfully: ID ${campaignLog._id}`);

    // Cleanup simulation records so we do not pollute database
    console.log('\nCleaning up simulation documents...');
    await User.deleteMany({
      email: { $in: ['referrer@test.com', 'newcustomer@test.com', 'maid@test.com'] },
    });
    await Booking.deleteMany({ 'billingDetails.notes': 'SIMULATION_BOOKING' });
    await Service.deleteMany({ name: 'Simulated Cleaning Service' });
    await PromoCode.deleteOne({ code: 'SAVE50' });
    await NotificationLog.deleteOne({ _id: campaignLog._id });
    console.log('Cleanup complete.');
  } catch (error) {
    console.error('Simulation failed with error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDatabase disconnected.');
  }
}

run();
