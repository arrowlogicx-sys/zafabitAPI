const request = require('supertest');
const app = require('../app');

// Mock User model to prevent DB connection
jest.mock('../models/User', () => ({
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue({
    _id: 'mock_id',
    phone: '+919999999999',
    otp: '123456',
    save: jest.fn().mockResolvedValue(true),
  }),
}));

describe('Locale-based API Responses', () => {
  it('returns response message in English by default when no header is provided', async () => {
    const res = await request(app).post('/api/v1/auth/send-otp').send({ phone: '+919999999999' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('OTP sent successfully via SMS');
  });

  it('returns response message in Malayalam when locale header is "ml"', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .set('locale', 'ml')
      .send({ phone: '+919999999999' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('ഒടിപി SMS വഴി വിജയകരമായി അയച്ചു');
  });

  it('returns response message in English when locale header is "en"', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .set('locale', 'en')
      .send({ phone: '+919999999999' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('OTP sent successfully via SMS');
  });

  it('updates language through the public language endpoint with localized response', async () => {
    const res = await request(app)
      .put('/api/v1/auth/languager')
      .set('locale', 'ml')
      .send({ language: 'ml' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('ഭാഷ വിജയകരമായി അപ്‌ഡേറ്റ് ചെയ്തു');
    expect(res.body.data).toEqual({ language: 'ml', locale: 'ml' });
  });

  it('rejects unsupported languages with localized error message', async () => {
    const res = await request(app)
      .put('/api/v1/auth/language')
      .set('locale', 'ml')
      .send({ language: 'fr' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('പിന്തുണയില്ലാത്ത ഭാഷ');
  });
});
