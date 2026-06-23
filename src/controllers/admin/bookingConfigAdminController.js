const BookingConfig = require('../../models/BookingConfig');
const { sendResponse } = require('../../utils/apiResponse');
const { DEFAULT_BOOKING_CONFIG } = require('../../utils/billingConfig');
const { logAdminActivity } = require('../../utils/adminActivityLogger');

/**
 * @desc    Get current booking schedule configuration
 * @route   GET /api/v1/admin/config/booking
 */
exports.getBookingConfig = async (req, res, next) => {
  try {
    let config = await BookingConfig.findOne({ isActive: true });
    if (!config) {
      config = await BookingConfig.create(DEFAULT_BOOKING_CONFIG);
    }
    return sendResponse(res, 200, 'Booking configuration retrieved', config);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update booking schedule configuration
 * @route   PUT /api/v1/admin/config/booking
 */
exports.updateBookingConfig = async (req, res, next) => {
  try {
    const {
      slots,
      daysAhead,
      platformFee,
      gstPercent,
      maidSharePercent,
      referralWelcomeBonus,
      referrerReward,
    } = req.body;

    let config = await BookingConfig.findOne({ isActive: true });

    if (!config) {
      config = await BookingConfig.create({
        slots,
        daysAhead,
        platformFee,
        gstPercent,
        maidSharePercent,
        referralWelcomeBonus,
        referrerReward,
      });
    } else {
      if (slots !== undefined) config.slots = slots;
      if (daysAhead !== undefined) config.daysAhead = daysAhead;
      if (platformFee !== undefined) config.platformFee = platformFee;
      if (gstPercent !== undefined) config.gstPercent = gstPercent;
      if (maidSharePercent !== undefined) config.maidSharePercent = maidSharePercent;
      if (referralWelcomeBonus !== undefined) config.referralWelcomeBonus = referralWelcomeBonus;
      if (referrerReward !== undefined) config.referrerReward = referrerReward;
      await config.save();
    }

    if (req.user && req.user._id) {
      await logAdminActivity(
        req.user._id,
        'UPDATE_BOOKING_CONFIG',
        `Updated booking config: daysAhead=${config.daysAhead}, slotsCount=${config.slots.length}, platformFee=${config.platformFee}, gstPercent=${config.gstPercent}, maidSharePercent=${config.maidSharePercent}, referralWelcomeBonus=${config.referralWelcomeBonus}, referrerReward=${config.referrerReward}`,
      );
    }

    return sendResponse(res, 200, 'Booking configuration updated successfully', config);
  } catch (error) {
    next(error);
  }
};
