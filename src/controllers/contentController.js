const {
  HeroBanner,
  SplashContent,
  FeaturedService,
  TrustCard,
  FooterBanner,
} = require('../models/AppContent');
const {
  translateBanner,
  translateSplash,
  translateFeaturedService,
  translateTrust,
  translateFooter,
  mapContentTranslations,
  mapServiceTranslations,
} = require('../utils/translate');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { destroyCloudinaryAsset, uploadBufferToCloudinary } = require('../utils/cloudinaryUpload');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../utils/authToken');
const User = require('../models/User');

const GREET_TRANSLATIONS = {
  'Good Morning': { ml: 'സുപ്രഭാതം', hi: 'शुभ प्रभात', ta: 'காலை வணக்கம்' },
  'Good Afternoon': { ml: 'ശുഭ ഉച്ചനേരം', hi: 'शुभ दोपहर', ta: 'மதிய வணக்கம்' },
  'Good Evening': { ml: 'ശുഭസായാഹ്നം', hi: 'शुभ संध्या', ta: 'மாலை வணக்கம்' },
  'Good Night': { ml: 'ശുഭരാത്രി', hi: 'शुभ रात्रि', ta: 'இனிய இரவு' },
};

const getGreetingText = (firstName, locale = 'en') => {
  const options = { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const hr = parseInt(formatter.format(new Date()), 10);

  let greet = 'Good Evening';
  let emoji = '☀';
  if (hr >= 5 && hr < 12) {
    greet = 'Good Morning';
    emoji = '☀';
  } else if (hr >= 12 && hr < 17) {
    greet = 'Good Afternoon';
    emoji = '🌤';
  } else if (hr >= 17 && hr < 22) {
    greet = 'Good Evening';
    emoji = '🌆';
  } else {
    greet = 'Good Night';
    emoji = '🌙';
  }

  // Translate greet word if locale is not English
  const translatedGreet =
    locale !== 'en' && GREET_TRANSLATIONS[greet] && GREET_TRANSLATIONS[greet][locale]
      ? GREET_TRANSLATIONS[greet][locale]
      : greet;

  return firstName ? `${emoji} ${translatedGreet}, ${firstName}` : `${emoji} ${translatedGreet}`;
};

const getOptionalUser = async (req) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    console.log('[getOptionalUser] No Bearer token found in request headers');
    return null;
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const user = await User.findById(decoded.id);
    if (!user) {
      console.log('[getOptionalUser] No user found for decoded ID:', decoded.id);
    }
    return user;
  } catch (err) {
    console.log('[getOptionalUser] JWT verification failed:', err.message);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  HERO BANNERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/content/banners
 * Public — returns all active banners sorted by order
 */
exports.listBanners = async (req, res, next) => {
  try {
    const all = req.query.all === 'true'; // admin wants all including inactive
    const query = all ? {} : { isActive: true };
    const banners = await HeroBanner.find(query).sort({ order: 1, createdAt: -1 });

    const locale = req.headers['locale'] || 'en';
    const mappedBanners = banners.map((b) => mapContentTranslations(b, locale, 'banner'));

    // Optional personalized greeting if Bearer token is provided
    let greeting = '';
    const user = await getOptionalUser(req);
    if (user) {
      const name = user.firstName || user.name || '';
      greeting = getGreetingText(name, locale);
    } else {
      greeting = getGreetingText('', locale);
    }

    return sendResponse(res, 200, 'Banners fetched', { banners: mappedBanners, greeting });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/content/banners
 * Admin — create a new banner (with optional image upload)
 */
exports.createBanner = async (req, res, next) => {
  try {
    const { title, subtitle, ctaLabel, ctaLink, isActive, order } = req.body;

    let imageUrl = '';
    let imagePublicId = '';

    if (req.file) {
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/banners');
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;
    }

    const bannerData = {
      title,
      subtitle,
      imageUrl,
      imagePublicId,
      ctaLabel: ctaLabel || 'Get Started',
      ctaLink,
      isActive: isActive !== 'false' && isActive !== false,
      order: Number(order) || 0,
    };

    // Auto-translate using Google Translate free Web API
    const translations = await translateBanner(bannerData);
    if (translations) {
      bannerData.translations = translations;
    }

    const banner = await HeroBanner.create(bannerData);

    return sendResponse(res, 201, 'Banner created', { banner });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/content/banners/:id
 * Admin — update banner text / image / status
 */
exports.updateBanner = async (req, res, next) => {
  try {
    const banner = await HeroBanner.findById(req.params.id);
    if (!banner) return sendError(res, 404, 'Banner not found', 'NOT_FOUND');

    const { title, subtitle, ctaLabel, ctaLink, isActive, order } = req.body;

    if (title !== undefined) banner.title = title;
    if (subtitle !== undefined) banner.subtitle = subtitle;
    if (ctaLabel !== undefined) banner.ctaLabel = ctaLabel;
    if (ctaLink !== undefined) banner.ctaLink = ctaLink;
    if (isActive !== undefined) banner.isActive = isActive !== 'false' && isActive !== false;
    if (order !== undefined) banner.order = Number(order);

    // Replace image if a new file is uploaded
    if (req.file) {
      // Delete old image from Cloudinary
      if (banner.imagePublicId) {
        await destroyCloudinaryAsset(banner.imagePublicId);
      }
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/banners');
      banner.imageUrl = result.secure_url;
      banner.imagePublicId = result.public_id;
    }

    // Auto-translate using Google Translate free Web API
    const translations = await translateBanner(banner);
    if (translations) {
      banner.translations = translations;
      banner.markModified('translations');
    }

    await banner.save();
    return sendResponse(res, 200, 'Banner updated', { banner });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/content/banners/:id
 * Admin — delete banner + remove image from Cloudinary
 */
exports.deleteBanner = async (req, res, next) => {
  try {
    const banner = await HeroBanner.findById(req.params.id);
    if (!banner) return sendError(res, 404, 'Banner not found', 'NOT_FOUND');

    if (banner.imagePublicId) {
      await destroyCloudinaryAsset(banner.imagePublicId);
    }

    await banner.deleteOne();
    return sendResponse(res, 200, 'Banner deleted');
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  SPLASH SCREEN CONTENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/content/splash
 * Public — returns active splash screen content managed from admin
 */
exports.listSplashContent = async (req, res, next) => {
  try {
    const all = req.query.all === 'true';
    const query = all ? {} : { isActive: true };
    const splash = await SplashContent.find(query).sort({ order: 1, createdAt: -1 });

    const locale = req.headers['locale'] || 'en';
    const mappedSplash = splash.map((s) => mapContentTranslations(s, locale, 'splash'));

    return sendResponse(res, 200, 'Splash content fetched', { splash: mappedSplash });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/content/splash
 * Admin — create splash screen content
 */
exports.createSplashContent = async (req, res, next) => {
  try {
    const { title, subtitle, ctaLabel, isActive, order } = req.body;

    let imageUrl = '';
    let imagePublicId = '';

    if (req.file) {
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/splash');
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;
    }

    const splashData = {
      title,
      subtitle,
      imageUrl,
      imagePublicId,
      ctaLabel: ctaLabel || 'Get Started',
      isActive: isActive !== 'false' && isActive !== false,
      order: Number(order) || 0,
    };

    // Auto-translate using Google Translate free Web API
    const translations = await translateSplash(splashData);
    if (translations) {
      splashData.translations = translations;
    }

    const splash = await SplashContent.create(splashData);

    return sendResponse(res, 201, 'Splash content created', { splash });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/content/splash/:id
 * Admin — update splash screen content
 */
exports.updateSplashContent = async (req, res, next) => {
  try {
    const splash = await SplashContent.findById(req.params.id);
    if (!splash) return sendError(res, 404, 'Splash content not found', 'NOT_FOUND');

    const { title, subtitle, ctaLabel, isActive, order } = req.body;

    if (title !== undefined) splash.title = title;
    if (subtitle !== undefined) splash.subtitle = subtitle;
    if (ctaLabel !== undefined) splash.ctaLabel = ctaLabel;
    if (isActive !== undefined) splash.isActive = isActive !== 'false' && isActive !== false;
    if (order !== undefined) splash.order = Number(order);

    if (req.file) {
      if (splash.imagePublicId) {
        await destroyCloudinaryAsset(splash.imagePublicId);
      }
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/splash');
      splash.imageUrl = result.secure_url;
      splash.imagePublicId = result.public_id;
    }

    // Auto-translate using Google Translate free Web API
    const translations = await translateSplash(splash);
    if (translations) {
      splash.translations = translations;
      splash.markModified('translations');
    }

    await splash.save();
    return sendResponse(res, 200, 'Splash content updated', { splash });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/content/splash/:id
 * Admin — delete splash screen content
 */
exports.deleteSplashContent = async (req, res, next) => {
  try {
    const splash = await SplashContent.findById(req.params.id);
    if (!splash) return sendError(res, 404, 'Splash content not found', 'NOT_FOUND');

    if (splash.imagePublicId) {
      await destroyCloudinaryAsset(splash.imagePublicId);
    }

    await splash.deleteOne();
    return sendResponse(res, 200, 'Splash content deleted');
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  FEATURED / OUR SERVICES (Home Section)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/content/featured-services
 * Public — returns active featured services (mobile home screen)
 */
exports.listFeaturedServices = async (req, res, next) => {
  try {
    const all = req.query.all === 'true';
    const query = all ? {} : { isActive: true };
    const featured = await FeaturedService.find(query)
      .populate(
        'serviceId',
        'name category price originalPrice estimatedTime description image whatsIncluded doesNotInclude howItsDone faqs translations',
      )
      .sort({ order: 1, createdAt: -1 });

    const locale = req.headers['locale'] || 'en';
    const mappedFeatured = featured.map((f) => {
      const fObj = mapContentTranslations(f, locale, 'featured');
      if (fObj.serviceId) {
        fObj.serviceId = mapServiceTranslations(fObj.serviceId, locale);
      }
      return fObj;
    });

    return sendResponse(res, 200, 'Featured services fetched', { featured: mappedFeatured });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/content/featured-services
 * Admin — pin a service to the home section
 */
exports.createFeaturedService = async (req, res, next) => {
  try {
    const { serviceId, label, highlight, isActive, order } = req.body;

    let iconUrl = '';
    let iconPublicId = '';

    if (req.file) {
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/service-icons');
      iconUrl = result.secure_url;
      iconPublicId = result.public_id;
    }

    const featuredData = {
      serviceId,
      label,
      iconUrl,
      iconPublicId,
      highlight,
      isActive: isActive !== 'false' && isActive !== false,
      order: Number(order) || 0,
    };

    // Auto-translate using Google Translate free Web API
    const translations = await translateFeaturedService(featuredData);
    if (translations) {
      featuredData.translations = translations;
    }

    const featured = await FeaturedService.create(featuredData);

    return sendResponse(res, 201, 'Featured service added', { featured });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/content/featured-services/:id
 */
exports.updateFeaturedService = async (req, res, next) => {
  try {
    const item = await FeaturedService.findById(req.params.id);
    if (!item) return sendError(res, 404, 'Featured service not found', 'NOT_FOUND');

    const { label, highlight, isActive, order } = req.body;
    if (label !== undefined) item.label = label;
    if (highlight !== undefined) item.highlight = highlight;
    if (isActive !== undefined) item.isActive = isActive !== 'false' && isActive !== false;
    if (order !== undefined) item.order = Number(order);

    if (req.file) {
      if (item.iconPublicId) {
        await destroyCloudinaryAsset(item.iconPublicId);
      }
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/service-icons');
      item.iconUrl = result.secure_url;
      item.iconPublicId = result.public_id;
    }

    // Auto-translate using Google Translate free Web API
    const translations = await translateFeaturedService(item);
    if (translations) {
      item.translations = translations;
      item.markModified('translations');
    }

    await item.save();
    return sendResponse(res, 200, 'Featured service updated', { featured: item });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/content/featured-services/:id
 */
exports.deleteFeaturedService = async (req, res, next) => {
  try {
    const item = await FeaturedService.findById(req.params.id);
    if (!item) return sendError(res, 404, 'Featured service not found', 'NOT_FOUND');

    if (item.iconPublicId) {
      await destroyCloudinaryAsset(item.iconPublicId);
    }

    await item.deleteOne();
    return sendResponse(res, 200, 'Featured service removed');
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/content/home
 * Public (with optional auth for personalized greeting)
 * Returns all home screen data: banners, greeting, featured services, and all active services.
 */
exports.getHomeData = async (req, res, next) => {
  try {
    const locale = req.headers['locale'] || 'en';

    // 1. Fetch active banners sorted by order
    const banners = await HeroBanner.find({ isActive: true }).sort({ order: 1, createdAt: -1 });
    const mappedBanners = banners.map((b) => mapContentTranslations(b, locale, 'banner'));

    // Optional personalized greeting if Bearer token is provided
    let greeting = '';
    let avatarUrl = '';
    let unreadNotificationsCount = 0;
    const user = await getOptionalUser(req);
    if (user) {
      const name = user.firstName || user.name || '';
      greeting = getGreetingText(name, locale);
      avatarUrl = user.avatarUrl || '';
      const Notification = require('../models/Notification');
      unreadNotificationsCount = await Notification.countDocuments({
        recipient: user._id,
        isRead: false,
      });
    } else {
      greeting = getGreetingText('', locale);
    }

    // 2. Fetch active featured services (mobile home screen)
    const featured = await FeaturedService.find({ isActive: true })
      .populate(
        'serviceId',
        'name category price originalPrice estimatedTime description image whatsIncluded doesNotInclude howItsDone faqs translations',
      )
      .sort({ order: 1, createdAt: -1 });

    const mappedFeatured = featured.map((f) => {
      const fObj = mapContentTranslations(f, locale, 'featured');
      if (fObj.serviceId) {
        fObj.serviceId = mapServiceTranslations(fObj.serviceId, locale);
      }
      return fObj;
    });

    // 3. Fetch trust cards (Reliable & Trustworthy)
    let trustCards = await TrustCard.find({ isActive: true }).sort({ order: 1 });
    if (!trustCards || trustCards.length === 0) {
      // Fallback defaults matching the screenshot
      trustCards = [
        {
          _id: 'default_trust_1',
          title: 'Verified Professionals You Can Trust',
          imageUrl:
            'https://res.cloudinary.com/dydsfw6w7/image/upload/v1780634548/zaffabit/trust/trust1.png',
          isActive: true,
          order: 0,
        },
        {
          _id: 'default_trust_2',
          title: 'Well Trained to Deliver Great Service',
          imageUrl:
            'https://res.cloudinary.com/dydsfw6w7/image/upload/v1780634548/zaffabit/trust/trust2.png',
          isActive: true,
          order: 1,
        },
        {
          _id: 'default_trust_3',
          title: 'Safe, Reliable, and Consistent Every Single Time',
          imageUrl:
            'https://res.cloudinary.com/dydsfw6w7/image/upload/v1780634548/zaffabit/trust/trust3.png',
          isActive: true,
          order: 2,
        },
      ];
    }
    const mappedTrustCards = trustCards.map((t) => mapContentTranslations(t, locale, 'trust'));

    // 4. Fetch footer banner ("We Clean. You Relax. ZAFABIT")
    let footerBanner = await FooterBanner.findOne({ isActive: true });
    if (!footerBanner) {
      // Fallback default matching the screenshot
      footerBanner = {
        _id: 'default_footer_1',
        title: 'We Clean. You Relax.',
        highlightText: 'ZAFABIT',
        subtitle: 'Trusted by 200k+ families',
        isActive: true,
      };
    }
    const mappedFooterBanner = mapContentTranslations(footerBanner, locale, 'footer');

    return sendResponse(res, 200, 'Home data retrieved', {
      banners: mappedBanners,
      greeting,
      avatarUrl,
      unreadNotificationsCount,
      featured: mappedFeatured,
      trustCards: mappedTrustCards,
      footerBanner: mappedFooterBanner,
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  TRUST CARDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/content/trust-cards
 * Admin/Public — list all trust cards
 */
exports.listTrustCards = async (req, res, next) => {
  try {
    const all = req.query.all === 'true';
    const query = all ? {} : { isActive: true };
    const trustCards = await TrustCard.find(query).sort({ order: 1, createdAt: -1 });

    const locale = req.headers['locale'] || 'en';
    const mappedTrustCards = trustCards.map((t) => mapContentTranslations(t, locale, 'trust'));

    return sendResponse(res, 200, 'Trust cards fetched', { trustCards: mappedTrustCards });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/content/trust-cards
 * Admin — create a trust card
 */
exports.createTrustCard = async (req, res, next) => {
  try {
    const { title, isActive, order } = req.body;

    let imageUrl = '';
    let imagePublicId = '';

    if (req.file) {
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/trust');
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;
    }

    const trustData = {
      title,
      imageUrl,
      imagePublicId,
      isActive: isActive !== 'false' && isActive !== false,
      order: Number(order) || 0,
    };

    // Auto-translate using Google Translate free Web API
    const translations = await translateTrust(trustData);
    if (translations) {
      trustData.translations = translations;
    }

    const trustCard = await TrustCard.create(trustData);

    return sendResponse(res, 201, 'Trust card created', { trustCard });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/content/trust-cards/:id
 * Admin — update trust card
 */
exports.updateTrustCard = async (req, res, next) => {
  try {
    const trustCard = await TrustCard.findById(req.params.id);
    if (!trustCard) return sendError(res, 404, 'Trust card not found', 'NOT_FOUND');

    const { title, isActive, order } = req.body;

    if (title !== undefined) trustCard.title = title;
    if (isActive !== undefined) trustCard.isActive = isActive !== 'false' && isActive !== false;
    if (order !== undefined) trustCard.order = Number(order);

    if (req.file) {
      if (trustCard.imagePublicId) {
        await destroyCloudinaryAsset(trustCard.imagePublicId);
      }
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/trust');
      trustCard.imageUrl = result.secure_url;
      trustCard.imagePublicId = result.public_id;
    }

    // Auto-translate
    const translations = await translateTrust(trustCard);
    if (translations) {
      trustCard.translations = translations;
      trustCard.markModified('translations');
    }

    await trustCard.save();
    return sendResponse(res, 200, 'Trust card updated', { trustCard });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/content/trust-cards/:id
 * Admin — delete trust card
 */
exports.deleteTrustCard = async (req, res, next) => {
  try {
    const trustCard = await TrustCard.findById(req.params.id);
    if (!trustCard) return sendError(res, 404, 'Trust card not found', 'NOT_FOUND');

    if (trustCard.imagePublicId) {
      await destroyCloudinaryAsset(trustCard.imagePublicId);
    }

    await trustCard.deleteOne();
    return sendResponse(res, 200, 'Trust card deleted');
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  FOOTER BANNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/content/footer-banner
 * Admin/Public — get active footer banner (or create default)
 */
exports.getFooterBanner = async (req, res, next) => {
  try {
    let footerBanner = await FooterBanner.findOne({});
    if (!footerBanner) {
      // Create default if not exists
      footerBanner = await FooterBanner.create({
        title: 'We Clean. You Relax.',
        highlightText: 'ZAFABIT',
        subtitle: 'Trusted by 200k+ families',
        isActive: true,
      });
    }

    const locale = req.headers['locale'] || 'en';
    const mappedFooterBanner = mapContentTranslations(footerBanner, locale, 'footer');

    // Keep translations inside for editing
    if (req.query.all === 'true') {
      return sendResponse(res, 200, 'Footer banner fetched', { footerBanner });
    }

    return sendResponse(res, 200, 'Footer banner fetched', { footerBanner: mappedFooterBanner });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/content/footer-banner
 * Admin — update footer banner (or create if not exist)
 */
exports.updateFooterBanner = async (req, res, next) => {
  try {
    const { title, highlightText, subtitle, isActive } = req.body;

    let footerBanner = await FooterBanner.findOne({});
    if (!footerBanner) {
      footerBanner = new FooterBanner();
    }

    if (title !== undefined) footerBanner.title = title;
    if (highlightText !== undefined) footerBanner.highlightText = highlightText;
    if (subtitle !== undefined) footerBanner.subtitle = subtitle;
    if (isActive !== undefined) footerBanner.isActive = isActive !== 'false' && isActive !== false;

    // Auto-translate
    const translations = await translateFooter(footerBanner);
    if (translations) {
      footerBanner.translations = translations;
      footerBanner.markModified('translations');
    }

    await footerBanner.save();
    return sendResponse(res, 200, 'Footer banner updated', { footerBanner });
  } catch (error) {
    next(error);
  }
};
