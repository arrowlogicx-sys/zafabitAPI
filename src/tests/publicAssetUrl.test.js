const { resolvePublicAssetUrl } = require('../utils/publicAssetUrl');

describe('resolvePublicAssetUrl', () => {
  const originalPublicApiBaseUrl = process.env.PUBLIC_API_BASE_URL;

  afterEach(() => {
    if (originalPublicApiBaseUrl === undefined) {
      delete process.env.PUBLIC_API_BASE_URL;
    } else {
      process.env.PUBLIC_API_BASE_URL = originalPublicApiBaseUrl;
    }
  });

  it('builds an HTTPS asset URL from proxy request headers', () => {
    const req = {
      protocol: 'http',
      get: jest.fn(
        (name) =>
          ({
            'x-forwarded-proto': 'https',
            host: 'api.zaffabit.com',
          })[name],
      ),
    };

    expect(resolvePublicAssetUrl(req, '/uploads/selfies/maid.jpg')).toBe(
      'https://api.zaffabit.com/uploads/selfies/maid.jpg',
    );
  });

  it('prefers PUBLIC_API_BASE_URL when configured', () => {
    process.env.PUBLIC_API_BASE_URL = 'https://zaffabit-api.example.com/';

    expect(resolvePublicAssetUrl(null, '/uploads/selfies/maid.jpg')).toBe(
      'https://zaffabit-api.example.com/uploads/selfies/maid.jpg',
    );
  });

  it('preserves existing absolute image URLs and supports no photo', () => {
    expect(resolvePublicAssetUrl(null, 'https://cdn.example.com/maid.jpg')).toBe(
      'https://cdn.example.com/maid.jpg',
    );
    expect(resolvePublicAssetUrl(null, null)).toBeNull();
  });
});
