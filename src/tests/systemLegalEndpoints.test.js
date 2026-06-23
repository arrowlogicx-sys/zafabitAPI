const request = require('supertest');
const app = require('../app');

describe('System Legal Endpoints', () => {
  it('GET /api/v1/system/terms - retrieves terms and conditions', async () => {
    const res = await request(app).get('/api/v1/system/terms');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Terms & Conditions retrieved');
    expect(res.body.data).toBeDefined();
    expect(res.body.data.title).toBe('Terms & Conditions');
    expect(Array.isArray(res.body.data.paragraphs)).toBe(true);
    expect(res.body.data.paragraphs.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/system/privacy - retrieves privacy policy', async () => {
    const res = await request(app).get('/api/v1/system/privacy');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Privacy Policy retrieved');
    expect(res.body.data).toBeDefined();
    expect(res.body.data.title).toBe('Privacy Policy');
    expect(Array.isArray(res.body.data.paragraphs)).toBe(true);
    expect(res.body.data.paragraphs.length).toBeGreaterThan(0);
  });
});
