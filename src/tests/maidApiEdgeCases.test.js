process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
process.env.DISABLE_DEV_AUTH_FALLBACK = 'true';

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const app = require('../app');
const Booking = require('../models/Booking');
const MaidProfile = require('../models/MaidProfile');
const Notification = require('../models/Notification');
const Service = require('../models/Service');
const User = require('../models/User');

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

describe('Maid API edge cases and user cases', () => {
  let mongo;
  let customer;
  let customerToken;
  let maid;
  let maidToken;
  let maidProfile;
  let noProfileMaid;
  let noProfileMaidToken;
  let service;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    [customer, maid, noProfileMaid] = await User.create([
      {
        firstName: 'Customer',
        lastName: 'Edge',
        name: 'Customer Edge',
        email: 'customer.edge@zaffabit.test',
        phone: '+919100000001',
        password: 'Password123',
        role: 'customer',
        isVerified: true,
      },
      {
        firstName: 'Maid',
        lastName: 'Edge',
        name: 'Maid Edge',
        email: 'maid.edge@zaffabit.test',
        phone: '+919100000002',
        employeeId: 'M-EDGE-001',
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      },
      {
        firstName: 'NoProfile',
        lastName: 'Maid',
        name: 'NoProfile Maid',
        email: 'maid.no-profile@zaffabit.test',
        phone: '+919100000003',
        employeeId: 'M-EDGE-002',
        password: 'Password123',
        role: 'maid',
        isVerified: true,
      },
    ]);

    maidProfile = await MaidProfile.create({
      user: maid._id,
      activeStatus: 'active',
      isIdentityVerified: true,
      isAvailable: false,
      isOnline: false,
      rating: 4.6,
      reviewCount: 3,
      referralIncentives: 120,
    });
    maid.maidProfile = maidProfile._id;
    await maid.save();

    service = await Service.create({
      name: 'Edge Deep Cleaning',
      description: 'Edge test service',
      category: 'Deep Cleaning',
      price: 500,
      estimatedTime: 60,
      status: 'active',
    });

    customerToken = tokenFor(customer);
    maidToken = tokenFor(maid);
    noProfileMaidToken = tokenFor(noProfileMaid);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongo.stop();
    delete process.env.DISABLE_DEV_AUTH_FALLBACK;
  });

  it('protects maid-only APIs from anonymous users and customers', async () => {
    const anonymous = await request(app)
      .patch('/api/v1/maids/availability')
      .send({ isAvailable: true });
    expect(anonymous.status).toBe(401);

    const customerAvailability = await request(app)
      .patch('/api/v1/maids/availability')
      .set(auth(customerToken))
      .send({ isAvailable: true });
    expect(customerAvailability.status).toBe(403);
    expect(customerAvailability.body.error.code).toBe('FORBIDDEN');

    const customerLocation = await request(app)
      .patch('/api/v1/maids/location')
      .set(auth(customerToken))
      .send({ lat: 10.0159, lng: 76.3419 });
    expect(customerLocation.status).toBe(403);
    expect(customerLocation.body.error.code).toBe('FORBIDDEN');
  });

  it('returns clear not-found errors when a maid account has no maid profile', async () => {
    const availability = await request(app)
      .patch('/api/v1/maids/availability')
      .set(auth(noProfileMaidToken))
      .send({ isAvailable: true });
    expect(availability.status).toBe(404);
    expect(availability.body.message).toBe('Maid profile not found');

    const location = await request(app)
      .patch('/api/v1/maids/location')
      .set(auth(noProfileMaidToken))
      .send({ lat: 10.0159, lng: 76.3419 });
    expect(location.status).toBe(404);
    expect(location.body.message).toBe('Maid profile not found');
  });

  it('validates live location coordinates before updating tracking state', async () => {
    const invalid = await request(app)
      .patch('/api/v1/maids/location')
      .set(auth(maidToken))
      .send({ lat: 'not-a-number', lng: 76.3419 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const unchanged = await MaidProfile.findById(maidProfile._id);
    expect(unchanged.lastLocationUpdatedAt).toBeFalsy();
    expect(unchanged.currentLocation?.coordinates).toBeUndefined();
  });

  it('allows requests toggle ON during an accepted job while keeping live location tracking active', async () => {
    await Booking.create({
      customer: customer._id,
      maid: maid._id,
      service: service._id,
      items: [{ service: service._id, name: 'Edge Deep Cleaning', price: 500, duration: 60 }],
      subtotal: 500,
      platformFee: 0,
      totalAmount: 500,
      scheduleDate: new Date(Date.now() + 15 * 60 * 1000),
      bookingType: 'scheduled',
      status: 'accepted',
      paymentStatus: 'paid',
      estimatedTime: 60,
      location: { lat: 10.0159, lng: 76.3419 },
    });

    const availability = await request(app)
      .patch('/api/v1/maids/availability')
      .set(auth(maidToken))
      .send({ isAvailable: true });
    expect(availability.status).toBe(200);
    expect(availability.body.data.isAvailable).toBe(true);

    const location = await request(app)
      .patch('/api/v1/maids/location')
      .set(auth(maidToken))
      .send({ lat: 9.932, lng: 76.268, isAvailable: true });
    expect(location.status).toBe(200);
    expect(location.body.data.location).toEqual({ lat: 9.932, lng: 76.268 });
    expect(location.body.data.isAvailable).toBe(true);

    const updated = await MaidProfile.findById(maidProfile._id);
    expect(updated.isOnline).toBe(true);
    expect(updated.isAvailable).toBe(true);
    expect(updated.currentLocation.coordinates).toEqual([76.268, 9.932]);
  });

  it('returns an empty but shaped earnings dashboard when the maid has no completed jobs', async () => {
    await Booking.deleteMany({ maid: maid._id, status: 'completed' });

    const earnings = await request(app).get('/api/v1/maids/earnings').set(auth(maidToken));
    expect(earnings.status).toBe(200);
    expect(earnings.body.data.summary).toMatchObject({
      totalEarnings: 0,
      totalJobs: 0,
      referralIncentives: 120,
      totalPayout: 120,
      currency: 'INR',
    });
    expect(earnings.body.data.thisWeek).toMatchObject({
      earnings: 0,
      jobs: 0,
      changeLabel: 'No data for last week',
      changePct: 0,
    });
    expect(earnings.body.data.weeklyTrend).toHaveLength(7);
    expect(
      earnings.body.data.weeklyTrend.every((day) => day.earnings === 0 && day.jobs === 0),
    ).toBe(true);
    expect(earnings.body.data.dailyBreakdown).toEqual([]);
  });

  it('returns targeted searching offers in the new jobs tab and customer coordinates in upcoming jobs', async () => {
    const offerBooking = await Booking.create({
      customer: customer._id,
      service: service._id,
      items: [{ service: service._id, name: 'Edge Deep Cleaning', price: 700, duration: 60 }],
      subtotal: 700,
      platformFee: 0,
      totalAmount: 700,
      scheduleDate: new Date(Date.now() + 60 * 60 * 1000),
      bookingType: 'instant',
      status: 'searching',
      paymentStatus: 'paid',
      estimatedTime: 60,
      location: { lat: 9.95, lng: 76.29 },
      matchingQueue: [
        {
          maidId: maid._id,
          etaMinutes: 8,
          distanceMeters: 1200,
          offeredAt: new Date(),
          response: 'pending',
        },
      ],
      currentQueueIndex: 0,
      offerExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
    });

    const upcomingBooking = await Booking.create({
      customer: customer._id,
      maid: maid._id,
      service: service._id,
      items: [{ service: service._id, name: 'Edge Deep Cleaning', price: 800, duration: 60 }],
      subtotal: 800,
      platformFee: 0,
      totalAmount: 800,
      scheduleDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
      bookingType: 'scheduled',
      status: 'accepted',
      paymentStatus: 'paid',
      estimatedTime: 60,
      address: { houseName: 'Apt 1', street: 'Marine Drive', city: 'Kochi' },
      location: { lat: 9.9816, lng: 76.3213 },
    });

    const newJobs = await request(app).get('/api/v1/maids/my-jobs?tab=new').set(auth(maidToken));
    expect(newJobs.status).toBe(200);
    expect(newJobs.body.data.jobs.map((job) => String(job.bookingId))).toContain(
      String(offerBooking._id),
    );

    const upcoming = await request(app)
      .get('/api/v1/maids/my-jobs?tab=upcoming')
      .set(auth(maidToken));
    expect(upcoming.status).toBe(200);
    const job = upcoming.body.data.jobs.find(
      (item) => String(item.bookingId) === String(upcomingBooking._id),
    );
    expect(job).toBeTruthy();
    expect(job.location).toEqual({ lat: 9.9816, lng: 76.3213 });
  });

  it('keeps active-job and extra-time APIs predictable when there is no ongoing job', async () => {
    await Booking.updateMany({ maid: maid._id }, { $set: { status: 'accepted' } });

    const activeJob = await request(app).get('/api/v1/maids/active-job').set(auth(maidToken));
    expect(activeJob.status).toBe(200);
    expect(activeJob.body.data.activeJob).toBeNull();

    const extraTime = await request(app)
      .get('/api/v1/maids/active-job/extra-time-status')
      .set(auth(maidToken));
    expect(extraTime.status).toBe(404);
    expect(extraTime.body.message).toBe('No active job found');
  });

  it('marks one notification and then all notifications as read', async () => {
    const notification = await Notification.create({
      recipient: maid._id,
      title: 'Edge notification',
      message: 'Please review your job update.',
      type: 'job_assigned',
    });
    await Notification.create({
      recipient: maid._id,
      title: 'Second edge notification',
      message: 'Another update.',
      type: 'general',
    });

    const readOne = await request(app)
      .patch(`/api/v1/maids/notifications/${notification._id}/read`)
      .set(auth(maidToken))
      .send({});
    expect(readOne.status).toBe(200);

    const readAll = await request(app)
      .patch('/api/v1/maids/notifications/read-all')
      .set(auth(maidToken))
      .send({});
    expect(readAll.status).toBe(200);

    const unread = await Notification.countDocuments({ recipient: maid._id, isRead: false });
    expect(unread).toBe(0);
  });
});
