process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
process.env.DISABLE_DEV_AUTH_FALLBACK = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const User = require('../models/User');
const Service = require('../models/Service');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const { expireUnassignedScheduled } = require('../utils/scheduledDispatch');

describe('Scheduled Booking Auto-Refund after Timeout', () => {
  let mongo;
  let customer;
  let service;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    customer = await User.create({
      firstName: 'Refund',
      lastName: 'Customer',
      name: 'Refund Customer',
      email: 'refund.customer@zaffabit.test',
      phone: '+919100000100',
      password: 'Password123',
      role: 'customer',
      isVerified: true,
    });

    service = await Service.create({
      name: 'Standard Cleaning',
      category: 'cleaning',
      price: 400,
      duration: 60,
      description: 'Standard home cleaning',
    });
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('should automatically refund and notify the customer if a scheduled booking remains unassigned', async () => {
    // 1. Create a scheduled booking that is paid but unassigned
    const booking = await Booking.create({
      customer: customer._id,
      service: service._id,
      bookingType: 'scheduled',
      scheduleDate: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago
      status: 'admin_attention',
      paymentStatus: 'paid',
      subtotal: 400,
      platformFee: 15,
      gstPercent: 18,
      gst: 34,
      taxAmount: 34,
      totalAmount: 449,
      estimatedTime: 60,
      totalTime: 60,
      address: {
        houseName: 'Flat 1',
        street: 'Main Road',
        city: 'Kochi',
        pincode: '682031',
      },
    });

    // 2. Create the associated payment
    const payment = await Payment.create({
      booking: booking._id,
      customer: customer._id,
      amount: 449,
      status: 'captured',
      method: 'upi',
      razorpayPaymentId: 'pay_refund_test',
      razorpayOrderId: 'order_refund_test',
    });

    // 3. Trigger the expireUnassignedScheduled check
    const result = await expireUnassignedScheduled(booking._id, {
      jobId: new mongoose.Types.ObjectId(),
    });

    expect(result.success).toBe(false);
    expect(result.assignmentState).toBe('cancelled');

    // 4. Verify booking status changed to cancelled and payment status is refunded
    const updatedBooking = await Booking.findById(booking._id);
    expect(updatedBooking.status).toBe('cancelled');
    expect(updatedBooking.paymentStatus).toBe('refunded');

    // 5. Verify payment status is refunded (so it appears on refunds page)
    const updatedPayment = await Payment.findOne({ booking: booking._id });
    expect(updatedPayment.status).toBe('refunded');
    expect(updatedPayment.isRefunded).toBe(true);

    // 6. Verify user wallet balance remains unchanged (0)
    const updatedCustomer = await User.findById(customer._id);
    expect(updatedCustomer.walletBalance).toBe(0);
    expect(updatedCustomer.walletTransactions.length).toBe(0);

    // 7. Verify notification was sent to customer
    const notification = await Notification.findOne({ recipient: customer._id });
    expect(notification).toBeDefined();
    expect(notification.title).toBe('Booking cancelled');
    expect(notification.message).toContain('No maid accepted');
  });

  it('should skip refunding if the booking is already accepted/assigned', async () => {
    // 1. Create a scheduled booking that is already accepted
    const booking = await Booking.create({
      customer: customer._id,
      service: service._id,
      bookingType: 'scheduled',
      scheduleDate: new Date(Date.now() - 15 * 60 * 1000),
      status: 'accepted',
      paymentStatus: 'paid',
      subtotal: 400,
      platformFee: 15,
      gstPercent: 18,
      gst: 34,
      taxAmount: 34,
      totalAmount: 449,
      estimatedTime: 60,
      totalTime: 60,
      address: {
        houseName: 'Flat 2',
        street: 'Main Road',
        city: 'Kochi',
        pincode: '682031',
      },
    });

    // 2. Create the associated payment
    await Payment.create({
      booking: booking._id,
      customer: customer._id,
      amount: 449,
      status: 'captured',
      method: 'upi',
      razorpayPaymentId: 'pay_refund_test2',
      razorpayOrderId: 'order_refund_test2',
    });

    // 3. Trigger the expireUnassignedScheduled check
    const result = await expireUnassignedScheduled(booking._id);

    expect(result.success).toBe(true);
    expect(result.message).toContain('already resolved');

    // 4. Verify booking and payment status remain unchanged
    const updatedBooking = await Booking.findById(booking._id);
    expect(updatedBooking.status).toBe('accepted');
    expect(updatedBooking.paymentStatus).toBe('paid');

    const updatedPayment = await Payment.findOne({ booking: booking._id });
    expect(updatedPayment.status).toBe('captured');
  });
});
