const express = require('express');
const request = require('supertest');
const { validate, z, phone, otpCode, uuid, oneOf, shortText } = require('../src/validate');

const appWith = (schema) => {
  const app = express();
  app.use(express.json());
  app.post('/t', validate(schema), (req, res) => res.json({ ok: true, data: req.validated }));
  return app;
};

describe('validate middleware + shared schemas', () => {
  it('passes and exposes the coerced value', async () => {
    const app = appWith(z.object({ phone, lang: oneOf(['en', 'ml'], 'Language') }));
    const res = await request(app).post('/t').send({ phone: '+91 99999 00001', lang: 'EN' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ phone: '+919999900001', lang: 'en' });
  });

  it('returns one 400 with every field message', async () => {
    const app = appWith(z.object({ phone, otp: otpCode }));
    const res = await request(app).post('/t').send({ phone: 'nope', otp: '12' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['otp', 'phone']);
    expect(res.body.message).toBe(res.body.error.details[0].message);
  });

  it('shortText enforces required + max with friendly text', async () => {
    const app = appWith(z.object({ name: shortText('First name', 5) }));
    expect((await request(app).post('/t').send({})).body.message).toBe('First name is required.');
    expect((await request(app).post('/t').send({ name: 'abcdef' })).body.message).toBe(
      'First name must be 5 characters or fewer.',
    );
  });

  it('oneOf lists the choices', async () => {
    const app = appWith(z.object({ c: oneOf(['sms', 'whatsapp'], 'Channel') }));
    const res = await request(app).post('/t').send({ c: 'pigeon' });
    expect(res.body.message).toBe('Channel must be one of: sms, whatsapp.');
  });

  it('uuid rejects non-uuids', async () => {
    const app = appWith(z.object({ id: uuid }));
    expect((await request(app).post('/t').send({ id: 'x' })).body.message).toBe('A valid id is required.');
  });
});
