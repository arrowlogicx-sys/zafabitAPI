process.env.ENABLE_DEV_AUTH_FALLBACK = 'true';

const request = require('supertest');
const app = require('../app');
const mongoose = require('mongoose');

// Helper to create a chainable Mongoose query mock
const createQueryMock = (resolvedValue = []) => {
  const query = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    then: jest.fn().mockImplementation((resolve) => resolve(resolvedValue)),
    catch: jest.fn(),
  };
  return query;
};

// Mock Mongoose models to decouple from running database
jest.mock('../models/User', () => {
  const mockUserInstance = {
    _id: '507f1f77bcf86cd799439011',
    role: 'customer',
    isBlocked: false,
    save: jest.fn().mockResolvedValue(true),
  };
  return {
    countDocuments: jest.fn().mockResolvedValue(10),
    findOne: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(mockUserInstance),
    create: jest
      .fn()
      .mockImplementation((data) => Promise.resolve({ _id: 'mock_admin_id', ...data })),
    find: jest.fn().mockImplementation(() => createQueryMock([])),
    aggregate: jest.fn().mockResolvedValue([]),
  };
});

jest.mock('../models/Booking', () => ({
  countDocuments: jest.fn().mockResolvedValue(142),
  aggregate: jest.fn().mockResolvedValue([{ _id: null, totalRevenue: 15400 }]),
  updateMany: jest.fn().mockResolvedValue({ nModified: 1 }),
  find: jest.fn().mockImplementation(() => createQueryMock([])),
}));

jest.mock('../models/Service', () => ({
  find: jest.fn().mockImplementation(() => createQueryMock([])),
}));

jest.mock('../models/MaidProfile', () => ({
  countDocuments: jest.fn().mockResolvedValue(48),
  find: jest.fn().mockImplementation(() => createQueryMock([])),
}));

jest.mock('../models/CustomerProfile', () => ({
  countDocuments: jest.fn().mockResolvedValue(100),
}));

jest.mock('../models/Review', () => ({
  aggregate: jest.fn().mockResolvedValue([{ _id: null, avgRating: 4.8 }]),
}));

jest.mock('../models/Payment', () => ({
  aggregate: jest.fn().mockResolvedValue([{ _id: null, totalRefunds: 0 }]),
  find: jest.fn().mockImplementation(() => createQueryMock([])),
}));

jest.mock('../models/Agent', () => ({
  find: jest.fn().mockImplementation(() => createQueryMock([])),
}));

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
}));

describe('Admin Panel API Endpoints', () => {
  it('GET /api/v1/admin/dashboard - retrieves dashboard statistics', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard');
    if (res.status !== 200) {
      console.log('DASHBOARD ERROR BODY:', res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalBookings');
    expect(res.body.data).toHaveProperty('activeMaids');
  });

  it('POST /api/v1/admin/users/create-admin - registers new admin accounts', async () => {
    const newAdmin = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@zaffabit.com',
      password: 'SecurePassword123',
      phone: '9876543210',
    };
    const res = await request(app).post('/api/v1/admin/users/create-admin').send(newAdmin);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('admin');
  });

  it('PATCH /api/v1/admin/users/:id/status - updates user security block/unblock status', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/507f1f77bcf86cd799439011/status')
      .send({ activeStatus: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.isBlocked).toBe(true);
  });

  it('GET /api/v1/admin/activity-logs - retrieves system activity log entries', async () => {
    const res = await request(app).get('/api/v1/admin/activity-logs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.logs)).toBe(true);
  });

  it('POST /api/v1/admin/finance/settlements/:maidId/release - releases automated partner payouts', async () => {
    const res = await request(app)
      .post('/api/v1/admin/finance/settlements/maid_123/release')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('released');
  });
});
