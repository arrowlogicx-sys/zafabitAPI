const mongoose = require('mongoose');

const BookingConfigSchema = new mongoose.Schema(
  {
    slots: {
      type: [String],
      default: ['08:00 AM', '10:00 AM', '12:00 PM', '02:00 PM', '04:00 PM', '06:00 PM'],
    },
    daysAhead: {
      type: Number,
      default: 7,
    },
    platformFee: {
      type: Number,
      default: 29,
      min: 0,
    },
    gstPercent: {
      type: Number,
      default: 9,
      min: 0,
    },
    maidSharePercent: {
      type: Number,
      default: 70,
      min: 0,
      max: 100,
    },
    referralWelcomeBonus: {
      type: Number,
      default: 100,
      min: 0,
    },
    referrerReward: {
      type: Number,
      default: 100,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('BookingConfig', BookingConfigSchema);
