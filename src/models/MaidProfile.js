const mongoose = require('mongoose');

const MaidProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // Verification
    documents: [
      {
        type: { type: String }, // ID Proof, Address Proof, etc.
        url: { type: String },
        status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
      },
    ],
    selfieUrl: { type: String },
    isIdentityVerified: { type: Boolean, default: false },

    // Status
    activeStatus: {
      type: String,
      enum: ['active', 'inactive', 'on-hold'],
      default: 'inactive',
    },
    isAvailable: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },

    // ── Onboarding Preferences ──────────────────────────────────────────
    language: {
      type: String,
      enum: ['en', 'ml', 'hi', 'ta'],
      default: 'en',
    },

    // Step 2 of 4 — Preferred Job Type
    jobType: {
      type: String,
      enum: ['full_time', 'part_time', 'weekend_only', 'morning_shift', 'evening_shift'],
      default: null,
    },

    // Step 3 of 4 — Work Area Preferences
    workAreas: [
      {
        type: String,
        trim: true,
      },
    ],

    // Tracks which onboarding step the maid has completed (0 = none, 4 = done)
    onboardingStep: {
      type: Number,
      default: 0,
      min: 0,
      max: 4,
    },
    // ───────────────────────────────────────────────────────────────────

    // Financials
    totalEarnings: { type: Number, default: 0 },
    referralIncentives: { type: Number, default: 0 },

    // Metadata
    zone: { type: String },
    referredByAgent: { type: String }, // Agent Code
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    completedJobs: { type: Number, default: 0 },

    // Live Tracking
    lastLocation: {
      lat: { type: Number },
      lng: { type: Number },
      lastUpdated: { type: Date },
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        default: undefined,
      },
    },
    lastLocationUpdatedAt: { type: Date },
  },
  { timestamps: true },
);

MaidProfileSchema.index({ currentLocation: '2dsphere' });
MaidProfileSchema.index({ isIdentityVerified: 1, createdAt: -1 });
MaidProfileSchema.index({
  activeStatus: 1,
  isAvailable: 1,
  isOnline: 1,
  isIdentityVerified: 1,
  lastLocationUpdatedAt: -1,
});

module.exports = mongoose.model('MaidProfile', MaidProfileSchema);
