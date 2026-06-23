const express = require('express');
const multer = require('multer');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  listSplashContent,
  createSplashContent,
  updateSplashContent,
  deleteSplashContent,
  listFeaturedServices,
  createFeaturedService,
  updateFeaturedService,
  deleteFeaturedService,
  getHomeData,
  listTrustCards,
  createTrustCard,
  updateTrustCard,
  deleteTrustCard,
  getFooterBanner,
  updateFooterBanner,
} = require('../controllers/contentController');

const router = express.Router();

// Use memory storage so we can pipe buffers directly to Cloudinary
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Consolidated Home Route ──────────────────────────────────────────────────
router.get('/home', getHomeData); // public / optional auth

// ─── Banner Routes ───────────────────────────────────────────────────────────
router.get('/banners', listBanners); // public
router.post('/banners', protect, restrictTo('admin'), upload.single('image'), createBanner); // admin
router.put('/banners/:id', protect, restrictTo('admin'), upload.single('image'), updateBanner); // admin
router.delete('/banners/:id', protect, restrictTo('admin'), deleteBanner); // admin

// ─── Splash Screen Content ─────────────────────────────────────────────────
router.get('/splash', listSplashContent); // public
router.post('/splash', protect, restrictTo('admin'), upload.single('image'), createSplashContent); // admin
router.put(
  '/splash/:id',
  protect,
  restrictTo('admin'),
  upload.single('image'),
  updateSplashContent,
); // admin
router.delete('/splash/:id', protect, restrictTo('admin'), deleteSplashContent); // admin

// ─── Featured Services (Home Section) ───────────────────────────────────────
router.get('/featured-services', listFeaturedServices); // public
router.post(
  '/featured-services',
  protect,
  restrictTo('admin'),
  upload.single('icon'),
  createFeaturedService,
); // admin
router.put(
  '/featured-services/:id',
  protect,
  restrictTo('admin'),
  upload.single('icon'),
  updateFeaturedService,
); // admin
router.delete('/featured-services/:id', protect, restrictTo('admin'), deleteFeaturedService); // admin

// ─── Trust Card Routes ──────────────────────────────────────────────────────
router.get('/trust-cards', listTrustCards); // public
router.post('/trust-cards', protect, restrictTo('admin'), upload.single('image'), createTrustCard); // admin
router.put(
  '/trust-cards/:id',
  protect,
  restrictTo('admin'),
  upload.single('image'),
  updateTrustCard,
); // admin
router.delete('/trust-cards/:id', protect, restrictTo('admin'), deleteTrustCard); // admin

// ─── Footer Banner Routes ────────────────────────────────────────────────────
router.get('/footer-banner', getFooterBanner); // public
router.put('/footer-banner', protect, restrictTo('admin'), updateFooterBanner); // admin

module.exports = router;
