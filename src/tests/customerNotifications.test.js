process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
process.env.DISABLE_DEV_AUTH_FALLBACK = 'true';

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const app = require('../app');
const Notification = require('../models/Notification');
const User = require('../models/User');

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

describe('Customer Notifications API', () => {
  let mongo;
  let customer;
  let customerToken;
  let otherCustomer;
  let otherCustomerToken;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    [customer, otherCustomer] = await User.create([
      {
        firstName: 'Customer',
        lastName: 'NotificationTest',
        name: 'Customer NotificationTest',
        email: 'customer.notif@zaffabit.test',
        phone: '+919100000010',
        password: 'Password123',
        role: 'customer',
        isVerified: true,
      },
      {
        firstName: 'Other',
        lastName: 'Customer',
        name: 'Other Customer',
        email: 'other.customer@zaffabit.test',
        phone: '+919100000011',
        password: 'Password123',
        role: 'customer',
        isVerified: true,
      },
    ]);

    customerToken = tokenFor(customer);
    otherCustomerToken = tokenFor(otherCustomer);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongo.stop();
    delete process.env.DISABLE_DEV_AUTH_FALLBACK;
  });

  beforeEach(async () => {
    await Notification.deleteMany({});
  });

  it('retrieves an empty list of notifications when none exist', async () => {
    const res = await request(app).get('/api/v1/customers/notifications').set(auth(customerToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unreadCount).toBe(0);
    expect(res.body.data.notifications).toEqual([]);
  });

  it('retrieves customer specific notifications and ignores other users', async () => {
    // Create notifications for our customer
    const n1 = await Notification.create({
      recipient: customer._id,
      title: 'Promo alert',
      message: 'Get 20% off!',
      type: 'general',
    });

    const n2 = await Notification.create({
      recipient: customer._id,
      title: 'Booking assigned',
      message: 'Your cleaning service is scheduled.',
      type: 'job_assigned',
      isRead: true,
    });

    // Create notification for other customer
    await Notification.create({
      recipient: otherCustomer._id,
      title: 'Other customer notification',
      message: 'Should not see this.',
      type: 'general',
    });

    const res = await request(app).get('/api/v1/customers/notifications').set(auth(customerToken));

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(1); // n1 is unread, n2 is read
    expect(res.body.data.notifications.length).toBe(2);

    // Test unreadOnly filter
    const resUnread = await request(app)
      .get('/api/v1/customers/notifications?unreadOnly=true')
      .set(auth(customerToken));

    expect(resUnread.status).toBe(200);
    expect(resUnread.body.data.unreadCount).toBe(1);
    expect(resUnread.body.data.notifications.length).toBe(1);
    expect(String(resUnread.body.data.notifications[0]._id)).toBe(String(n1._id));
  });

  it('marks a single notification as read', async () => {
    const notif = await Notification.create({
      recipient: customer._id,
      title: 'Read me',
      message: 'Please read me.',
      type: 'general',
    });

    const res = await request(app)
      .patch(`/api/v1/customers/notifications/${notif._id}/read`)
      .set(auth(customerToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notification.isRead).toBe(true);

    const check = await Notification.findById(notif._id);
    expect(check.isRead).toBe(true);
  });

  it("returns 404 when marking a non-existent or other user's notification as read", async () => {
    const otherNotif = await Notification.create({
      recipient: otherCustomer._id,
      title: 'Private',
      message: 'Secret message.',
      type: 'general',
    });

    // Try reading with customer token
    const resOther = await request(app)
      .patch(`/api/v1/customers/notifications/${otherNotif._id}/read`)
      .set(auth(customerToken))
      .send({});

    expect(resOther.status).toBe(404);
    expect(resOther.body.success).toBe(false);

    // Try reading a fake ID
    const fakeId = new mongoose.Types.ObjectId();
    const resFake = await request(app)
      .patch(`/api/v1/customers/notifications/${fakeId}/read`)
      .set(auth(customerToken))
      .send({});

    expect(resFake.status).toBe(404);
  });

  it('marks all customer notifications as read and updates count on home API', async () => {
    await Notification.create([
      { recipient: customer._id, title: 'Notif 1', message: 'M1', type: 'general' },
      { recipient: customer._id, title: 'Notif 2', message: 'M2', type: 'general' },
      { recipient: otherCustomer._id, title: 'Notif 3', message: 'M3', type: 'general' },
    ]);

    // Check home API count first
    const homeBefore = await request(app).get('/api/v1/content/home').set(auth(customerToken));
    expect(homeBefore.status).toBe(200);
    expect(homeBefore.body.data.unreadNotificationsCount).toBe(2);

    // Mark all as read
    const resMarkAll = await request(app)
      .patch('/api/v1/customers/notifications/read-all')
      .set(auth(customerToken))
      .send({});

    expect(resMarkAll.status).toBe(200);
    expect(resMarkAll.body.success).toBe(true);
    expect(resMarkAll.body.data.markedRead).toBe(2);

    // Verify they are read
    const unreadCount = await Notification.countDocuments({
      recipient: customer._id,
      isRead: false,
    });
    expect(unreadCount).toBe(0);

    // Verify other user's notification remains unread
    const otherUnreadCount = await Notification.countDocuments({
      recipient: otherCustomer._id,
      isRead: false,
    });
    expect(otherUnreadCount).toBe(1);

    // Check home API count after
    const homeAfter = await request(app).get('/api/v1/content/home').set(auth(customerToken));
    expect(homeAfter.status).toBe(200);
    expect(homeAfter.body.data.unreadNotificationsCount).toBe(0);
  });
});
