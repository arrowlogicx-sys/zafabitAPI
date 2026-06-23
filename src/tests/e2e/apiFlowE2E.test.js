process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_razorpay_secret';
process.env.DISABLE_DEV_AUTH_FALLBACK = 'true';

const crypto = require('crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

jest.mock('cloudinary', () => {
  const { PassThrough } = require('stream');
  let uploadCount = 0;

  return {
    v2: {
      config: jest.fn(),
      uploader: {
        upload_stream: jest.fn((options, callback) => {
          const stream = new PassThrough();
          stream.on('finish', () => {
            uploadCount += 1;
            const folder = options.folder || 'zaffabit/test';
            callback(null, {
              secure_url: `https://res.cloudinary.com/test/${folder}/asset-${uploadCount}.jpg`,
              public_id: `${folder}/asset-${uploadCount}`,
            });
          });
          return stream;
        }),
        destroy: jest.fn(() => Promise.resolve({ result: 'ok' })),
      },
    },
  };
});

const app = require('../../app');

const User = require('../../models/User');
const CustomerProfile = require('../../models/CustomerProfile');
const MaidProfile = require('../../models/MaidProfile');
const Agent = require('../../models/Agent');
const Service = require('../../models/Service');
const Booking = require('../../models/Booking');
const Payment = require('../../models/Payment');
const PromoCode = require('../../models/PromoCode');
const SupportTicket = require('../../models/SupportTicket');
const Incident = require('../../models/Incident');

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
const uploadRoot = path.join(process.cwd(), 'public', 'uploads');

const listUploadFiles = () => {
  const files = [];
  if (!fs.existsSync(uploadRoot)) return files;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else files.push(fullPath);
    }
  };

  walk(uploadRoot);
  return files;
};

const address = {
  title: 'Home',
  houseName: 'Flat 4B',
  street: 'MG Road',
  city: 'Kochi',
  state: 'Kerala',
  pincode: '682001',
  phone: '+919876543210',
};

