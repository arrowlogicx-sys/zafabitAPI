const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

// Mock User model to prevent DB connection
jest.mock('../models/User', () => ({
  findById: jest.fn().mockResolvedValue({
    _id: 'mock_user_id',
    firstName: 'Reno',
    name: 'Reno Roy',
    avatarUrl: 'http://test.com/avatar.jpg',
    role: 'admin',
  }),
}));

// Mock Notification model
jest.mock('../models/Notification', () => ({
  countDocuments: jest.fn().mockResolvedValue(5),
}));

// Mock translate utility
jest.mock('../utils/translate', () => {
  const mapContentTranslations = (item, locale, type) => {
    if (!item) return item;
    const itemObj = item.toObject ? item.toObject() : { ...item };
    if (itemObj.translations !== undefined) {
      delete itemObj.translations;
    }
    return itemObj;
  };

  const mapServiceTranslations = (service, locale) => {
    if (!service) return service;
    const serviceObj = service.toObject ? service.toObject() : { ...service };
    if (serviceObj.translations !== undefined) {
      delete serviceObj.translations;
    }
    return serviceObj;
  };

  return {
    translateText: jest.fn().mockImplementation((text) => Promise.resolve(text)),
    translateToAll: jest
      .fn()
      .mockImplementation((text) => Promise.resolve({ ml: text, hi: text, ta: text })),
    translateTrust: jest
      .fn()
      .mockImplementation((trust) => Promise.resolve({ ...trust, translations: {} })),
    translateFooter: jest
      .fn()
      .mockImplementation((footer) => Promise.resolve({ ...footer, translations: {} })),
    mapContentTranslations,
    mapServiceTranslations,
  };
});

// Mock AppContent models
jest.mock('../models/AppContent', () => {
  const localBanners = [
    {
      _id: 'banner1',
      title: 'Professional Deep Cleaning',
      subtitle: 'Get 20% Off',
      imageUrl: 'http://test.com/banner.jpg',
      ctaLabel: 'Book Now',
      ctaLink: '/services',
      isActive: true,
      order: 0,
      translations: {},
    },
  ];

  const localFeatured = [
    {
      _id: 'featured1',
      serviceId: {
        _id: 'service1',
        name: 'Bathroom Cleaning',
        price: 150,
        originalPrice: 180,
        estimatedTime: 30,
        description: 'Bathroom surface cleaning',
        image: 'http://test.com/service.jpg',
        whatsIncluded: [],
        doesNotInclude: [],
        faqs: [],
        howItsDone: [],
        translations: {},
      },
      label: 'Standard Wash',
      iconUrl: 'http://test.com/icon.png',
      isActive: true,
      order: 0,
      translations: {},
    },
  ];

  const mockSortBanners = jest.fn().mockResolvedValue(localBanners);
  const mockSortFeatured = jest.fn().mockReturnValue(Promise.resolve(localFeatured));
  const mockPopulateFeatured = jest.fn().mockReturnValue({
    sort: mockSortFeatured,
  });

  const localTrustCards = [
    {
      _id: 'trust1',
      title: 'Verified Professionals You Can Trust',
      imageUrl: 'http://test.com/t1.png',
      order: 0,
      isActive: true,
      translations: {},
    },
  ];

  let localFooterBanner = {
    _id: 'footer1',
    title: 'We Clean. You Relax.',
    highlightText: 'ZAFABIT',
    subtitle: 'Trusted by 200k+ families',
    isActive: true,
    translations: {},
  };

  const makeMockDoc = (data) => {
    if (!data) return null;
    return {
      ...data,
      toObject: function () {
        return data;
      },
      save: jest.fn().mockResolvedValue(true),
      deleteOne: jest.fn().mockResolvedValue(true),
      markModified: jest.fn(),
    };
  };

  return {
    HeroBanner: {
      find: jest.fn().mockReturnValue({
        sort: mockSortBanners,
      }),
    },
    FeaturedService: {
      find: jest.fn().mockReturnValue({
        populate: mockPopulateFeatured,
      }),
    },
    TrustCard: {
      find: jest.fn().mockImplementation(() => ({
        sort: jest.fn().mockResolvedValue(localTrustCards.map(makeMockDoc)),
      })),
      findById: jest.fn().mockImplementation((id) => {
        const found = localTrustCards.find((t) => t._id === id);
        return Promise.resolve(makeMockDoc(found));
      }),
      create: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve(makeMockDoc({ _id: 'new_trust', ...data, translations: {} })),
        ),
      findByIdAndUpdate: jest.fn().mockImplementation((id, data) => {
        const item = localTrustCards.find((t) => t._id === id);
        return Promise.resolve(makeMockDoc(item ? { ...item, ...data } : null));
      }),
      findByIdAndDelete: jest.fn().mockImplementation((id) => {
        const item = localTrustCards.find((t) => t._id === id);
        return Promise.resolve(makeMockDoc(item));
      }),
    },
    FooterBanner: {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(makeMockDoc(localFooterBanner))),
      findOneAndUpdate: jest.fn().mockImplementation((query, data, options) => {
        localFooterBanner = { ...localFooterBanner, ...data };
        return Promise.resolve(makeMockDoc(localFooterBanner));
      }),
      create: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve(makeMockDoc({ _id: 'new_footer', ...data, translations: {} })),
        ),
    },
    SplashContent: {},
  };
});

