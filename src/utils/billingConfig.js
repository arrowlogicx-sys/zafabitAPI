const BookingConfig = require('../models/BookingConfig');

const DEFAULT_BOOKING_CONFIG = {
  slots: ['08:00 AM', '10:00 AM', '12:00 PM', '02:00 PM', '04:00 PM', '06:00 PM'],
  daysAhead: 7,
  platformFee: 29,
  gstPercent: 9,
  maidSharePercent: 70,
  referralWelcomeBonus: 100,
  referrerReward: 100,
};

async function getActiveBookingConfig() {
  let config = await BookingConfig.findOne({ isActive: true });
  if (!config) {
    config = await BookingConfig.create(DEFAULT_BOOKING_CONFIG);
  }
  return config;
}

function calculateBookingTotals(subtotal, itemCount, config = {}) {
  const safeSubtotal = Number(subtotal || 0);
  const safeItemCount = Number(itemCount || 0);
  const platformFee =
    safeItemCount > 0 ? Number(config.platformFee ?? DEFAULT_BOOKING_CONFIG.platformFee) : 0;
  const gstPercent = Number(config.gstPercent ?? DEFAULT_BOOKING_CONFIG.gstPercent);
  const maidSharePercent = Number(
    config.maidSharePercent ?? DEFAULT_BOOKING_CONFIG.maidSharePercent,
  );
  const gst = Math.round(safeSubtotal * (gstPercent / 100));
  const totalAmount = safeSubtotal + platformFee + gst;
  const maidShareAmount = Math.round(safeSubtotal * (maidSharePercent / 100));
  const companyShareAmount = safeSubtotal - maidShareAmount;
  const companyRevenueAmount = companyShareAmount + platformFee;

  return {
    subtotal: safeSubtotal,
    platformFee,
    gstPercent,
    maidSharePercent,
    gst,
    taxAmount: gst,
    totalAmount,
    grossAmount: totalAmount,
    maidShareAmount,
    companyShareAmount,
    companyRevenueAmount,
  };
}

function resolveBookingFinanceSnapshot(booking, config = {}) {
  const subtotal = Number(booking?.subtotal || 0);
  const platformFee = Number(
    booking?.platformFee ?? config.platformFee ?? DEFAULT_BOOKING_CONFIG.platformFee,
  );
  const gstPercent = Number(
    booking?.gstPercent ?? config.gstPercent ?? DEFAULT_BOOKING_CONFIG.gstPercent,
  );
  const maidSharePercent = Number(
    booking?.maidSharePercent ?? config.maidSharePercent ?? DEFAULT_BOOKING_CONFIG.maidSharePercent,
  );
  const gst = Number(
    booking?.taxAmount ?? booking?.gst ?? Math.round(subtotal * (gstPercent / 100)),
  );
  const maidShareAmount = Number(
    booking?.maidShareAmount ?? Math.round(subtotal * (maidSharePercent / 100)),
  );
  const companyShareAmount = Number(booking?.companyShareAmount ?? subtotal - maidShareAmount);
  const companyRevenueAmount = Number(
    booking?.companyRevenueAmount ?? companyShareAmount + platformFee,
  );
  const grossAmount = Number(booking?.grossAmount ?? subtotal + platformFee + gst);
  const totalAmount = Number(booking?.totalAmount ?? grossAmount);

  return {
    subtotal,
    platformFee,
    gstPercent,
    maidSharePercent,
    gst,
    taxAmount: gst,
    totalAmount,
    grossAmount,
    maidShareAmount,
    companyShareAmount,
    companyRevenueAmount,
  };
}

function financeAggregationStages() {
  return [
    {
      $addFields: {
        financeSubtotal: { $ifNull: ['$subtotal', 0] },
        financePlatformFee: { $ifNull: ['$platformFee', 0] },
        financeTaxAmount: { $ifNull: ['$taxAmount', { $ifNull: ['$gst', 0] }] },
        financeMaidSharePercent: {
          $ifNull: ['$maidSharePercent', DEFAULT_BOOKING_CONFIG.maidSharePercent],
        },
      },
    },
    {
      $addFields: {
        financeMaidShareAmount: {
          $ifNull: [
            '$maidShareAmount',
            {
              $round: [
                { $multiply: ['$financeSubtotal', { $divide: ['$financeMaidSharePercent', 100] }] },
                0,
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        financeCompanyShareAmount: {
          $ifNull: [
            '$companyShareAmount',
            { $subtract: ['$financeSubtotal', '$financeMaidShareAmount'] },
          ],
        },
        financeGrossAmount: {
          $ifNull: [
            '$grossAmount',
            { $add: ['$financeSubtotal', '$financePlatformFee', '$financeTaxAmount'] },
          ],
        },
      },
    },
    {
      $addFields: {
        financeCompanyRevenueAmount: {
          $ifNull: [
            '$companyRevenueAmount',
            { $add: ['$financeCompanyShareAmount', '$financePlatformFee'] },
          ],
        },
      },
    },
  ];
}

module.exports = {
  DEFAULT_BOOKING_CONFIG,
  getActiveBookingConfig,
  calculateBookingTotals,
  resolveBookingFinanceSnapshot,
  financeAggregationStages,
};
