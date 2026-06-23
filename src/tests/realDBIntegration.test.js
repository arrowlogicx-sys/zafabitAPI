process.env.ENABLE_DEV_AUTH_FALLBACK = 'true';

const request = require('supertest');
const app = require('../app');
const mongoose = require('mongoose');

describe('Live MongoDB Atlas Integration Tests for Admin Dashboard', () => {
  // 1. Establish real database connection before executing tests
  beforeAll(async () => {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cleaningService';
    console.log('Connecting to Live MongoDB Cluster for Integration Testing...');
    await mongoose.connect(MONGO_URI);
  });

  // 2. Tear down database connection after tests complete
  afterAll(async () => {
    console.log('Disconnecting from Live MongoDB Cluster...');
    await mongoose.disconnect();
  });

  // Test 1: Real-time Dashboard KPI Aggregations
  it('GET /api/v1/admin/dashboard - retrieve real live KPI aggregates from Mongoose collections', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalBookings');
    expect(res.body.data).toHaveProperty('activeMaids');
    expect(res.body.data).toHaveProperty('totalRevenue');
    console.log('Live Dashboard Stats from MongoDB:', {
      totalBookings: res.body.data.totalBookings,
      activeMaids: res.body.data.activeMaids,
      totalRevenue: res.body.data.totalRevenue,
      completionRate: res.body.data.completionRate,
      avgMaidRating: res.body.data.avgMaidRating,
    });
  });

  // Test 2: Users collection
  it('GET /api/v1/admin/users - retrieve system user accounts from live database', async () => {
    const res = await request(app).get('/api/v1/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.users)).toBe(true);
    console.log(`Successfully fetched ${res.body.data.users.length} live users from MongoDB.`);
  });

  // Test 3: Bookings collection
  it('GET /api/v1/admin/bookings/recent - retrieve recent bookings from live database', async () => {
    const res = await request(app).get('/api/v1/admin/bookings/recent');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.bookings)).toBe(true);
    console.log(
      `Successfully fetched ${res.body.data.bookings.length} live bookings from MongoDB.`,
    );
  });

  // Test 4: Financial settlements
  it('GET /api/v1/admin/finance/settlements - retrieve maid partner settlements from live database', async () => {
    const res = await request(app).get('/api/v1/admin/finance/settlements');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.settlements)).toBe(true);
    console.log(
      `Successfully fetched ${res.body.data.settlements.length} live settlements from MongoDB.`,
    );
  });

  // Test 5: Geo Heatmap Kochi analytics
  it('GET /api/v1/admin/geo-heatmap - retrieve spatial H3 hexagonal coordinates from live bookings', async () => {
    const res = await request(app).get('/api/v1/admin/geo-heatmap');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('cells');
    expect(res.body.data).toHaveProperty('summary');
    console.log('Live Geo Heatmap Kochi H3 Cells:', res.body.data.cells.length);
  });

  // Test 7: Payments log records
  it('GET /api/v1/admin/payments - retrieve manual UPI/card logs from live database', async () => {
    const res = await request(app).get('/api/v1/admin/payments');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    console.log('Live Payments Log retrieved from MongoDB.');
  });

  // Test 8: Refund log records
  it('GET /api/v1/admin/finance/refunds - retrieve refund transactions from live database', async () => {
    const res = await request(app).get('/api/v1/admin/finance/refunds');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    console.log('Live Refunds list retrieved from MongoDB.');
  });

  // Test 9: Customer Wallets ledger
  it('GET /api/v1/admin/wallets - retrieve customer wallet balances from live database', async () => {
    const res = await request(app).get('/api/v1/admin/wallets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    console.log('Live Wallet ledger balances retrieved from MongoDB.');
  });

  // Test 10: Promo campaigns
  it('GET /api/v1/admin/promotions - retrieve promotional discount codes from live database', async () => {
    const res = await request(app).get('/api/v1/admin/promotions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    console.log('Live Promo campaigns list retrieved from MongoDB.');
  });

  // Test 11: Support tickets thread
  it('GET /api/v1/admin/support/tickets - retrieve customer support tickets from live database', async () => {
    const res = await request(app).get('/api/v1/admin/support/tickets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    console.log(
      `Successfully fetched ${res.body.data.tickets.length} live support tickets from MongoDB.`,
    );
  });

  // Test 12: Safety incidents dispatch alerts
  it('GET /api/v1/admin/incidents - retrieve incident alerts from live database', async () => {
    const res = await request(app).get('/api/v1/admin/incidents');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    console.log(
      `Successfully fetched ${res.body.data.incidents.length} live incident alerts from MongoDB.`,
    );
  });

  // Test 13: Activity log audit ledger
  it('GET /api/v1/admin/activity-logs - retrieve administrator modification logs from live database', async () => {
    const res = await request(app).get('/api/v1/admin/activity-logs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    console.log(
      `Successfully fetched ${res.body.data.logs.length} live activity logs from MongoDB.`,
    );
  });
});
