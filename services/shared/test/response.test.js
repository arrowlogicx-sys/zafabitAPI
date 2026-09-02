const express = require('express');
const request = require('supertest');
const { sendResponse, sendError } = require('../src/response');

const app = express();
app.get('/ok', (req, res) => {
  req.id = 'req-123';
  sendResponse(res, 200, 'fine', { a: 1 });
});
app.get('/bad', (req, res) => sendError(res, 422, 'nope', 'X', [{ field: 'a', message: 'nope' }]));

describe('response envelope', () => {
  it('success shape: success/status/message/data/meta, no error key', async () => {
    const res = await request(app).get('/ok');
    expect(res.body).toMatchObject({ success: true, status: 200, message: 'fine', data: { a: 1 } });
    expect(res.body.error).toBeUndefined();
    expect(res.body.meta.requestId).toBe('req-123');
    expect(typeof res.body.meta.timestamp).toBe('string');
  });

  it('error shape carries code + details and mirrors status', async () => {
    const res = await request(app).get('/bad');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      status: 422,
      data: null,
      error: { code: 'X', message: 'nope', details: [{ field: 'a', message: 'nope' }] },
    });
  });
});