describe('Mobile/Admin API flow E2E with in-memory MongoDB', () => {
  let mongo;
  let customer;
  let referrer;
  let maid;
  let admin;
  let agentUser;
  let maidProfile;
  let service;
  let customerToken;
  let maidToken;
  let adminToken;
  let agentToken;
  let bookingId;
  let paymentId;
  let reviewId;
  let supportTicketId;
  let incidentId;
  let promoId;
  let uploadFilesBefore;

  beforeAll(async () => {
    uploadFilesBefore = new Set(listUploadFiles());
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    [customer, referrer, maid, admin, agentUser] = await User.create([
      {
        firstName: 'Arjun',
        lastName: 'Kumar',
        name: 'Arjun Kumar',
        email: 'customer.e2e@zaffabit.test',
        phone: '+919000000001',
        password: 'Password123',
        role: 'customer',
        isVerified: true,
        walletBalance: 250,
      },
      {
        firstName: 'Priya',
        lastName: 'Nair',
        name: 'Priya Nair',
        email: 'referrer.e2e@zaffabit.test',
        phone: '+919000000002',
        password: 'Password123',
        role: 'customer',
        isVerified: true,
      },
      {
        firstName: 'Sita',
        lastName: 'Devi',
        name: 'Sita Devi',
        email: 'maid.e2e@zaffabit.test',
        phone: '+919000000003',
        employeeId: 'M-E2E-001',
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      },
      {
        firstName: 'Dev',
        lastName: 'Admin',
        name: 'Dev Admin',
        email: 'admin.e2e@zaffabit.test',
        phone: '+919000000004',
        password: 'Password123',
        role: 'admin',
        isVerified: true,
      },
      {
        firstName: 'Field',
        lastName: 'Agent',
        name: 'Field Agent',
        email: 'agent.e2e@zaffabit.test',
        phone: '+919000000005',
        password: 'Password123',
        role: 'agent',
        isVerified: true,
      },
    ]);

    const customerProfile = await CustomerProfile.create({ user: customer._id });
    customer.customerProfile = customerProfile._id;
    await customer.save();

    maidProfile = await MaidProfile.create({
      user: maid._id,
      activeStatus: 'active',
      isAvailable: true,
      isIdentityVerified: false,
      referredByAgent: 'AG-E2E',
      documents: [{ type: 'ID_PROOF', url: '/uploads/documents/seed.pdf', status: 'pending' }],
      rating: 4.8,
      reviewCount: 0,
    });
    maid.maidProfile = maidProfile._id;
    await maid.save();

    await Agent.create({
      user: agentUser._id,
      name: 'Field Agent',
      email: 'agent.e2e@zaffabit.test',
      phone: '+919000000005',
      agentCode: 'AG-E2E',
      zone: 'Kochi',
      commissionRate: 5,
      referredMaids: [maid._id],
    });

    service = await Service.create({
      name: 'E2E Deep Cleaning',
      description: 'End-to-end test cleaning service',
      category: 'Deep Cleaning',
      price: 1000,
      estimatedTime: 60,
      whatsIncluded: ['Sweep and mop all rooms'],
      doesNotInclude: ['Exterior wall washing'],
      howItsDone: [{ title: 'Preparation', description: 'Rooms are prepared before cleaning.' }],
      faqs: [
        {
          question: 'Can I book recurring service?',
          answer: 'Yes, recurring service can be selected during booking.',
        },
      ],
      status: 'active',
    });

    await PromoCode.create({
      code: 'E2E25',
      description: '25 percent off for API E2E',
      type: 'percentage',
      discountValue: 25,
      maxDiscount: 300,
      status: 'active',
    });

    const supportTicket = await SupportTicket.create({
      ticketId: '#TK-E2E',
      user: 'Arjun Kumar',
      email: 'customer.e2e@zaffabit.test',
      title: 'Need help with booking',
      priority: 'high',
      status: 'open',
      messages: [
        {
          sender: 'Arjun Kumar',
          senderRole: 'customer',
          avatarInitials: 'AK',
          content: 'Please help with my booking.',
        },
      ],
    });
    supportTicketId = supportTicket._id;

    const incident = await Incident.create({
      incidentId: '#INC-E2E',
      user: 'Arjun Kumar',
      userRole: 'customer',
      type: 'SOS Panic Button Triggered',
      location: 'Kochi',
      priority: 'critical',
      status: 'active',
      reporterPhone: '+919000000001',
      description: 'Seeded E2E incident.',
    });
    incidentId = incident._id;

    customerToken = tokenFor(customer);
    maidToken = tokenFor(maid);
    adminToken = tokenFor(admin);
    agentToken = tokenFor(agentUser);
  });

  afterAll(async () => {
    for (const file of listUploadFiles()) {
      if (!uploadFilesBefore.has(file)) {
        fs.rmSync(file, { force: true });
      }
    }

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongo.stop();
    delete process.env.DISABLE_DEV_AUTH_FALLBACK;
  });

  it('enforces strict auth and role permissions', async () => {
    const unauthorized = await request(app).get('/api/v1/customers/profile');
    expect(unauthorized.status).toBe(401);

    const forbidden = await request(app).post('/api/v1/services').set(auth(customerToken)).send({
      name: 'Forbidden Service',
      description: 'Customer cannot create services',
      category: 'Test',
      price: 1,
    });
    expect(forbidden.status).toBe(403);
  });

  it('covers mobile content splash, banners, and featured service admin Cloudinary flows', async () => {
    const emptySplash = await request(app).get('/api/v1/content/splash');
    expect(emptySplash.status).toBe(200);
    expect(emptySplash.body.data.splash).toEqual([]);

    const forbiddenSplash = await request(app)
      .post('/api/v1/content/splash')
      .set(auth(customerToken))
      .field('title', 'Forbidden Splash');
    expect(forbiddenSplash.status).toBe(403);

    const createdSplash = await request(app)
      .post('/api/v1/content/splash')
      .set(auth(adminToken))
      .field('title', 'Zaffabit')
      .field('subtitle', 'Trusted home services')
      .field('ctaLabel', 'Get Started')
      .field('order', '1')
      .attach('image', Buffer.from('splash-image'), {
        filename: 'splash.jpg',
        contentType: 'image/jpeg',
      });
    expect(createdSplash.status).toBe(201);
    expect(createdSplash.body.data.splash.imageUrl).toContain(
      'cloudinary.com/test/zaffabit/splash',
    );
    const splashId = createdSplash.body.data.splash._id;

    const publicSplash = await request(app).get('/api/v1/content/splash');
    expect(publicSplash.status).toBe(200);
    expect(publicSplash.body.data.splash).toHaveLength(1);

    const updatedSplash = await request(app)
      .put(`/api/v1/content/splash/${splashId}`)
      .set(auth(adminToken))
      .field('title', 'Zaffabit Customer')
      .attach('image', Buffer.from('splash-replacement'), {
        filename: 'splash-replacement.jpg',
        contentType: 'image/jpeg',
      });
    expect(updatedSplash.status).toBe(200);
    expect(updatedSplash.body.data.splash.title).toBe('Zaffabit Customer');

    const emptyBanners = await request(app).get('/api/v1/content/banners');
    expect(emptyBanners.status).toBe(200);
    expect(emptyBanners.body.data.banners).toEqual([]);

    const forbiddenBanner = await request(app)
      .post('/api/v1/content/banners')
      .set(auth(customerToken))
      .field('title', 'Forbidden Banner');
    expect(forbiddenBanner.status).toBe(403);

    const createdBanner = await request(app)
      .post('/api/v1/content/banners')
      .set(auth(adminToken))
      .field('title', 'Need Help Today?')
      .field('subtitle', 'Book trusted professionals instantly.')
      .field('ctaLabel', 'Get Started')
      .field('order', '1')
      .attach('image', Buffer.from('banner-image'), {
        filename: 'banner.jpg',
        contentType: 'image/jpeg',
      });
    expect(createdBanner.status).toBe(201);
    expect(createdBanner.body.data.banner.imageUrl).toContain(
      'cloudinary.com/test/zaffabit/banners',
    );
    const bannerId = createdBanner.body.data.banner._id;

    const publicBanners = await request(app).get('/api/v1/content/banners');
    expect(publicBanners.status).toBe(200);
    expect(publicBanners.body.data.banners).toHaveLength(1);

    const updatedBanner = await request(app)
      .put(`/api/v1/content/banners/${bannerId}`)
      .set(auth(adminToken))
      .field('title', 'Need Cleaning Today?')
      .attach('image', Buffer.from('banner-replacement'), {
        filename: 'banner-replacement.jpg',
        contentType: 'image/jpeg',
      });
    expect(updatedBanner.status).toBe(200);
    expect(updatedBanner.body.data.banner.title).toBe('Need Cleaning Today?');

    const forbiddenFeatured = await request(app)
      .post('/api/v1/content/featured-services')
      .set(auth(customerToken))
      .field('serviceId', String(service._id));
    expect(forbiddenFeatured.status).toBe(403);

    const createdFeatured = await request(app)
      .post('/api/v1/content/featured-services')
      .set(auth(adminToken))
      .field('serviceId', String(service._id))
      .field('label', 'Deep Cleaning')
      .field('highlight', 'Best Seller')
      .field('order', '1')
      .attach('icon', Buffer.from('featured-icon'), {
        filename: 'featured.jpg',
        contentType: 'image/jpeg',
      });
    expect(createdFeatured.status).toBe(201);
    expect(createdFeatured.body.data.featured.iconUrl).toContain(
      'cloudinary.com/test/zaffabit/service-icons',
    );
    const featuredId = createdFeatured.body.data.featured._id;

    const publicFeatured = await request(app).get('/api/v1/content/featured-services');
    expect(publicFeatured.status).toBe(200);
    expect(publicFeatured.body.data.featured).toHaveLength(1);
    expect(publicFeatured.body.data.featured[0].serviceId.name).toBe(service.name);

    const updatedFeatured = await request(app)
      .put(`/api/v1/content/featured-services/${featuredId}`)
      .set(auth(adminToken))
      .field('label', 'Premium Deep Cleaning')
      .attach('icon', Buffer.from('featured-icon-replacement'), {
        filename: 'featured-replacement.jpg',
        contentType: 'image/jpeg',
      });
    expect(updatedFeatured.status).toBe(200);
    expect(updatedFeatured.body.data.featured.label).toBe('Premium Deep Cleaning');

    const deletedFeatured = await request(app)
      .delete(`/api/v1/content/featured-services/${featuredId}`)
      .set(auth(adminToken));
    expect(deletedFeatured.status).toBe(200);

    const deletedSplash = await request(app)
      .delete(`/api/v1/content/splash/${splashId}`)
      .set(auth(adminToken));
    expect(deletedSplash.status).toBe(200);

    const deletedBanner = await request(app)
      .delete(`/api/v1/content/banners/${bannerId}`)
      .set(auth(adminToken));
    expect(deletedBanner.status).toBe(200);
  });

  it('covers authentication and self-service profile APIs', async () => {
    const otpStart = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '+919000000099', language: 'en' });
    expect(otpStart.status).toBe(200);
    expect(otpStart.body.data.otp).toBe('123456');

    const otpVerify = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: '+919000000099', otp: '123456' });
    expect(otpVerify.status).toBe(200);
    expect(otpVerify.body.data.token).toBeTruthy();

    const maidLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'maid.e2e@zaffabit.test', password: 'Password123' });
    expect(maidLogin.status).toBe(200);
    expect(maidLogin.body.data.user.role).toBe('maid');

    const me = await request(app).get('/api/v1/auth/me').set(auth(customerToken));
    expect(me.status).toBe(200);

    const pushToken = await request(app)
      .put('/api/v1/auth/push-token')
      .set(auth(customerToken))
      .send({ pushToken: 'fcm-token-e2e' });
    expect(pushToken.status).toBe(200);

    const profile = await request(app)
      .put('/api/v1/auth/profile')
      .set(auth(customerToken))
      .send({ firstName: 'Arjun', lastName: 'E2E', language: 'ml' });
    expect(profile.status).toBe(200);
    expect(profile.body.data.user).not.toHaveProperty('email');

    const password = await request(app)
      .put('/api/v1/auth/password')
      .set(auth(customerToken))
      .send({ currentPassword: 'Password123', newPassword: 'Password456' });
    expect(password.status).toBe(200);

    const logout = await request(app).get('/api/v1/auth/logout').set(auth(customerToken));
    expect(logout.status).toBe(200);
  });

  it('covers customer profile, address, wallet, property, referral, and support APIs', async () => {
    const profile = await request(app).get('/api/v1/customers/profile').set(auth(customerToken));
    expect(profile.status).toBe(200);
    expect(profile.body.data.customer).not.toHaveProperty('email');

    const updated = await request(app)
      .put('/api/v1/customers/profile')
      .set(auth(customerToken))
      .send({ firstName: 'Arjun', lastName: 'Customer' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.customer).not.toHaveProperty('email');

    const addedAddress = await request(app)
      .post('/api/v1/customers/addresses')
      .set(auth(customerToken))
      .send(address);
    expect(addedAddress.status).toBe(201);
    const addressId = addedAddress.body.data.addresses[0]._id;
    expect(addedAddress.body.data.addresses[0].isDefault).toBe(true);

    // Add Address 2 and make it default
    const addedAddress2 = await request(app)
      .post('/api/v1/customers/addresses')
      .set(auth(customerToken))
      .send({
        title: 'Office',
        houseName: 'Zaffa Tech',
        street: 'Infopark Road',
        city: 'Kochi',
        pincode: '682030',
        phone: '+919000000001',
        isDefault: true,
      });
    expect(addedAddress2.status).toBe(201);

    // Check that Address 2 is default, and Address 1 is no longer default
    let listedAddresses = await request(app)
      .get('/api/v1/customers/addresses')
      .set(auth(customerToken));
    expect(listedAddresses.status).toBe(200);
    expect(listedAddresses.body.data.addresses).toHaveLength(2);
    const addr1AfterAdd2 = listedAddresses.body.data.addresses.find((a) => a._id === addressId);
    const addr2AfterAdd2 = listedAddresses.body.data.addresses.find((a) => a._id !== addressId);
    expect(addr1AfterAdd2.isDefault).toBe(false);
    expect(addr2AfterAdd2.isDefault).toBe(true);

    // Update Address 1 to default
    const editedAddress = await request(app)
      .put(`/api/v1/customers/addresses/${addressId}`)
      .set(auth(customerToken))
      .send({ landmark: 'Metro Station', isDefault: true });
    expect(editedAddress.status).toBe(200);

    // Verify Address 1 is default and Address 2 is not
    listedAddresses = await request(app)
      .get('/api/v1/customers/addresses')
      .set(auth(customerToken));
    const addr1AfterUpdate = listedAddresses.body.data.addresses.find((a) => a._id === addressId);
    const addr2AfterUpdate = listedAddresses.body.data.addresses.find((a) => a._id !== addressId);
    expect(addr1AfterUpdate.isDefault).toBe(true);
    expect(addr1AfterUpdate.landmark).toBe('Metro Station');
    expect(addr2AfterUpdate.isDefault).toBe(false);

    // Delete Address 2 (which is NOT default)
    const address2Id = addr2AfterUpdate._id;
    const deleteAddr2 = await request(app)
      .delete(`/api/v1/customers/addresses/${address2Id}`)
      .set(auth(customerToken));
    expect(deleteAddr2.status).toBe(200);

    // Verify Address 1 remains default
    listedAddresses = await request(app)
      .get('/api/v1/customers/addresses')
      .set(auth(customerToken));
    expect(listedAddresses.body.data.addresses).toHaveLength(1);
    expect(listedAddresses.body.data.addresses[0].isDefault).toBe(true);

    // Save property profile — no pets
    const savedProperty = await request(app)
      .post('/api/v1/customers/property-profile')
      .set(auth(customerToken))
      .send({
        bhkType: '2BHK',
        cleaningFrequency: 'one-time',
        surfaceType: ['tiles'],
        hasPets: false,
      });
    expect(savedProperty.status).toBe(200);
    expect(savedProperty.body.data.propertyProfile.hasPets).toBe(false);

    // Save property profile — WITH pets and a temperament
    const savedWithPets = await request(app)
      .post('/api/v1/customers/property-profile')
      .set(auth(customerToken))
      .send({
        bhkType: '3BHK',
        homeType: 'Apartment',
        memberCount: 4,
        hasPets: true,
        petTemperament: 'Friendly',
      });
    expect(savedWithPets.status).toBe(200);
    expect(savedWithPets.body.data.propertyProfile.hasPets).toBe(true);
    expect(savedWithPets.body.data.propertyProfile.petTemperament).toBe('Friendly');

    // GET and verify petTemperament is persisted in DB
    const property = await request(app)
      .get('/api/v1/customers/property-profile')
      .set(auth(customerToken));
    expect(property.status).toBe(200);
    expect(property.body.data.propertyProfile.hasPets).toBe(true);
    expect(property.body.data.propertyProfile.petTemperament).toBe('Friendly');

    const walletTopup = await request(app)
      .post('/api/v1/customers/wallet/add-money')
      .set(auth(customerToken))
      .send({ amount: 150 });
    expect(walletTopup.status).toBe(200);

    const wallet = await request(app).get('/api/v1/customers/wallet').set(auth(customerToken));
    if (wallet.status !== 200) {
      console.log('WALLET ERROR STATUS:', wallet.status);
      console.log('WALLET ERROR BODY:', wallet.body);
    }
    expect(wallet.status).toBe(200);

    await User.findByIdAndUpdate(customer._id, { $set: { rewardPoints: 75 } });
    const redeem = await request(app)
      .post('/api/v1/customers/wallet/redeem')
      .set(auth(customerToken))
      .send({ points: 50 });
    expect(redeem.status).toBe(200);
    expect(redeem.body.data.rewardPoints).toBe(25);

    const paymentMethods = await request(app)
      .get('/api/v1/customers/payment-methods')
      .set(auth(customerToken));
    expect(paymentMethods.status).toBe(200);

    const savedPaymentMethod = await request(app)
      .post('/api/v1/customers/payment-methods')
      .set(auth(customerToken))
      .send({ type: 'upi', upiId: 'arjun@upi', label: 'Arjun UPI', isDefault: true });
    expect(savedPaymentMethod.status).toBe(201);
    const paymentMethodId = savedPaymentMethod.body.data.paymentMethod._id;

    const deletePaymentMethod = await request(app)
      .delete(`/api/v1/customers/payment-methods/${paymentMethodId}`)
      .set(auth(customerToken));
    expect(deletePaymentMethod.status).toBe(200);

    const topUpStart = await request(app)
      .post('/api/v1/customers/wallet/top-up/initiate')
      .set(auth(customerToken))
      .send({ amount: 125, method: 'upi' });
    expect(topUpStart.status).toBe(200);

    const topUpVerify = await request(app)
      .post('/api/v1/customers/wallet/top-up/verify')
      .set(auth(customerToken))
      .send({ topUpId: topUpStart.body.data.topUpId, mockStatus: 'success' });
    expect(topUpVerify.status).toBe(200);
    expect(topUpVerify.body.data.walletBalance).toBeGreaterThanOrEqual(125);

    const referral = await request(app).get('/api/v1/customers/referral').set(auth(customerToken));
    expect(referral.status).toBe(200);

    const appliedReferral = await request(app)
      .post('/api/v1/customers/referral/apply')
      .set(auth(customerToken))
      .send({ referralCode: referrer.referralCode });
    expect(appliedReferral.status).toBe(200);

    const customerSupport = await request(app)
      .get('/api/v1/customers/support')
      .set(auth(customerToken));
    expect(customerSupport.status).toBe(200);

    const deletedAddress = await request(app)
      .delete(`/api/v1/customers/addresses/${addressId}`)
      .set(auth(customerToken));
    expect(deletedAddress.status).toBe(200);
  });

  it('rejects scheduled bookings inside the one-hour lead time', async () => {
    const tooSoonBooking = await request(app)
      .post('/api/v1/bookings')
      .set(auth(customerToken))
      .send({
        serviceId: service._id,
        duration: 60,
        bookingType: 'scheduled',
        scheduleDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        address,
        location: { lat: 10.0159, lng: 76.3419 },
      });

    expect(tooSoonBooking.status).toBe(400);
    expect(tooSoonBooking.body.message).toContain('at least 60 minutes in advance');
  });

  it('covers instant availability, mock UPI dispatch, queue advance, and targeted accept', async () => {
    await MaidProfile.syncIndexes();

    const [fastMaid, slowMaid, busyMaid, offlineMaid, scheduledMaid] = await User.create([
      {
        firstName: 'Fast',
        lastName: 'Maid',
        name: 'Fast Maid',
        email: 'fast.instant@zaffabit.test',
        phone: '+919100000001',
        employeeId: 'M-INSTANT-FAST',
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      },
      {
        firstName: 'Slow',
        lastName: 'Maid',
        name: 'Slow Maid',
        email: 'slow.instant@zaffabit.test',
        phone: '+919100000002',
        employeeId: 'M-INSTANT-SLOW',
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      },
      {
        firstName: 'Busy',
        lastName: 'Maid',
        name: 'Busy Maid',
        email: 'busy.instant@zaffabit.test',
        phone: '+919100000003',
        employeeId: 'M-INSTANT-BUSY',
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      },
      {
        firstName: 'Offline',
        lastName: 'Maid',
        name: 'Offline Maid',
        email: 'offline.instant@zaffabit.test',
        phone: '+919100000004',
        employeeId: 'M-INSTANT-OFFLINE',
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      },
      {
        firstName: 'Scheduled',
        lastName: 'Maid',
        name: 'Scheduled Maid',
        email: 'scheduled.instant@zaffabit.test',
        phone: '+919100000005',
        employeeId: 'M-INSTANT-SCHEDULED',
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      },
    ]);

    const customerLocation = { lat: 10.0159, lng: 76.3419 };
    const locationFor = (lat, lng) => ({
      type: 'Point',
      coordinates: [lng, lat],
    });

    await MaidProfile.create([
      {
        user: fastMaid._id,
        activeStatus: 'active',
        isAvailable: true,
        isOnline: true,
        isIdentityVerified: true,
        currentLocation: locationFor(10.0162, 76.3422),
        lastLocationUpdatedAt: new Date(),
      },
      {
        user: slowMaid._id,
        activeStatus: 'active',
        isAvailable: true,
        isOnline: true,
        isIdentityVerified: true,
        currentLocation: locationFor(10.0242, 76.3511),
        lastLocationUpdatedAt: new Date(),
      },
      {
        user: busyMaid._id,
        activeStatus: 'active',
        isAvailable: true,
        isOnline: true,
        isIdentityVerified: true,
        currentLocation: locationFor(10.0163, 76.3423),
        lastLocationUpdatedAt: new Date(),
      },
      {
        user: offlineMaid._id,
        activeStatus: 'active',
        isAvailable: true,
        isOnline: false,
        isIdentityVerified: true,
        currentLocation: locationFor(10.0164, 76.3424),
        lastLocationUpdatedAt: new Date(),
      },
      {
        user: scheduledMaid._id,
        activeStatus: 'active',
        isAvailable: true,
        isOnline: true,
        isIdentityVerified: true,
        currentLocation: locationFor(10.0165, 76.3425),
        lastLocationUpdatedAt: new Date(),
      },
    ]);

    const fastToken = tokenFor(fastMaid);
    const slowToken = tokenFor(slowMaid);
    const liveLocation = await request(app)
      .patch('/api/v1/maids/location')
      .set(auth(fastToken))
      .send({ lat: 10.0162, lng: 76.3422, isOnline: true, isAvailable: true });
    expect(liveLocation.status).toBe(200);
    expect(liveLocation.body.data.isOnline).toBe(true);

    await Booking.create({
      customer: customer._id,
      maid: busyMaid._id,
      service: service._id,
      items: [{ service: service._id, name: service.name, price: 1000, duration: 60 }],
      subtotal: 1000,
      platformFee: 29,
      gst: 90,
      totalAmount: 1119,
      address,
      location: customerLocation,
      scheduleDate: new Date(),
      bookingType: 'instant',
      status: 'accepted',
      paymentStatus: 'paid',
    });

    await Booking.create({
      customer: customer._id,
      maid: scheduledMaid._id,
      service: service._id,
      items: [{ service: service._id, name: service.name, price: 1000, duration: 60 }],
      subtotal: 1000,
      platformFee: 29,
      gst: 90,
      totalAmount: 1119,
      address,
      location: customerLocation,
      scheduleDate: new Date(Date.now() + 30 * 60000),
      bookingType: 'scheduled',
      status: 'pending',
      paymentStatus: 'pending',
      estimatedTime: 60,
    });

    const availability = await request(app)
      .post('/api/v1/bookings/instant-availability')
      .set(auth(customerToken))
      .send({ ...customerLocation, estimatedDurationMinutes: 60 });
    expect(availability.status).toBe(200);
    expect(availability.body.data.available).toBe(true);
    const availableIds = availability.body.data.maids.map((item) => item.maidId);
    expect(availableIds).toEqual([String(fastMaid._id), String(slowMaid._id)]);
    expect(availableIds).not.toContain(String(busyMaid._id));
    expect(availableIds).not.toContain(String(offlineMaid._id));
    expect(availableIds).not.toContain(String(scheduledMaid._id));

    const noFree = await request(app)
      .post('/api/v1/bookings/instant-availability')
      .set(auth(customerToken))
      .send({ lat: 8.1, lng: 77.5, estimatedDurationMinutes: 60 });
    expect(noFree.status).toBe(200);
    expect(noFree.body.data).toEqual({
      available: false,
      message: 'No free maid available',
      count: 0,
      maids: [],
    });

    const noFreeBooking = await request(app)
      .post('/api/v1/bookings')
      .set(auth(customerToken))
      .send({
        serviceId: service._id,
        duration: 60,
        bookingType: 'instant',
        address,
        location: { lat: 8.1, lng: 77.5 },
      });
    expect(noFreeBooking.status).toBe(201);

    const noFreePayment = await request(app)
      .post('/api/v1/payments/initiate')
      .set(auth(customerToken))
      .send({ bookingId: noFreeBooking.body.data.booking._id, method: 'upi' });
    // Backend now blocks payment when no maid is available near the booking location
    expect(noFreePayment.status).toBe(400);
    expect(noFreePayment.body.error.code).toBe('NO_MAID_AVAILABLE');

    const instantBooking = await request(app)
      .post('/api/v1/bookings')
      .set(auth(customerToken))
      .send({
        serviceId: service._id,
        duration: 60,
        bookingType: 'instant',
        address,
        location: customerLocation,
      });
    expect(instantBooking.status).toBe(201);
    expect(instantBooking.body.data.booking.status).toBe('pending_payment');
    expect(instantBooking.body.data.booking.paymentStatus).toBe('pending');
    const instantBookingId = instantBooking.body.data.booking._id;

    const cardPayment = await request(app)
      .post('/api/v1/payments/initiate')
      .set(auth(customerToken))
      .send({ bookingId: instantBookingId, method: 'card' });
    expect(cardPayment.status).toBe(400);

    const paymentStart = await request(app)
      .post('/api/v1/payments/initiate')
      .set(auth(customerToken))
      .send({ bookingId: instantBookingId, method: 'upi' });
    expect(paymentStart.status).toBe(200);

    const paymentVerify = await request(app)
      .post('/api/v1/payments/verify')
      .set(auth(customerToken))
      .send({ paymentId: paymentStart.body.data.paymentId, mock: true });
    expect(paymentVerify.status).toBe(200);
    expect(paymentVerify.body.message).toBe(
      'Payment received. Sharing your booking with nearby maids.',
    );
    expect(paymentVerify.body.data.checkoutState).toBe('success_pending_assignment');
    expect(paymentVerify.body.data.dispatch.available).toBe(true);
    expect(paymentVerify.body.data.dispatch.status).toBe('pending_assignment');
    expect(paymentVerify.body.data.booking.status).toBe('searching');

    const searchingBooking = await Booking.findById(instantBookingId);
    expect(searchingBooking.matchingQueue.map((item) => item.maidId.toString())).toEqual([
      String(fastMaid._id),
      String(slowMaid._id),
    ]);

    const rejected = await request(app)
      .post(`/api/v1/bookings/${instantBookingId}/respond?action=decline`)
      .set(auth(fastToken))
      .send({});
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.available).toBe(true);
    expect(rejected.body.data.booking.currentQueueIndex).toBe(1);

    const nonTargetAccept = await request(app)
      .post(`/api/v1/bookings/${instantBookingId}/respond?action=accept`)
      .set(auth(fastToken))
      .send({});
    expect(nonTargetAccept.status).toBe(403);

    const accepted = await request(app)
      .post(`/api/v1/bookings/${instantBookingId}/respond?action=accept`)
      .set(auth(slowToken))
      .send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.booking.status).toBe('accepted');
    expect(accepted.body.data.booking.maid._id || accepted.body.data.booking.maid).toBe(
      String(slowMaid._id),
    );

    const slowProfile = await MaidProfile.findOne({ user: slowMaid._id });
    expect(slowProfile.isAvailable).toBe(false);
  });

  it('broadcasts paid scheduled bookings and locks the first accepting candidate', async () => {
    const baseLocation = { lat: 9.9701, lng: 76.2999 };
    const scheduledMaids = await User.create(
      Array.from({ length: 6 }).map((_, index) => ({
        firstName: `Scheduled${index}`,
        lastName: 'Maid',
        name: `Scheduled Maid ${index}`,
        email: `scheduled.maid.${index}@zaffabit.test`,
        phone: `+91910000000${index}`,
        employeeId: `M-SCH-${index}`,
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      })),
    );

    await MaidProfile.create(
      scheduledMaids.map((maidUser, index) => ({
        user: maidUser._id,
        activeStatus: 'active',
        isAvailable: true,
        isOnline: true,
        isIdentityVerified: true,
        lastLocationUpdatedAt: new Date(),
        currentLocation: {
          type: 'Point',
          coordinates: [baseLocation.lng + (index < 5 ? index * 0.001 : 0.07), baseLocation.lat],
        },
        lastLocation: {
          lat: baseLocation.lat,
          lng: baseLocation.lng + (index < 5 ? index * 0.001 : 0.07),
          lastUpdated: new Date(),
        },
      })),
    );
    await MaidProfile.syncIndexes();

    const scheduledBooking = await request(app)
      .post('/api/v1/bookings')
      .set(auth(customerToken))
      .send({
        serviceId: service._id,
        duration: 60,
        bookingType: 'scheduled',
        scheduleDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        address,
        location: baseLocation,
      });
    expect(scheduledBooking.status).toBe(201);
    expect(scheduledBooking.body.data.booking.status).toBe('pending');

    const paymentStart = await request(app)
      .post('/api/v1/payments/initiate')
      .set(auth(customerToken))
      .send({ bookingId: scheduledBooking.body.data.booking._id, method: 'upi' });
    expect(paymentStart.status).toBe(200);

    const paymentVerify = await request(app)
      .post('/api/v1/payments/verify')
      .set(auth(customerToken))
      .send({ paymentId: paymentStart.body.data.paymentId, mock: true });
    expect(paymentVerify.status).toBe(200);
    expect(paymentVerify.body.data.checkoutState).toBe('success_pending_assignment');
    expect(paymentVerify.body.data.dispatch.status).toBe('broadcast_sent');
    expect(paymentVerify.body.data.booking.status).toBe('searching');
    expect(paymentVerify.body.data.booking.matchingQueue).toHaveLength(5);

    const firstBatchIds = paymentVerify.body.data.booking.matchingQueue.map((entry) =>
      entry.maidId.toString(),
    );
    expect(firstBatchIds).toContain(String(scheduledMaids[0]._id));
    expect(firstBatchIds).not.toContain(String(scheduledMaids[5]._id));

    const nonCandidateAccept = await request(app)
      .post(`/api/v1/bookings/${scheduledBooking.body.data.booking._id}/respond?action=accept`)
      .set(auth(tokenFor(scheduledMaids[5])))
      .send({});
    expect(nonCandidateAccept.status).toBe(403);

    const accepted = await request(app)
      .post(`/api/v1/bookings/${scheduledBooking.body.data.booking._id}/respond?action=accept`)
      .set(auth(tokenFor(scheduledMaids[2])))
      .send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.booking.status).toBe('accepted');
    expect(accepted.body.data.booking.maid._id || accepted.body.data.booking.maid).toBe(
      String(scheduledMaids[2]._id),
    );

    const storedAccepted = await Booking.findById(scheduledBooking.body.data.booking._id);
    const responses = new Map(
      storedAccepted.matchingQueue.map((entry) => [entry.maidId.toString(), entry.response]),
    );
    expect(responses.get(String(scheduledMaids[2]._id))).toBe('accepted');
    expect(responses.get(String(scheduledMaids[0]._id))).toBe('skipped');
  });

  it('expands scheduled broadcasts to 10km after all initial candidates reject', async () => {
    const baseLocation = { lat: 10.2001, lng: 76.5201 };
    const scheduledMaids = await User.create(
      Array.from({ length: 6 }).map((_, index) => ({
        firstName: `Expand${index}`,
        lastName: 'Maid',
        name: `Expand Maid ${index}`,
        email: `scheduled.expand.${index}@zaffabit.test`,
        phone: `+91920000000${index}`,
        employeeId: `M-EXP-${index}`,
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      })),
    );

    await MaidProfile.create(
      scheduledMaids.map((maidUser, index) => ({
        user: maidUser._id,
        activeStatus: 'active',
        isAvailable: true,
        isOnline: true,
        isIdentityVerified: true,
        lastLocationUpdatedAt: new Date(),
        currentLocation: {
          type: 'Point',
          coordinates: [baseLocation.lng + (index < 5 ? index * 0.001 : 0.07), baseLocation.lat],
        },
        lastLocation: {
          lat: baseLocation.lat,
          lng: baseLocation.lng + (index < 5 ? index * 0.001 : 0.07),
          lastUpdated: new Date(),
        },
      })),
    );
    await MaidProfile.syncIndexes();

    const scheduledBooking = await request(app)
      .post('/api/v1/bookings')
      .set(auth(customerToken))
      .send({
        serviceId: service._id,
        duration: 60,
        bookingType: 'scheduled',
        scheduleDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        address,
        location: baseLocation,
      });
    expect(scheduledBooking.status).toBe(201);

    const paymentStart = await request(app)
      .post('/api/v1/payments/initiate')
      .set(auth(customerToken))
      .send({ bookingId: scheduledBooking.body.data.booking._id, method: 'upi' });
    const paymentVerify = await request(app)
      .post('/api/v1/payments/verify')
      .set(auth(customerToken))
      .send({ paymentId: paymentStart.body.data.paymentId, mock: true });
    expect(paymentVerify.status).toBe(200);

    for (let index = 0; index < 5; index += 1) {
      const response = await request(app)
        .post(`/api/v1/bookings/${scheduledBooking.body.data.booking._id}/respond?action=reject`)
        .set(auth(tokenFor(scheduledMaids[index])))
        .send({});
      expect(response.status).toBe(200);
    }

    const expanded = await Booking.findById(scheduledBooking.body.data.booking._id);
    expect(expanded.status).toBe('searching');
    expect(expanded.searchRadiusMeters).toBe(10000);
    expect(expanded.matchingQueue.map((entry) => entry.maidId.toString())).toEqual([
      String(scheduledMaids[5]._id),
    ]);

    const adminNotifications = await request(app)
      .get('/api/v1/admin/notifications?unreadOnly=true')
      .set(auth(adminToken));
    expect(adminNotifications.status).toBe(200);
    const dispatchAlert = adminNotifications.body.data.notifications.find(
      (notification) =>
        notification.meta?.alertType === 'scheduled_first_broadcast_failed' &&
        String(notification.meta?.bookingId) === String(scheduledBooking.body.data.booking._id),
    );
    expect(dispatchAlert).toBeDefined();
    expect(dispatchAlert.meta.urgency).toBe('urgent');

    const markRead = await request(app)
      .patch(`/api/v1/admin/notifications/${dispatchAlert._id}/read`)
      .set(auth(adminToken))
      .send({});
    expect(markRead.status).toBe(200);
    expect(markRead.body.data.notification.isRead).toBe(true);
  });

  it('returns the backend-configured commercial booking estimate', async () => {
    const estimate = await request(app)
      .post('/api/v1/bookings/estimate')
      .set(auth(customerToken))
      .send({ serviceId: service._id, duration: 60 });

    expect(estimate.status).toBe(200);
    expect(estimate.body.data).toMatchObject({
      subtotal: 1000,
      platformFee: 29,
      gstPercent: 9,
      gst: 90,
      totalAmount: 1119,
      estimatedTime: 60,
    });
  });

  it('covers services, cart, booking, promo, and payment APIs', async () => {
    const services = await request(app).get('/api/v1/services');
    expect(services.status).toBe(200);

    const policy = await request(app).get('/api/v1/services/policy');
    expect(policy.status).toBe(200);

    const timeEstimate = await request(app).get(
      `/api/v1/services/estimate?items=${encodeURIComponent(service.name)}`,
    );
    expect(timeEstimate.status).toBe(200);
    expect(timeEstimate.body.data.estimatedTimeMinutes).toBe(service.estimatedTime);

    const serviceDetail = await request(app).get(`/api/v1/services/${service._id}`);
    expect(serviceDetail.status).toBe(200);

    const createdService = await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .field('name', 'E2E Add-on Service')
      .field('description', 'Created by E2E admin')
      .field('category', 'Add-on')
      .field('price', '300')
      .field('estimatedTime', '20')
      .field('status', 'active')
      .field('whatsIncluded', JSON.stringify(['Dust accessible furniture']))
      .field('doesNotInclude', JSON.stringify(['Deep stain removal']))
      .field(
        'howItsDone',
        JSON.stringify([{ title: 'Dusting', description: 'Accessible surfaces are dusted.' }]),
      )
      .field('faqs', JSON.stringify([{ question: 'Is this an add-on?', answer: 'Yes.' }]))
      .attach('image', Buffer.from('service-image'), {
        filename: 'service.jpg',
        contentType: 'image/jpeg',
      });
    expect(createdService.status).toBe(201);
    expect(createdService.body.data.service.image).toContain(
      'cloudinary.com/test/zaffabit/services',
    );
    expect(createdService.body.data.service.imagePublicId).toContain('zaffabit/services');
    expect(createdService.body.data.service.whatsIncluded).toEqual(['Dust accessible furniture']);
    expect(createdService.body.data.service.howItsDone[0].title).toBe('Dusting');
    expect(createdService.body.data.service.faqs[0].question).toBe('Is this an add-on?');
    const addOnServiceId = createdService.body.data.service._id;

    const updatedService = await request(app)
      .put(`/api/v1/services/${addOnServiceId}`)
      .set(auth(adminToken))
      .field('price', '350')
      .field(
        'howItsDone',
        JSON.stringify([
          { title: 'Final check', description: 'Work is inspected before completion.' },
        ]),
      )
      .attach('image', Buffer.from('service-image-replacement'), {
        filename: 'service-replacement.jpg',
        contentType: 'image/jpeg',
      });
    expect(updatedService.status).toBe(200);
    expect(updatedService.body.data.service.price).toBe(350);
    expect(updatedService.body.data.service.image).toContain(
      'cloudinary.com/test/zaffabit/services',
    );
    expect(updatedService.body.data.service.howItsDone[0].title).toBe('Final check');

    const cart = await request(app).get('/api/v1/cart').set(auth(customerToken));
    expect(cart.status).toBe(200);

    const addCart = await request(app)
      .post('/api/v1/cart/items')
      .set(auth(customerToken))
      .send({ serviceId: service._id, duration: 60 });
    expect(addCart.status).toBe(200);

    const updateCart = await request(app)
      .put(`/api/v1/cart/items/${service._id}`)
      .set(auth(customerToken))
      .send({ duration: 90 });
    expect(updateCart.status).toBe(200);

    const fromCart = await request(app)
      .post('/api/v1/bookings/from-cart')
      .set(auth(customerToken))
      .send({ bookingType: 'instant', address, location: { lat: 10.0159, lng: 76.3419 } });
    expect(fromCart.status).toBe(201);

    // Test direct addCartItem POST /api/v1/cart/items/:itemId
    const directAdd = await request(app)
      .post(`/api/v1/cart/items/${service._id}`)
      .set(auth(customerToken))
      .send({ duration: 60 });
    expect(directAdd.status).toBe(200);
    expect(directAdd.body.data.cart.serviceCart[0].service._id).toBe(String(service._id));

    // Test direct removeCartItem DELETE /api/v1/cart/items/:itemId
    const directRemove = await request(app)
      .delete(`/api/v1/cart/items/${service._id}`)
      .set(auth(customerToken));
    expect(directRemove.status).toBe(200);
    expect(directRemove.body.data.cart.serviceCart).toHaveLength(0);

    await request(app)
      .post('/api/v1/cart/items')
      .set(auth(customerToken))
      .send({ serviceId: service._id, duration: 60 });

    const clearedCart = await request(app).delete('/api/v1/cart').set(auth(customerToken));
    expect(clearedCart.status).toBe(200);

    const directBooking = await request(app)
      .post('/api/v1/bookings')
      .set(auth(customerToken))
      .send({
        serviceId: service._id,
        duration: 60,
        bookingType: 'instant',
        address,
        location: { lat: 10.0159, lng: 76.3419 },
      });
    expect(directBooking.status).toBe(201);
    bookingId = directBooking.body.data.booking._id;

    const bookingEstimate = await request(app)
      .post('/api/v1/bookings/estimate')
      .set(auth(customerToken))
      .send({ serviceId: service._id, duration: 60 });
    expect(bookingEstimate.status).toBe(200);
    expect(bookingEstimate.body.data.estimatedTime).toBe(60);
    expect(bookingEstimate.body.data).toMatchObject({
      subtotal: 1000,
      platformFee: 29,
      gstPercent: 9,
      gst: 90,
      totalAmount: 1119,
    });

    const bookings = await request(app).get('/api/v1/bookings').set(auth(customerToken));
    expect(bookings.status).toBe(200);

    const bookingDetail = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set(auth(customerToken));
    expect(bookingDetail.status).toBe(200);

    const promo = await request(app)
      .post('/api/v1/promotions/validate')
      .set(auth(customerToken))
      .send({ code: 'E2E25', bookingAmount: 1000 });
    expect(promo.status).toBe(200);

    const paymentStart = await request(app)
      .post('/api/v1/payments/initiate')
      .set(auth(customerToken))
      .send({ bookingId });
    expect(paymentStart.status).toBe(200);
    paymentId = paymentStart.body.data.paymentId;
    const orderId = paymentStart.body.data.order.id;
    const razorpayPaymentId = 'pay_e2e_001';
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${razorpayPaymentId}`)
      .digest('hex');

    const paymentVerify = await request(app)
      .post('/api/v1/payments/verify')
      .set(auth(customerToken))
      .send({
        paymentId,
        razorpayOrderId: orderId,
        razorpayPaymentId,
        razorpaySignature: signature,
      });
    expect(paymentVerify.status).toBe(200);
    expect(paymentVerify.body.data.checkoutState).toBe('success_pending_assignment');

    const deletedService = await request(app)
      .delete(`/api/v1/services/${addOnServiceId}`)
      .set(auth(adminToken));
    expect(deletedService.status).toBe(200);
  });

  it('covers admin controls used by the React panel and backend-only admin APIs', async () => {
    const dashboard = await request(app).get('/api/v1/admin/dashboard').set(auth(adminToken));
    expect(dashboard.status).toBe(200);

    const users = await request(app).get('/api/v1/admin/users?role=maid').set(auth(adminToken));
    expect(users.status).toBe(200);

    const updateUser = await request(app)
      .put(`/api/v1/admin/users/${customer._id}`)
      .set(auth(adminToken))
      .send({ firstName: 'Updated', lastName: 'Customer' });
    expect(updateUser.status).toBe(200);

    const status = await request(app)
      .patch(`/api/v1/admin/users/${customer._id}/status`)
      .set(auth(adminToken))
      .send({ activeStatus: 'active' });
    expect(status.status).toBe(200);

    const zone = await request(app)
      .post('/api/v1/admin/zones/config')
      .set(auth(adminToken))
      .send({ zoneName: 'Kochi Central', allowedPincodes: ['682001'] });
    expect(zone.status).toBe(200);

    const sentiment = await request(app)
      .get('/api/v1/admin/reports/sentiment')
      .set(auth(adminToken));
    expect(sentiment.status).toBe(200);

    const financial = await request(app)
      .get('/api/v1/admin/reports/financial')
      .set(auth(adminToken));
    expect(financial.status).toBe(200);

    const campaigns = await request(app)
      .get('/api/v1/admin/reports/campaigns')
      .set(auth(adminToken));
    expect(campaigns.status).toBe(200);

    const verifications = await request(app)
      .get('/api/v1/admin/verifications/pending')
      .set(auth(adminToken));
    expect(verifications.status).toBe(200);

    const approval = await request(app)
      .patch(`/api/v1/admin/verifications/${maidProfile._id}/approve`)
      .set(auth(adminToken))
      .send({ isIdentityVerified: true });
    expect(approval.status).toBe(200);

    const settlements = await request(app)
      .get('/api/v1/admin/finance/settlements')
      .set(auth(adminToken));
    expect(settlements.status).toBe(200);

    const release = await request(app)
      .post(`/api/v1/admin/finance/settlements/${maid._id}/release`)
      .set(auth(adminToken))
      .send({});
    expect(release.status).toBe(200);

    const recent = await request(app).get('/api/v1/admin/bookings/recent').set(auth(adminToken));
    expect(recent.status).toBe(200);

    const assigned = await request(app)
      .patch(`/api/v1/admin/bookings/${bookingId}/assign`)
      .set(auth(adminToken))
      .send({ maidId: maid._id });
    expect(assigned.status).toBe(200);

    const bookingUpdate = await request(app)
      .put(`/api/v1/admin/bookings/${bookingId}`)
      .set(auth(adminToken))
      .send({ totalAmount: 1200 });
    expect(bookingUpdate.status).toBe(200);

    const bookingStatus = await request(app)
      .patch(`/api/v1/admin/bookings/${bookingId}/status`)
      .set(auth(adminToken))
      .send({ status: 'accepted' });
    expect(bookingStatus.status).toBe(200);

    const adminPayments = await request(app).get('/api/v1/admin/payments').set(auth(adminToken));
    expect(adminPayments.status).toBe(200);

    const manualPayment = await request(app)
      .post('/api/v1/admin/payments')
      .set(auth(adminToken))
      .send({
        bookingId,
        customerId: customer._id,
        amount: 400,
        method: 'upi',
        status: 'captured',
      });
    expect(manualPayment.status).toBe(201);
    const manualPaymentId = manualPayment.body.data._id;

    const editedPayment = await request(app)
      .put(`/api/v1/admin/payments/${manualPaymentId}`)
      .set(auth(adminToken))
      .send({ amount: 450, status: 'captured' });
    expect(editedPayment.status).toBe(200);

    const refunds = await request(app).get('/api/v1/admin/finance/refunds').set(auth(adminToken));
    expect(refunds.status).toBe(200);

    const refund = await request(app)
      .post('/api/v1/admin/finance/refunds')
      .set(auth(adminToken))
      .send({
        paymentId: manualPaymentId,
        customerId: customer._id,
        amount: 100,
        reason: 'E2E refund',
      });
    expect(refund.status).toBe(201);

    const refundUpdate = await request(app)
      .put(`/api/v1/admin/finance/refunds/${manualPaymentId}`)
      .set(auth(adminToken))
      .send({ status: 'Approved', refundReason: 'Resolved by E2E' });
    expect(refundUpdate.status).toBe(200);

    const refundClear = await request(app)
      .delete(`/api/v1/admin/finance/refunds/${manualPaymentId}`)
      .set(auth(adminToken));
    expect(refundClear.status).toBe(200);

    const paymentDelete = await request(app)
      .delete(`/api/v1/admin/payments/${manualPaymentId}`)
      .set(auth(adminToken));
    expect(paymentDelete.status).toBe(200);

    const wallets = await request(app).get('/api/v1/admin/wallets').set(auth(adminToken));
    expect(wallets.status).toBe(200);

    const walletAdjust = await request(app)
      .post(`/api/v1/admin/wallets/${customer._id}/adjust`)
      .set(auth(adminToken))
      .send({ amount: 50, type: 'credit', reason: 'E2E credit' });
    expect(walletAdjust.status).toBe(200);

    const createPromotion = await request(app)
      .post('/api/v1/admin/promotions')
      .set(auth(adminToken))
      .send({ code: 'E2E10', description: 'E2E flat promo', type: 'flat', discountValue: 10 });
    expect(createPromotion.status).toBe(201);
    promoId = createPromotion.body.data.promotion._id;

    const promotions = await request(app).get('/api/v1/admin/promotions').set(auth(adminToken));
    expect(promotions.status).toBe(200);

    const exportUsers = await request(app)
      .get('/api/v1/admin/export/users?format=json')
      .set(auth(adminToken));
    expect(exportUsers.status).toBe(200);
    expect(exportUsers.body.meta.export.csvStreamingAvailable).toBe(true);

    const exportUsersCsv = await request(app)
      .get('/api/v1/admin/export/users?format=csv')
      .set(auth(adminToken));
    expect(exportUsersCsv.status).toBe(200);
    expect(exportUsersCsv.headers['content-type']).toMatch(/text\/csv/);
    expect(exportUsersCsv.text).toContain('_id');

    const logs = await request(app).get('/api/v1/admin/activity-logs').set(auth(adminToken));
    expect(logs.status).toBe(200);

    const clearLogs = await request(app)
      .delete('/api/v1/admin/activity-logs')
      .set(auth(adminToken));
    expect(clearLogs.status).toBe(200);

    const heatmap = await request(app)
      .get('/api/v1/admin/geo-heatmap?resolution=7&metric=count&status=all')
      .set(auth(adminToken));
    expect(heatmap.status).toBe(200);
  });

  it('covers maid onboarding, profile, jobs, notifications, and job lifecycle APIs', async () => {
    const onboardingStatus = await request(app)
      .get('/api/v1/maids/onboarding/status')
      .set(auth(maidToken));
    expect(onboardingStatus.status).toBe(200);

    const onboardingSelfie = await request(app)
      .post('/api/v1/maids/onboarding/selfie')
      .set(auth(maidToken))
      .attach('selfie', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg',
      });
    expect(onboardingSelfie.status).toBe(200);

    const jobType = await request(app)
      .post('/api/v1/maids/onboarding/job-type')
      .set(auth(maidToken))
      .send({ jobType: 'full_time', language: 'en' });
    expect(jobType.status).toBe(200);

    const workAreas = await request(app)
      .post('/api/v1/maids/onboarding/work-areas')
      .set(auth(maidToken))
      .send({ workAreas: ['Kakkanad', 'Vyttila'] });
    expect(workAreas.status).toBe(200);

    const confirm = await request(app)
      .post('/api/v1/maids/onboarding/confirm')
      .set(auth(maidToken))
      .send({});
    expect(confirm.status).toBe(200);

    const documents = await request(app)
      .post('/api/v1/maids/documents')
      .set(auth(maidToken))
      .field('type', 'ID_PROOF')
      .attach('document', Buffer.from('%PDF-1.4\n% E2E\n'), {
        filename: 'id-proof.pdf',
        contentType: 'application/pdf',
      });
    expect(documents.status).toBe(200);

    const selfie = await request(app)
      .post('/api/v1/maids/selfie')
      .set(auth(maidToken))
      .attach('selfie', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        filename: 'profile-selfie.jpg',
        contentType: 'image/jpeg',
      });
    expect(selfie.status).toBe(200);

    const availability = await request(app)
      .patch('/api/v1/maids/availability')
      .set(auth(maidToken))
      .send({});
    expect(availability.status).toBe(200);

    const dashboard = await request(app).get('/api/v1/maids/dashboard').set(auth(maidToken));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.maid.avatarUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/uploads\/selfies\//,
    );
    expect(dashboard.body.data.maid.photoUrl).toBe(dashboard.body.data.maid.avatarUrl);

    const myJobs = await request(app)
      .get('/api/v1/maids/my-jobs?tab=upcoming')
      .set(auth(maidToken));
    expect(myJobs.status).toBe(200);
    const upcomingJob = myJobs.body.data.jobs.find((job) => job.bookingId === bookingId.toString());
    expect(upcomingJob.location).toEqual({ lat: 10.0159, lng: 76.3419 });

    const jobs = await request(app).get('/api/v1/maids/jobs').set(auth(maidToken));
    expect(jobs.status).toBe(200);

    const earnings = await request(app).get('/api/v1/maids/earnings').set(auth(maidToken));
    expect(earnings.status).toBe(200);

    const support = await request(app).get('/api/v1/maids/support').set(auth(maidToken));
    expect(support.status).toBe(200);

    const wallet = await request(app).get('/api/v1/maids/wallet').set(auth(maidToken));
    expect(wallet.status).toBe(200);

    const referral = await request(app).get('/api/v1/maids/referral-info').set(auth(maidToken));
    expect(referral.status).toBe(200);

    const profile = await request(app).get('/api/v1/maids/profile-info').set(auth(maidToken));
    expect(profile.status).toBe(200);

    const profileUpdate = await request(app)
      .put('/api/v1/maids/profile-info')
      .set(auth(maidToken))
      .send({ firstName: 'Sita', lastName: 'E2E', phone: '+919000000303', language: 'ml' });
    expect(profileUpdate.status).toBe(200);

    const legacyProfile = await request(app)
      .put('/api/v1/maids/profile')
      .set(auth(maidToken))
      .send({ name: 'Sita Legacy', zone: 'Kochi-East' });
    expect(legacyProfile.status).toBe(200);

    const startOtp = await request(app)
      .post(`/api/v1/bookings/${bookingId}/start-otp`)
      .set(auth(maidToken));
    expect(startOtp.status).toBe(200);
    const dynamicOtp = startOtp.body.data.otp;

    const startJob = await request(app)
      .post(`/api/v1/bookings/${bookingId}/verify-start`)
      .set(auth(maidToken))
      .send({ otp: dynamicOtp });
    expect(startJob.status).toBe(200);

    const activeJob = await request(app).get('/api/v1/maids/active-job').set(auth(maidToken));
    expect(activeJob.status).toBe(200);

    const checklist = await request(app)
      .patch(`/api/v1/bookings/${bookingId}/checklist/0`)
      .set(auth(maidToken))
      .send({ isDone: true });
    expect(checklist.status).toBe(200);

    const extraTime = await request(app)
      .post(`/api/v1/bookings/${bookingId}/extra-time`)
      .set(auth(maidToken))
      .send({ minutes: 30, cost: 200, note: 'More cleaning needed' });
    expect(extraTime.status).toBe(200);

    const approveExtra = await request(app)
      .post(`/api/v1/bookings/${bookingId}/approve-extra`)
      .set(auth(customerToken))
      .send({ approved: true });
    expect(approveExtra.status).toBe(200);

    const extraStatus = await request(app)
      .get('/api/v1/maids/active-job/extra-time-status')
      .set(auth(maidToken));
    expect(extraStatus.status).toBe(200);

    const notifications = await request(app)
      .get('/api/v1/maids/notifications')
      .set(auth(maidToken));
    expect(notifications.status).toBe(200);
    const notification = notifications.body.data.notifications[0];
    if (notification) {
      const readOne = await request(app)
        .patch(`/api/v1/maids/notifications/${notification._id}/read`)
        .set(auth(maidToken))
        .send({});
      expect(readOne.status).toBe(200);
    }

    const readAll = await request(app)
      .patch('/api/v1/maids/notifications/read-all')
      .set(auth(maidToken))
      .send({});
    expect(readAll.status).toBe(200);

    const complete = await request(app)
      .post(`/api/v1/bookings/${bookingId}/complete`)
      .set(auth(maidToken))
      .send({});
    expect(complete.status).toBe(200);

    const completed = await Booking.findById(bookingId);
    expect(completed.status).toBe('completed');
  });

  it('covers reviews, support tickets, incidents, campaigns, agents, and cleanup APIs', async () => {
    const review = await request(app)
      .post('/api/v1/reviews')
      .set(auth(customerToken))
      .send({
        bookingId,
        rating: 5,
        review: 'Excellent professional clean service',
        tags: ['Punctual', 'Thorough'],
      });
    expect(review.status).toBe(201);
    reviewId = review.body.data.review._id;

    const maidReviews = await request(app).get('/api/v1/reviews/me').set(auth(maidToken));
    expect(maidReviews.status).toBe(200);

    const publicMaidReviews = await request(app)
      .get(`/api/v1/reviews/maid/${maid._id}`)
      .set(auth(customerToken));
    expect(publicMaidReviews.status).toBe(200);

    const issue = await request(app)
      .post('/api/v1/reviews/issue')
      .set(auth(customerToken))
      .send({ bookingId, issueDescription: 'Need invoice correction' });
    expect(issue.status).toBe(200);

    const adminReviews = await request(app).get('/api/v1/reviews/admin').set(auth(adminToken));
    expect(adminReviews.status).toBe(200);
    const targetReview = adminReviews.body.data.reviews.find((r) => r.isIssueRaised);
    const targetReviewId = targetReview ? targetReview._id : reviewId;

    const issueResolved = await request(app)
      .patch(`/api/v1/reviews/issue/${targetReviewId}/resolve`)
      .set(auth(adminToken))
      .send({ resolutionNotes: 'Resolved by E2E admin' });
    expect(issueResolved.status).toBe(200);

    const helplines = await request(app).get('/api/v1/support/helplines').set(auth(customerToken));
    expect(helplines.status).toBe(200);

    const contact = await request(app)
      .post('/api/v1/support/contact')
      .set(auth(customerToken))
      .send({ subject: 'E2E support', message: 'Please contact me' });
    expect(contact.status).toBe(200);
    expect(contact.body.data.ticket).toBeTruthy();
    expect(contact.body.data.ticket.title).toBe('E2E support');
    expect(contact.body.data.ticket.messages[0].content).toBe('Please contact me');

    const aiChat = await request(app)
      .post('/api/v1/support/ai-chat')
      .set(auth(customerToken))
      .send({ message: 'How do refunds work?' });
    expect(aiChat.status).toBe(200);
    expect(aiChat.body.data.conversationId).toBeTruthy();

    const aiChatHistory = await request(app)
      .get(`/api/v1/support/ai-chat/${aiChat.body.data.conversationId}`)
      .set(auth(customerToken));
    expect(aiChatHistory.status).toBe(200);
    expect(aiChatHistory.body.data.messages.length).toBe(2);

    const sosCoords = await request(app)
      .post('/api/v1/support/sos')
      .set(auth(customerToken))
      .send({ latitude: 12.345, longitude: 67.89 });
    expect(sosCoords.status).toBe(200);
    expect(sosCoords.body.data.incident.location).toContain('12.345');
    expect(sosCoords.body.data.incident.location).toContain('67.89');

    const sosBooking = await request(app)
      .post('/api/v1/support/sos')
      .set(auth(customerToken))
      .send({});
    expect(sosBooking.status).toBe(200);
    expect(sosBooking.body.data.incident.location).not.toBe('Active Mobile GPS Tracker');

    const tickets = await request(app).get('/api/v1/admin/support/tickets').set(auth(adminToken));
    expect(tickets.status).toBe(200);

    const reply = await request(app)
      .post(`/api/v1/admin/support/tickets/${supportTicketId}/reply`)
      .set(auth(adminToken))
      .send({ content: 'Support reply from E2E.' });
    expect(reply.status).toBe(200);

    const resolveTicket = await request(app)
      .patch(`/api/v1/admin/support/tickets/${supportTicketId}/resolve`)
      .set(auth(adminToken))
      .send({});
    expect(resolveTicket.status).toBe(200);

    const incidents = await request(app).get('/api/v1/admin/incidents').set(auth(adminToken));
    expect(incidents.status).toBe(200);

    const resolveIncident = await request(app)
      .patch(`/api/v1/admin/incidents/${incidentId}/resolve`)
      .set(auth(adminToken))
      .send({});
    expect(resolveIncident.status).toBe(200);

    const campaign = await request(app)
      .post('/api/v1/notifications/campaign')
      .set(auth(adminToken))
      .send({ title: 'E2E Campaign', message: 'Hello from tests', recipientType: 'customers' });
    expect(campaign.status).toBe(201);

    const logs = await request(app).get('/api/v1/notifications/logs').set(auth(adminToken));
    expect(logs.status).toBe(200);

    const agentProfile = await request(app).get('/api/v1/agents/me').set(auth(agentToken));
    expect(agentProfile.status).toBe(200);

    const agentReferrals = await request(app).get('/api/v1/agents/referrals').set(auth(agentToken));
    expect(agentReferrals.status).toBe(200);

    const agents = await request(app).get('/api/v1/agents').set(auth(adminToken));
    expect(agents.status).toBe(200);

    const extraAgentUser = await User.create({
      name: 'Second Agent',
      email: 'agent-two.e2e@zaffabit.test',
      phone: '+919000000006',
      password: 'Password123',
      role: 'agent',
      isVerified: true,
    });
    const registeredAgent = await request(app)
      .post('/api/v1/agents/register')
      .set(auth(adminToken))
      .send({
        userId: extraAgentUser._id,
        name: 'Second Agent',
        email: 'agent-two.e2e@zaffabit.test',
        phone: '+919000000006',
        agentCode: 'AG-E2E-2',
        zone: 'Kochi',
        commissionRate: 4,
      });
    expect(registeredAgent.status).toBe(201);

    const maidReferralApply = await request(app)
      .post('/api/v1/maids/referral/apply')
      .set(auth(maidToken))
      .send({ referralCode: referrer.referralCode });
    expect(maidReferralApply.status).toBe(200);

    const respondBooking = await Booking.create({
      customer: customer._id,
      service: service._id,
      items: [{ service: service._id, name: service.name, price: 1000, duration: 60 }],
      subtotal: 1000,
      platformFee: 29,
      gst: 90,
      totalAmount: 1119,
      address,
      scheduleDate: new Date(),
      bookingType: 'instant',
      status: 'pending',
    });
    const responded = await request(app)
      .post(`/api/v1/bookings/${respondBooking._id}/respond?action=accept`)
      .set(auth(maidToken))
      .send({});
    expect(responded.status).toBe(200);

    const cancellableBooking = await Booking.create({
      customer: customer._id,
      service: service._id,
      items: [{ service: service._id, name: service.name, price: 500, duration: 30 }],
      subtotal: 500,
      platformFee: 29,
      gst: 45,
      totalAmount: 574,
      address,
      scheduleDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      bookingType: 'scheduled',
      status: 'pending',
    });
    const cancelled = await request(app)
      .post(`/api/v1/bookings/${cancellableBooking._id}/cancel`)
      .set(auth(customerToken))
      .send({});
    expect(cancelled.status).toBe(200);

    const pendingPayment = await Payment.create({
      booking: bookingId,
      customer: customer._id,
      amount: 250,
      status: 'pending',
      method: 'upi',
    });
    const reminder = await request(app)
      .post(`/api/v1/payments/reminder/${pendingPayment._id}`)
      .set(auth(adminToken))
      .send({});
    expect(reminder.status).toBe(200);

    const refundPayment = await request(app)
      .post(`/api/v1/payments/refund/${pendingPayment._id}`)
      .set(auth(adminToken))
      .send({});
    expect(refundPayment.status).toBe(200);

    const deletePromotion = await request(app)
      .delete(`/api/v1/admin/promotions/${promoId}`)
      .set(auth(adminToken));
    expect(deletePromotion.status).toBe(200);

    const staleBooking = await Booking.create({
      customer: customer._id,
      maid: maid._id,
      service: service._id,
      items: [{ service: service._id, name: service.name, price: 100, duration: 10 }],
      subtotal: 100,
      platformFee: 29,
      gst: 9,
      totalAmount: 138,
      address,
      scheduleDate: new Date(),
      bookingType: 'instant',
      status: 'pending',
    });

    const deletedBooking = await request(app)
      .delete(`/api/v1/admin/bookings/${staleBooking._id}`)
      .set(auth(adminToken));
    expect(deletedBooking.status).toBe(200);

    const disposableMaid = await User.create({
      name: 'Disposable Maid',
      email: 'disposable-maid.e2e@zaffabit.test',
      phone: '+919000000007',
      password: 'Password123',
      role: 'maid',
      isVerified: true,
    });
    await MaidProfile.create({ user: disposableMaid._id });
    const deletedMaid = await request(app)
      .delete(`/api/v1/admin/maids/${disposableMaid._id}`)
      .set(auth(adminToken));
    expect(deletedMaid.status).toBe(200);

    const disposableAdmin = await request(app)
      .post('/api/v1/admin/users/create-admin')
      .set(auth(adminToken))
      .send({
        firstName: 'Disposable',
        lastName: 'Admin',
        email: 'disposable-admin.e2e@zaffabit.test',
        password: 'Password123',
        phone: '+919000000008',
      });
    expect(disposableAdmin.status).toBe(201);

    const adminId = disposableAdmin.body.data._id || disposableAdmin.body.data.id;
    const deletedAdmin = await request(app)
      .delete(`/api/v1/admin/users/${adminId}`)
      .set(auth(adminToken));
    expect(deletedAdmin.status).toBe(200);
  });
});
