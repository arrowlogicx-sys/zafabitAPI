process.env.ENABLE_DEV_AUTH_FALLBACK = 'true';

const request = require('supertest');
const app = require('../app');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');

// Helper to create a chainable Mongoose query mock
const createQueryMock = (resolvedValue = []) => {
  const query = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    then: jest.fn().mockImplementation((resolve) => resolve(resolvedValue)),
    catch: jest.fn(),
  };
  return query;
};

// Mock Mongoose models to decouple from running database
jest.mock('../models/User', () => {
  const mockUserInstance = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    firstName: 'Dev',
    lastName: 'Admin',
    name: 'Dev Admin',
    email: 'admin@zaffabit.com',
    role: 'admin',
    isBlocked: false,
    isVerified: true,
    walletBalance: 120,
    walletTransactions: [],
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    countDocuments: jest.fn().mockResolvedValue(10),
    findOne: jest.fn().mockImplementation((query) => {
      if (query && query.email === 'admin@zaffabit.com') {
        return Promise.resolve(mockUserInstance);
      }
      return Promise.resolve(null);
    }),
    findById: jest.fn().mockImplementation((id) => {
      if (id === '507f1f77bcf86cd799439011') {
        return Promise.resolve(mockUserInstance);
      }
      // Return a maid user if id is the maid user's id (e.g. for updates/assign)
      return Promise.resolve({
        _id: id,
        id: id,
        firstName: 'Sita',
        lastName: 'Devi',
        name: 'Sita Devi',
        email: 'maid@zaffabit.com',
        role: 'maid',
        isBlocked: false,
        isVerified: true,
        walletBalance: 0,
        walletTransactions: [],
        save: jest.fn().mockResolvedValue(true),
      });
    }),
    create: jest
      .fn()
      .mockImplementation((data) =>
        Promise.resolve({
          _id: 'mock_admin_id',
          name: `${data.firstName} ${data.lastName}`,
          ...data,
          save: jest.fn(),
        }),
      ),
    find: jest.fn().mockImplementation(() => createQueryMock([mockUserInstance])),
    aggregate: jest.fn().mockResolvedValue([]),
    findByIdAndUpdate: jest
      .fn()
      .mockImplementation((id, data) =>
        Promise.resolve({ _id: id, role: 'maid', ...data, save: jest.fn() }),
      ),
    findByIdAndDelete: jest
      .fn()
      .mockImplementation((id) => Promise.resolve({ _id: id, role: 'maid', save: jest.fn() })),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
});

jest.mock('../models/Booking', () => {
  const mockBookingInstance = {
    _id: '507f1f77bcf86cd799439012',
    status: 'completed',
    totalAmount: 1500,
    statusHistory: [],
    location: { lat: 10.0159, lng: 76.3419 },
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    countDocuments: jest.fn().mockResolvedValue(142),
    aggregate: jest.fn().mockResolvedValue([{ _id: null, totalRevenue: 15400 }]),
    updateMany: jest.fn().mockResolvedValue({ nModified: 1 }),
    find: jest.fn().mockImplementation(() => createQueryMock([mockBookingInstance])),
    findOne: jest.fn().mockImplementation(() => createQueryMock(mockBookingInstance)),
    findById: jest.fn().mockImplementation(() => createQueryMock(mockBookingInstance)),
    findByIdAndDelete: jest.fn().mockResolvedValue(mockBookingInstance),
    distinct: jest.fn().mockResolvedValue([]),
  };
});

jest.mock('../models/Service', () => {
  const mockService = { _id: '507f1f77bcf86cd799439013', name: 'Deep Cleaning' };
  return {
    find: jest.fn().mockImplementation(() => createQueryMock([mockService])),
  };
});

