const jwt = require('jsonwebtoken');

describe('maid daily-login JWT policy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'daily-login-test-secret';
    process.env.JWT_EXPIRE = '30d';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('expires a maid token exactly at the next IST midnight', () => {
    const { generateToken, getNextIstMidnight } = require('../utils/authToken');
    const now = new Date('2026-06-20T18:29:59.000Z'); // 23:59:59 IST
    const token = generateToken('maid-user-id', 'maid', { now });
    const decoded = jwt.decode(token);

    expect(getNextIstMidnight(now).toISOString()).toBe('2026-06-20T18:30:00.000Z');
    expect(decoded.exp).toBe(Date.parse('2026-06-20T18:30:00.000Z') / 1000);
    expect(() =>
      jwt.verify(token, process.env.JWT_SECRET, {
        clockTimestamp: Date.parse('2026-06-20T18:29:59.000Z') / 1000,
      }),
    ).not.toThrow();
    expect(() =>
      jwt.verify(token, process.env.JWT_SECRET, {
        clockTimestamp: Date.parse('2026-06-20T18:30:00.000Z') / 1000,
      }),
    ).toThrow('jwt expired');
  });

  it('keeps the configured expiry for non-maid users', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-20T10:00:00.000Z'));
    const { generateToken } = require('../utils/authToken');
    const token = generateToken('admin-user-id', 'admin');
    const decoded = jwt.decode(token);

    expect(decoded.exp - decoded.iat).toBe(30 * 24 * 60 * 60);
    jest.useRealTimers();
  });

  it('requires JWT_SECRET in production', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    const { getJwtSecret } = require('../utils/authToken');

    expect(() => getJwtSecret()).toThrow('JWT_SECRET is required in production');
  });
});

describe('maidId login alias', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'daily-login-test-secret';
  });

  it('looks up maidId as an employeeId and returns a maid token', async () => {
    const User = require('../models/User');
    const user = {
      _id: '507f1f77bcf86cd799439011',
      employeeId: 'MAID-1001',
      email: 'maid@example.com',
      role: 'maid',
      name: 'Test Maid',
      maidProfile: '507f1f77bcf86cd799439012',
      isBlocked: false,
      matchPassword: jest.fn().mockResolvedValue(true),
    };
    const select = jest.fn().mockResolvedValue(user);
    jest.spyOn(User, 'findOne').mockReturnValue({ select });

    const { login } = require('../controllers/authController');
    const req = {
      body: { maidId: 'MAID-1001', password: 'Password123' },
      headers: { locale: 'en' },
    };
    const res = {
      req,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await login(req, res, next);

    expect(User.findOne).toHaveBeenCalledWith({
      $or: [{ employeeId: 'MAID-1001' }, { email: 'maid-1001' }],
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.user.employeeId).toBe('MAID-1001');
    expect(jwt.decode(res.json.mock.calls[0][0].data.token).exp).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects login when password is missing', async () => {
    const User = require('../models/User');
    const findOne = jest.spyOn(User, 'findOne');
    const { login } = require('../controllers/authController');
    const req = { body: { maidId: 'MAID-1001' }, headers: { locale: 'en' } };
    const res = {
      req,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await login(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Password is required');
    expect(findOne).not.toHaveBeenCalled();
  });
});
