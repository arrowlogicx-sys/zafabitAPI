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
const User = require('../models/User');
const MaidProfile = require('../models/MaidProfile');
const Service = require('../models/Service');
const Payment = require('../models/Payment');
const Review = require('../models/Review');

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

describe('Booking Details API', () => {
  let mongo;
  let customer;
  let customerToken;
  let maid;
  let service;
  let booking;
  let payment;
  let review;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    customer = await User.create({
      firstName: 'Customer',
      lastName: 'DetailTest',
      name: 'Customer DetailTest',
      email: 'customer.detail@zaffabit.test',
      phone: '+919100000020',
      password: 'Password123',
      role: 'customer',
      isVerified: true,
    });
    customerToken = tokenFor(customer);

    const maidUser = await User.create({
      firstName: 'Maid',
      lastName: 'DetailTest',
      name: 'Maid DetailTest',
      email: 'maid.detail@zaffabit.test',
      phone: '+919100000021',
      password: 'Password123',
      role: 'maid',
      isVerified: true,
    });

    const maidProfile = await MaidProfile.create({
      user: maidUser._id,
      rating: 4.9,
      experience: '2 years',
      completedJobs: 45,
      reviewCount: 15,
      activeStatus: 'active',
      onboardingStep: 4,
    });

    maidUser.maidProfile = maidProfile._id;
    await maidUser.save();
    maid = maidUser;

    service = await Service.create({
      name: 'Deep Cleaning',
      category: 'cleaning',
      price: 500,
      duration: 120,
      description: 'Full deep cleaning',
    });

    booking = await Booking.create({
      customer: customer._id,
      maid: maid._id,
      service: service._id,
      bookingType: 'scheduled',
      scheduleDate: new Date('2026-06-15T10:30:00.000Z'),
      status: 'completed',
      paymentStatus: 'paid',
      subtotal: 500,
      platformFee: 15,
      gstPercent: 18,
      gst: 34,
      taxAmount: 34,
      totalAmount: 549,
      estimatedTime: 120,
      totalTime: 120,
      startTime: new Date('2026-06-15T10:30:00.000Z'),
      endTime: new Date('2026-06-15T12:30:00.000Z'),
      address: {
        houseName: 'Flat 10B',
        street: 'Marine Drive',
        city: 'Kochi',
        pincode: '682031',
      },
      statusHistory: [
        { status: 'pending', timestamp: new Date('2026-06-15T10:00:00.000Z') },
        { status: 'paid_unassigned', timestamp: new Date('2026-06-15T10:02:00.000Z') },
        { status: 'accepted', timestamp: new Date('2026-06-15T10:05:00.000Z') },
        { status: 'completed', timestamp: new Date('2026-06-15T12:30:00.000Z') },
      ],
      extraTimeRequest: {
        minutes: 30,
        cost: 150,
        status: 'approved',
        note: 'Requires kitchen cleaning extension',
      },
    });

    payment = await Payment.create({
      booking: booking._id,
      customer: customer._id,
      amount: 549,
      status: 'captured',
      method: 'upi',
      razorpayPaymentId: 'pay_O1a2b3c4d5e6f7',
      razorpayOrderId: 'order_O1a2b3c4d5e6f7',
    });

    review = await Review.create({
      booking: booking._id,
      customer: customer._id,
      maid: maid._id,
      rating: 5,
      review: 'Excellent service!',
      tags: ['Thorough', 'Punctual'],
      sentiment: 'positive',
    });
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongo.stop();
    delete process.env.DISABLE_DEV_AUTH_FALLBACK;
  });

  it('retrieves detailed view of a booking with complete timelines, payments, maid profiles, times, bill details and reviews', async () => {
    const res = await request(app).get(`/api/v1/bookings/${booking._id}`).set(auth(customerToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { booking: returnedBooking, details } = res.body.data;
    expect(returnedBooking).toBeDefined();
    expect(returnedBooking._id).toBe(String(booking._id));

    expect(details).toBeDefined();
    expect(details.id).toBe(String(booking._id));
    expect(details.status).toBe('completed');
    expect(details.bookingType).toBe('scheduled');
    expect(details.address.city).toBe('Kochi');
    expect(details.address.pincode).toBe('682031');

    // Timelines assertions
    expect(details.timelines.length).toBeGreaterThanOrEqual(4);
    const createdTimeline = details.timelines.find((t) => t.status === 'pending');
    expect(createdTimeline.isCompleted).toBe(true);
    expect(createdTimeline.timestamp).toBeDefined();

    // Payment assertions
    expect(details.payment.status).toBe('paid');
    expect(details.payment.receipt).toBe('pay_O1a2b3c4d5e6f7');
    expect(details.payment.method).toBe('upi');
    expect(details.payment.amount).toBe(549);

    // Extra time assertions
    expect(details.extraTime.requested).toBe(true);
    expect(details.extraTime.minutes).toBe(30);
    expect(details.extraTime.status).toBe('approved');

    // Maid details assertions
    expect(details.maid.id).toBe(String(maid._id));
    expect(details.maid.name).toContain('Maid DetailTest');
    expect(details.maid.rating).toBe(4.9);
    expect(details.maid.completedJobs).toBe(45);

    // Times assertions
    expect(details.times.estimatedMinutes).toBe(120);
    expect(details.times.extraMinutesApproved).toBe(30);
    expect(details.times.actualDurationMinutes).toBe(120);

    // Bill details assertions
    expect(details.billDetails.subtotal).toBe(500);
    expect(details.billDetails.platformFee).toBe(15);
    expect(details.billDetails.gst).toBe(34);
    expect(details.billDetails.totalAmount).toBe(549);

    // Review assertions
    expect(details.review.isReviewed).toBe(true);
    expect(details.review.details.rating).toBe(5);
    expect(details.review.details.review).toBe('Excellent service!');
  });
});