jest.mock('../models/MaidProfile', () => {
  const mockMaidProfile = {
    _id: '507f1f77bcf86cd799439014',
    user: '507f1f77bcf86cd799439011',
    activeStatus: 'active',
    isIdentityVerified: false,
    documents: [{ _id: 'doc1', status: 'pending' }],
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    countDocuments: jest.fn().mockResolvedValue(48),
    find: jest.fn().mockImplementation(() => createQueryMock([mockMaidProfile])),
    findById: jest.fn().mockResolvedValue(mockMaidProfile),
    create: jest.fn().mockResolvedValue(mockMaidProfile),
    findOneAndUpdate: jest.fn().mockResolvedValue(mockMaidProfile),
    findOneAndDelete: jest.fn().mockResolvedValue(mockMaidProfile),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    aggregate: jest.fn().mockResolvedValue([]),
  };
});

jest.mock('../models/CustomerProfile', () => ({
  countDocuments: jest.fn().mockResolvedValue(100),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
}));

jest.mock('../models/Review', () => ({
  aggregate: jest.fn().mockResolvedValue([{ _id: null, avgRating: 4.8 }]),
  find: jest.fn().mockImplementation(() => createQueryMock([])),
}));

jest.mock('../models/Payment', () => {
  const mockPayment = {
    _id: '507f1f77bcf86cd799439015',
    amount: 1500,
    status: 'captured',
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    aggregate: jest.fn().mockResolvedValue([{ _id: null, totalRefunds: 0 }]),
    countDocuments: jest.fn().mockResolvedValue(1),
    find: jest.fn().mockImplementation(() => createQueryMock([mockPayment])),
    create: jest
      .fn()
      .mockImplementation((data) =>
        Promise.resolve({ _id: 'mock_payment_id', ...data, save: jest.fn() }),
      ),
    findById: jest.fn().mockImplementation(() => createQueryMock(mockPayment)),
    findOne: jest.fn().mockImplementation(() => createQueryMock(mockPayment)),
    findByIdAndDelete: jest.fn().mockResolvedValue(mockPayment),
  };
});

jest.mock('../models/Agent', () => ({
  find: jest
    .fn()
    .mockImplementation(() =>
      createQueryMock([{ name: 'Agent X', agentCode: 'AX100', earnings: 500, status: 'active' }]),
    ),
}));

jest.mock('../models/BookingConfig', () => {
  const mockConfig = {
    slots: ['08:00 AM', '10:00 AM', '12:00 PM', '02:00 PM', '04:00 PM', '06:00 PM'],
    daysAhead: 7,
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    findOne: jest.fn().mockImplementation(() => createQueryMock(mockConfig)),
    create: jest.fn().mockResolvedValue(mockConfig),
  };
});

jest.mock('../models/ActivityLog', () => ({
  find: jest.fn().mockImplementation(() =>
    createQueryMock([
      {
        admin: { name: 'Dev Admin' },
        action: 'Update System Configuration',
        details: 'Set global active tax settings parameter to 18%',
        status: 'Success',
        ipAddress: '192.168.1.101',
        createdAt: new Date(),
      },
    ]),
  ),
  countDocuments: jest.fn().mockResolvedValue(1),
  create: jest.fn().mockResolvedValue(true),
  deleteMany: jest.fn().mockResolvedValue(true),
}));

jest.mock('../models/PromoCode', () => {
  const mockPromo = {
    _id: '507f1f77bcf86cd799439016',
    code: 'WELCOME50',
    description: '50% off first booking',
    type: 'percentage',
    discountValue: 50,
    status: 'active',
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    find: jest.fn().mockImplementation(() => createQueryMock([mockPromo])),
    findOne: jest.fn().mockImplementation((query) => {
      if (query && query.code === 'WELCOME50') {
        return Promise.resolve(mockPromo);
      }
      return Promise.resolve(null);
    }),
    create: jest
      .fn()
      .mockImplementation((data) => Promise.resolve({ _id: 'mock_promo_id', ...data })),
    findByIdAndDelete: jest.fn().mockResolvedValue(mockPromo),
  };
});