jest.mock('../models/Service', () => {
  const localServices = [
    {
      _id: 'service1',
      name: 'Bathroom Cleaning',
      category: 'Bathroom Cleaning',
      price: 150,
      originalPrice: 180,
      estimatedTime: 30,
      description: 'Bathroom surface cleaning',
      status: 'active',
      whatsIncluded: [],
      doesNotInclude: [],
      faqs: [],
      howItsDone: [],
      translations: {},
    },
  ];

  const mockSortServices = jest.fn().mockResolvedValue(localServices);
  return {
    find: jest.fn().mockReturnValue({
      sort: mockSortServices,
    }),
  };
});

describe('Consolidated Home Feed API', () => {
  it('returns all home feed data including banners, greeting, and featured services in one call', async () => {
    const token = jwt.sign({ id: 'mock_user_id' }, process.env.JWT_SECRET || 'zaffabit_jwt_secret');

    const res = await request(app)
      .get('/api/v1/content/home')
      .set('Authorization', `Bearer ${token}`)
      .set('locale', 'en');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Home data retrieved');
    expect(res.body.data).toBeDefined();

    const {
      banners,
      greeting,
      featured,
      avatarUrl,
      unreadNotificationsCount,
      trustCards,
      footerBanner,
    } = res.body.data;

    expect(banners).toBeDefined();
    expect(Array.isArray(banners)).toBe(true);
    expect(banners[0].title).toBe('Professional Deep Cleaning');

    expect(greeting).toBeDefined();
    expect(greeting).toContain('Reno');

    expect(avatarUrl).toBe('http://test.com/avatar.jpg');
    expect(unreadNotificationsCount).toBe(5);

    expect(featured).toBeDefined();
    expect(Array.isArray(featured)).toBe(true);
    expect(featured[0].label).toBe('Standard Wash');

    expect(trustCards).toBeDefined();
    expect(Array.isArray(trustCards)).toBe(true);
    expect(trustCards[0].title).toBe('Verified Professionals You Can Trust');

    expect(footerBanner).toBeDefined();
    expect(footerBanner.title).toBe('We Clean. You Relax.');
    expect(footerBanner.highlightText).toBe('ZAFABIT');
    expect(footerBanner.subtitle).toBe('Trusted by 200k+ families');
  });
});

describe('Trust Cards & Footer Banner Admin APIs', () => {
  let token;
  beforeAll(() => {
    token = jwt.sign({ id: 'mock_user_id' }, process.env.JWT_SECRET || 'zaffabit_jwt_secret');
  });

  it('GET /api/v1/content/trust-cards - list trust cards', async () => {
    const res = await request(app)
      .get('/api/v1/content/trust-cards')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.trustCards)).toBe(true);
  });

  it('POST /api/v1/content/trust-cards - create trust card', async () => {
    const res = await request(app)
      .post('/api/v1/content/trust-cards')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Super Fast Service')
      .field('order', 1);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.trustCard.title).toBe('Super Fast Service');
  });

  it('PUT /api/v1/content/trust-cards/:id - update trust card', async () => {
    const res = await request(app)
      .put('/api/v1/content/trust-cards/trust1')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Updated Trust Title');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.trustCard.title).toBe('Updated Trust Title');
  });

  it('DELETE /api/v1/content/trust-cards/:id - delete trust card', async () => {
    const res = await request(app)
      .delete('/api/v1/content/trust-cards/trust1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/v1/content/footer-banner - get footer banner details', async () => {
    const res = await request(app)
      .get('/api/v1/content/footer-banner')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.footerBanner.title).toBe('We Clean. You Relax.');
  });

  it('PUT /api/v1/content/footer-banner - update footer banner details', async () => {
    const res = await request(app)
      .put('/api/v1/content/footer-banner')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'New Clean Title',
        highlightText: 'SUPERB',
        subtitle: 'Loved by all',
        isActive: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.footerBanner.title).toBe('New Clean Title');
  });
});
