const mongoose = require('mongoose');

// ─── Hero Banner Schema ──────────────────────────────────────────────
const heroBannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    subtitle: { type: String },
    imageUrl: { type: String }, // Cloudinary secure_url
    imagePublicId: { type: String }, // Cloudinary public_id for deletion
    ctaLabel: { type: String, default: 'Get Started' },
    ctaLink: { type: String },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    translations: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

// ─── Splash Screen Content Schema ──────────────────────────────────
const splashContentSchema = new mongoose.Schema(
  {
    title: { type: String, default: 'Zaffabit' },
    subtitle: { type: String },
    imageUrl: { type: String },
    imagePublicId: { type: String },
    ctaLabel: { type: String, default: 'Get Started' },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    translations: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

// ─── Featured Service Config Schema ─────────────────────────────────
const featuredServiceSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    label: { type: String }, // override display label if needed
    iconUrl: { type: String }, // Cloudinary icon
    iconPublicId: { type: String },
    highlight: { type: String }, // e.g. "Best Seller"
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    translations: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

const HeroBanner = mongoose.model('HeroBanner', heroBannerSchema);
const SplashContent = mongoose.model('SplashContent', splashContentSchema);
const FeaturedService = mongoose.model('FeaturedService', featuredServiceSchema);

// ─── Trust Card Schema ────────────────────────────────────────────────
const trustCardSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    imageUrl: { type: String },
    imagePublicId: { type: String },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    translations: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

// ─── Footer Banner Schema ──────────────────────────────────────────────
const footerBannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    highlightText: { type: String },
    subtitle: { type: String },
    isActive: { type: Boolean, default: true },
    translations: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

const TrustCard = mongoose.model('TrustCard', trustCardSchema);
const FooterBanner = mongoose.model('FooterBanner', footerBannerSchema);

module.exports = { HeroBanner, SplashContent, FeaturedService, TrustCard, FooterBanner };