jest.mock('../models/SupportTicket', () => {
  const mockTicket = {
    _id: '507f1f77bcf86cd799439017',
    ticketId: '#TK-8821',
    user: 'Jordan Smith',
    title: 'API integration failing',
    status: 'open',
    priority: 'high',
    messages: [],
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    countDocuments: jest.fn().mockResolvedValue(1),
    find: jest.fn().mockImplementation(() => createQueryMock([mockTicket])),
    findById: jest.fn().mockImplementation(() => createQueryMock(mockTicket)),
    create: jest.fn().mockResolvedValue(true),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
});

jest.mock('../models/Incident', () => {
  const mockIncident = {
    _id: '507f1f77bcf86cd799439018',
    incidentId: '#INC-101',
    status: 'resolved',
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    countDocuments: jest.fn().mockResolvedValue(1),
    find: jest.fn().mockImplementation(() => createQueryMock([mockIncident])),
    findById: jest.fn().mockImplementation(() => createQueryMock(mockIncident)),
    create: jest.fn().mockResolvedValue(mockIncident),
    insertMany: jest.fn().mockResolvedValue([]),
  };
});

describe('Comprehensive Admin Panel API Integration Tests', () => {
  // 1. Dashboard Stats
  it('GET /api/v1/admin/dashboard - retrieve dashboard KPI dashboard statistics', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalBookings');
    expect(res.body.data).toHaveProperty('activeMaids');
    expect(res.body.data).toHaveProperty('totalRevenue');
    expect(res.body.data).toHaveProperty('revenueDashboard');
    expect(res.body.data.revenueDashboard).toHaveProperty('totalRevenue');
    expect(res.body.data.revenueDashboard).toHaveProperty('revenueToday');
    expect(res.body.data.revenueDashboard).toHaveProperty('revenueThisWeek');
    expect(res.body.data.revenueDashboard).toHaveProperty('partnerEarnings');
    expect(res.body.data.revenueDashboard).toHaveProperty('averageOrderValue');
    expect(res.body.data.revenueDashboard).toHaveProperty('transactionStatistics');
    expect(res.body.data.revenueDashboard).toHaveProperty('paymentSuccessRate');
    expect(res.body.data.revenueDashboard).toHaveProperty('paymentFailureRate');
  });

  // 2. User & Admin Management
  it('GET /api/v1/admin/users - retrieve system user accounts', async () => {
    const res = await request(app).get('/api/v1/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.users)).toBe(true);
  });

  it('PUT /api/v1/admin/users/:id - update administrative user account info', async () => {
    const res = await request(app)
      .put('/api/v1/admin/users/507f1f77bcf86cd799439011')
      .send({ firstName: 'Super', lastName: 'Admin' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/v1/admin/users/:id - delete administrative user account', async () => {
    const res = await request(app).delete('/api/v1/admin/users/507f1f77bcf86cd799439011');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PATCH /api/v1/admin/users/:id/status - update security lock/block status', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/507f1f77bcf86cd799439011/status')
      .send({ activeStatus: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.isBlocked).toBe(true);
  });

  // 3. Zone Configuration
  it('POST /api/v1/admin/zones/config - create zone location boundaries', async () => {
    const res = await request(app)
      .post('/api/v1/admin/zones/config')
      .send({ zoneName: 'Kochi Central', allowedPincodes: ['682001', '682002'] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 4. Reports & Analytics
  it('GET /api/v1/admin/reports/sentiment - retrieve customer review sentiment analysis', async () => {
    const res = await request(app).get('/api/v1/admin/reports/sentiment');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/v1/admin/reports/financial - retrieve month-over-month platform revenue analytics', async () => {
    const res = await request(app).get('/api/v1/admin/reports/financial');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 5. Maid Partner Management & Verification
  it('POST /api/v1/admin/maids - onboard new cleaning professional partner', async () => {
    const res = await request(app)
      .post('/api/v1/admin/maids')
      .send({
        name: 'Sita Devi',
        phone: '9845012345',
        email: 'sita@zaffabit.com',
        zone: 'Kochi-East',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('PUT /api/v1/admin/maids/:id - update maid partner profile details', async () => {
    const res = await request(app)
      .put('/api/v1/admin/maids/507f1f77bcf86cd799439014')
      .send({ name: 'Sita Kumar', zone: 'Kochi-West' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/v1/admin/maids/:id - offboard/delete maid profile', async () => {
    const res = await request(app).delete('/api/v1/admin/maids/507f1f77bcf86cd799439011');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/v1/admin/verifications/pending - check unverified identity files', async () => {
    const res = await request(app).get('/api/v1/admin/verifications/pending?limit=10000');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.pagination.perPage).toBe(100);
    expect(Array.isArray(res.body.data.maids)).toBe(true);
  });

  it('PATCH /api/v1/admin/verifications/:id/approve - approve maid identification document details', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/verifications/507f1f77bcf86cd799439014/approve')
      .send({ isIdentityVerified: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 6. Financial Settlements (Payouts)
  it('GET /api/v1/admin/finance/settlements - retrieve accumulated maid earnings report', async () => {
    const res = await request(app).get('/api/v1/admin/finance/settlements?limit=10000');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.settlements)).toBe(true);
    expect(res.body.meta.pagination.perPage).toBe(100);
  });

  it('POST /api/v1/admin/finance/settlements/:maidId/release - release bank payout', async () => {
    const res = await request(app).post('/api/v1/admin/finance/settlements/maid_741/release');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 7. Booking Commands
  it('GET /api/v1/admin/bookings/recent - retrieve recent bookings roster', async () => {
    const res = await request(app).get('/api/v1/admin/bookings/recent');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.bookings)).toBe(true);
  });

  it('PATCH /api/v1/admin/bookings/:id/assign - dispatch/assign maid manually to booking', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/bookings/507f1f77bcf86cd799439012/assign')
      .send({ maidId: '507f1f77bcf86cd799439014' });
    if (res.status !== 200) {
      console.log('ASSIGN ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PATCH /api/v1/admin/bookings/:id/status - update booking job status directly', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/bookings/507f1f77bcf86cd799439012/status')
      .send({ status: 'completed' });
    if (res.status !== 200) {
      console.log('STATUS ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT /api/v1/admin/bookings/:id - update booking transaction/pricing attributes', async () => {
    const res = await request(app)
      .put('/api/v1/admin/bookings/507f1f77bcf86cd799439012')
      .send({ totalAmount: 1800 });
    if (res.status !== 200) {
      console.log('UPDATE BOOKING ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/v1/admin/bookings/:id - purge booking record from system', async () => {
    const res = await request(app).delete('/api/v1/admin/bookings/507f1f77bcf86cd799439012');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // Booking schedule config tests
  it('GET /api/v1/admin/config/booking - retrieve booking schedule config', async () => {
    const res = await request(app).get('/api/v1/admin/config/booking');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('slots');
    expect(res.body.data).toHaveProperty('daysAhead');
  });

  it('PUT /api/v1/admin/config/booking - modify booking schedule config parameters', async () => {
    const res = await request(app)
      .put('/api/v1/admin/config/booking')
      .send({ daysAhead: 10, slots: ['09:00 AM', '11:00 AM'] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 9. Manual Payments Management
  it('GET /api/v1/admin/payments - list all captured payments logs', async () => {
    const res = await request(app).get('/api/v1/admin/payments');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('summary');
  });

  it('POST /api/v1/admin/payments - record new manual check/UPI payment', async () => {
    const res = await request(app)
      .post('/api/v1/admin/payments')
      .send({
        bookingId: '507f1f77bcf86cd799439012',
        customerId: '507f1f77bcf86cd799439011',
        amount: 1200,
        method: 'upi',
        status: 'captured',
      });
    if (res.status !== 201) {
      console.log('PAYMENT POST ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('PUT /api/v1/admin/payments/:id - edit payment record parameters', async () => {
    const res = await request(app)
      .put('/api/v1/admin/payments/507f1f77bcf86cd799439015')
      .send({ status: 'refunded', amount: 1200 });
    if (res.status !== 200) {
      console.log('PAYMENT PUT ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/v1/admin/payments/:id - delete manually logged payment item', async () => {
    const res = await request(app).delete('/api/v1/admin/payments/507f1f77bcf86cd799439015');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 10. Refunds Log Management
  it('GET /api/v1/admin/finance/refunds - list all refund records', async () => {
    const res = await request(app).get('/api/v1/admin/finance/refunds');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('summary');
  });

  it('POST /api/v1/admin/finance/refunds - record custom credit card/UPI refund', async () => {
    const res = await request(app)
      .post('/api/v1/admin/finance/refunds')
      .send({
        paymentId: '507f1f77bcf86cd799439015',
        customerId: '507f1f77bcf86cd799439011',
        amount: 1500,
        reason: 'Maid was absent',
      });
    if (res.status !== 201) {
      console.log('REFUND POST ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('PUT /api/v1/admin/finance/refunds/:id - modify refund record detail fields', async () => {
    const res = await request(app)
      .put('/api/v1/admin/finance/refunds/507f1f77bcf86cd799439015')
      .send({ status: 'Approved', refundReason: 'Accident cancellation' });
    if (res.status !== 200) {
      console.log('REFUND PUT ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/v1/admin/finance/refunds/:id - delete/revert refund record item', async () => {
    const res = await request(app).delete('/api/v1/admin/finance/refunds/507f1f77bcf86cd799439015');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 11. Wallet Management & Adjustments
  it('GET /api/v1/admin/wallets - retrieve customer wallet details', async () => {
    const res = await request(app).get('/api/v1/admin/wallets?limit=10000');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.users)).toBe(true);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.meta.pagination.perPage).toBe(100);
  });

  it('POST /api/v1/admin/wallets/:userId/adjust - execute wallet ledger adjustment credit', async () => {
    const res = await request(app)
      .post('/api/v1/admin/wallets/507f1f77bcf86cd799439011/adjust')
      .send({ amount: 50, type: 'credit', reason: 'Onboarding bonus credits' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 12. Marketing Promotion & Referrals
  it('GET /api/v1/admin/promotions - retrieve platform promo campaigns', async () => {
    const res = await request(app).get('/api/v1/admin/promotions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/v1/admin/promotions - create new platform promotion discount code', async () => {
    const res = await request(app)
      .post('/api/v1/admin/promotions')
      .send({
        code: 'LAUNCH25',
        description: '25% flat launch discount',
        discountValue: 25,
        type: 'percentage',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/v1/admin/promotions/:id - remove promo discount code', async () => {
    const res = await request(app).delete('/api/v1/admin/promotions/507f1f77bcf86cd799439016');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/v1/promotions/validate - validate coupon discount code on customer checkout', async () => {
    const res = await request(app)
      .post('/api/v1/promotions/validate')
      .send({ code: 'WELCOME50', bookingAmount: 500 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.discountAmount).toBe(250);
    expect(res.body.data.finalAmount).toBe(250);
  });

  it('GET /api/v1/admin/referrals - retrieve referred user registration analytics', async () => {
    const res = await request(app).get('/api/v1/admin/referrals');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/v1/admin/reports/campaigns - retrieve campaign and agent performance analytics', async () => {
    const res = await request(app).get('/api/v1/admin/reports/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('referralStats');
    expect(res.body.data).toHaveProperty('agentPerformance');
  });

  it('GET /api/v1/admin/reports/partners - retrieve partner performance KPIs and analytics', async () => {
    const res = await request(app).get('/api/v1/admin/reports/partners');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('kpis');
    expect(res.body.data.kpis).toHaveProperty('totalRegistered');
    expect(res.body.data.kpis).toHaveProperty('newPartners');
    expect(res.body.data.kpis).toHaveProperty('activePartners');
    expect(res.body.data.kpis).toHaveProperty('acceptanceRate');
    expect(res.body.data.kpis).toHaveProperty('rejectionRate');
    expect(res.body.data.kpis).toHaveProperty('attendanceRate');
    expect(res.body.data.kpis).toHaveProperty('averageRating');
    expect(res.body.data.kpis).toHaveProperty('completionRate');
    expect(res.body.data.kpis).toHaveProperty('earningsToday');
    expect(res.body.data.kpis).toHaveProperty('maidLeads');

    expect(res.body.data).toHaveProperty('dispatchEfficiency');
    expect(res.body.data.dispatchEfficiency).toHaveProperty('onTimeArrivalRate');
    expect(res.body.data.dispatchEfficiency).toHaveProperty('avgStartDelay');
    expect(res.body.data.dispatchEfficiency).toHaveProperty('avgCompletionDelay');
    expect(res.body.data.dispatchEfficiency).toHaveProperty('serviceDelays');
    expect(res.body.data.dispatchEfficiency).toHaveProperty('efficiencyScore');
  });

  it('GET /api/v1/admin/reports/bookings - retrieve scheduled and demand analytics for booking management', async () => {
    Booking.countDocuments
      .mockResolvedValueOnce(200)
      .mockResolvedValueOnce(140)
      .mockResolvedValueOnce(60)
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(150)
      .mockResolvedValueOnce(132)
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(26)
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(44)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(106)
      .mockResolvedValueOnce(98)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(92);

    Booking.find
      .mockImplementationOnce(() =>
        createQueryMock([
          {
            dispatchStartedAt: new Date('2026-06-07T09:00:00.000Z'),
            matchingQueue: [
              { response: 'accepted', respondedAt: new Date('2026-06-07T09:04:00.000Z') },
            ],
          },
        ]),
      )
      .mockImplementationOnce(() =>
        createQueryMock([
          {
            matchingQueue: [
              { response: 'accepted', respondedAt: new Date('2026-06-07T09:04:00.000Z') },
            ],
            statusHistory: [{ status: 'arrived', timestamp: new Date('2026-06-07T09:20:00.000Z') }],
          },
        ]),
      );

    Booking.aggregate
      .mockResolvedValueOnce([
        { _id: 9, count: 18 },
        { _id: 10, count: 14 },
        { _id: 18, count: 12 },
      ])
      .mockResolvedValueOnce([
        { _id: { hour: 9, bookingType: 'instant' }, count: 20 },
        { _id: { hour: 10, bookingType: 'scheduled' }, count: 9 },
        { _id: { hour: 18, bookingType: 'instant' }, count: 11 },
        { _id: { hour: 19, bookingType: 'scheduled' }, count: 7 },
      ])
      .mockResolvedValueOnce([
        { _id: '2026-06-01', instant: 10, scheduled: 4, total: 14 },
        { _id: '2026-06-02', instant: 12, scheduled: 6, total: 18 },
      ])
      .mockResolvedValueOnce([
        { _id: '2026-06-02', total: 18 },
        { _id: '2026-06-01', total: 14 },
      ]);

    const res = await request(app).get('/api/v1/admin/reports/bookings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('kpis');
    expect(res.body.data).toHaveProperty('scheduledMetrics');
    expect(res.body.data).toHaveProperty('demandAnalysis');
    expect(res.body.data).toHaveProperty('categoryTracking');
    expect(res.body.data).toHaveProperty('bookingTypeBreakdown');
    expect(res.body.data).toHaveProperty('peakDemandPeriods');
    expect(res.body.data).toHaveProperty('dailyTrend');

    expect(res.body.data.scheduledMetrics).toHaveProperty('upcomingScheduledJobs');
    expect(res.body.data.scheduledMetrics).toHaveProperty('tomorrowJobs');
    expect(res.body.data.scheduledMetrics).toHaveProperty('rescheduledJobs');
    expect(res.body.data.scheduledMetrics).toHaveProperty('missedJobs');
    expect(res.body.data.scheduledMetrics).toHaveProperty('scheduledCompletionRate');

    expect(res.body.data.demandAnalysis).toHaveProperty('peakDemandHours');
    expect(res.body.data.demandAnalysis).toHaveProperty('highDemandSlots');
    expect(res.body.data.demandAnalysis).toHaveProperty('lowDemandSlots');
    expect(res.body.data.demandAnalysis).toHaveProperty('instantVsScheduledDemand');
    expect(res.body.data.demandAnalysis).toHaveProperty('overallBookingDemandVolume');
    expect(Array.isArray(res.body.data.demandAnalysis.demandByTimeSlot)).toBe(true);

    expect(res.body.data.categoryTracking.instantBookings).toHaveProperty('activeRequests');
    expect(res.body.data.categoryTracking.instantBookings).toHaveProperty('completionRate');
    expect(res.body.data.categoryTracking.scheduledBookings).toHaveProperty('upcomingJobs');
    expect(res.body.data.categoryTracking.scheduledBookings).toHaveProperty('rescheduledJobs');
    expect(res.body.data.categoryTracking.operationalPerformance).toHaveProperty('fulfillmentRate');
    expect(res.body.data.categoryTracking.operationalPerformance).toHaveProperty(
      'overdueScheduled',
    );
  });

  // 13. Support System Threads
  it('GET /api/v1/admin/support/tickets - list customer support threads', async () => {
    const res = await request(app).get('/api/v1/admin/support/tickets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.tickets)).toBe(true);
  });

  it('POST /api/v1/admin/support/tickets/:id/reply - submit support agent reply', async () => {
    const res = await request(app)
      .post('/api/v1/admin/support/tickets/507f1f77bcf86cd799439017/reply')
      .send({ content: 'We are investigating your platform transaction issue.' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PATCH /api/v1/admin/support/tickets/:id/resolve - mark customer ticket as resolved', async () => {
    const res = await request(app).patch(
      '/api/v1/admin/support/tickets/507f1f77bcf86cd799439017/resolve',
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 14. Dispatch Command & SOS Incidents
  it('GET /api/v1/admin/incidents - retrieve incident dispatch alerts', async () => {
    const res = await request(app).get('/api/v1/admin/incidents');
    if (res.status !== 200) {
      console.log('INCIDENT GET ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PATCH /api/v1/admin/incidents/:id/resolve - mark incident alert as resolved', async () => {
    const res = await request(app).patch(
      '/api/v1/admin/incidents/507f1f77bcf86cd799439018/resolve',
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 15. Dataset Export
  it('GET /api/v1/admin/export/:dataset - export user accounts database in JSON/CSV formats', async () => {
    const res = await request(app).get('/api/v1/admin/export/users?format=json&limit=10000');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.pagination.perPage).toBe(1000);
    expect(res.body.meta.export.csvStreamingAvailable).toBe(true);
  });

  // 16. Activity Logs Audit Ledger
  it('GET /api/v1/admin/activity-logs - check administrator modification history logs', async () => {
    const res = await request(app).get('/api/v1/admin/activity-logs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.logs)).toBe(true);
  });

  it('DELETE /api/v1/admin/activity-logs - clear activity log ledger', async () => {
    const res = await request(app).delete('/api/v1/admin/activity-logs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 17. H3 Spatial Geo Heatmap Analytics
  it('GET /api/v1/admin/geo-heatmap - retrieve spatial coordinate clusters', async () => {
    const res = await request(app).get('/api/v1/admin/geo-heatmap');
    if (res.status !== 200) {
      console.log('GEO HEATMAP GET ERROR:', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
