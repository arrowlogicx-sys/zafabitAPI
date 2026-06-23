const PromoCode = require('../models/PromoCode');
const { sendResponse, sendError } = require('../utils/apiResponse');

/**
 * @desc    Get all promotional codes (Admin)
 * @route   GET /api/v1/admin/promotions
 */
exports.getPromotions = async (req, res, next) => {
  try {
    const filter = {};

    if (req.query.search) {
      filter.code = { $regex: req.query.search, $options: 'i' };
    }

    if (req.query.status && req.query.status !== 'ALL') {
      filter.status = req.query.status.toLowerCase();
    }

    if (req.query.type && req.query.type !== 'ALL') {
      filter.type = req.query.type.toLowerCase();
    }

    const promotions = await PromoCode.find(filter).sort('-createdAt');
    return sendResponse(res, 200, 'Promotions retrieved successfully', { promotions });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create promotional discount code (Admin)
 * @route   POST /api/v1/admin/promotions
 */
exports.createPromotion = async (req, res, next) => {
  try {
    const {
      code,
      description,
      type,
      discountValue,
      maxDiscount,
      minBookingAmount,
      expiryDate,
      usageLimit,
    } = req.body;

    if (!code || !description || !discountValue) {
      return sendError(
        res,
        400,
        'Code, description and discount value are required',
        'VALIDATION_ERROR',
      );
    }

    // Check unique code
    const existing = await PromoCode.findOne({ code: code.toUpperCase() });
    if (existing) {
      return sendError(res, 400, 'A promotion with this code already exists', 'DUPLICATE_CODE');
    }

    const newPromo = await PromoCode.create({
      code: code.toUpperCase(),
      description,
      type: type || 'percentage',
      discountValue,
      maxDiscount,
      minBookingAmount: minBookingAmount || 0,
      expiryDate: expiryDate || undefined,
      usageLimit: usageLimit || undefined,
      status: 'active',
    });

    return sendResponse(res, 201, 'Promotion created successfully', { promotion: newPromo });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete promotional code (Admin)
 * @route   DELETE /api/v1/admin/promotions/:id
 */
exports.deletePromotion = async (req, res, next) => {
  try {
    const promo = await PromoCode.findByIdAndDelete(req.params.id);
    if (!promo) {
      return sendError(res, 404, 'Promotion not found', 'NOT_FOUND');
    }
    return sendResponse(res, 200, 'Promotion deleted successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Validate promotional discount code (Customer Checkout)
 * @route   POST /api/v1/promotions/validate
 */
exports.validatePromo = async (req, res, next) => {
  try {
    const { code, bookingAmount } = req.body;

    if (!code || bookingAmount === undefined) {
      return sendError(res, 400, 'Code and bookingAmount are required', 'VALIDATION_ERROR');
    }

    const promo = await PromoCode.findOne({ code: code.toUpperCase() });
    if (!promo) {
      return sendError(res, 404, 'Promo code not found or invalid', 'NOT_FOUND');
    }

    if (promo.status !== 'active') {
      return sendError(res, 400, `This promo code is currently ${promo.status}`, 'INVALID_CODE');
    }

    // Expiry Check
    if (promo.expiryDate && new Date(promo.expiryDate) < new Date()) {
      promo.status = 'expired';
      await promo.save();
      return sendError(res, 400, 'This promo code has expired', 'EXPIRED_CODE');
    }

    // Usage Limit Check
    if (promo.usageLimit !== undefined && promo.redemptionsCount >= promo.usageLimit) {
      return sendError(res, 400, 'This promo code has reached its usage limit', 'LIMIT_REACHED');
    }

    // Minimum Booking Amount Check
    if (Number(bookingAmount) < promo.minBookingAmount) {
      return sendError(
        res,
        400,
        `Minimum booking amount of ₹${promo.minBookingAmount} is required to apply this coupon`,
        'MINIMUM_AMOUNT_NOT_MET',
      );
    }

    // Discount Calculation
    let discountAmount = 0;
    if (promo.type === 'percentage') {
      discountAmount = Math.round((Number(bookingAmount) * promo.discountValue) / 100);
      if (promo.maxDiscount) {
        discountAmount = Math.min(discountAmount, promo.maxDiscount);
      }
    } else if (promo.type === 'flat') {
      discountAmount = Math.min(promo.discountValue, Number(bookingAmount));
    }

    const finalAmount = Math.max(0, Number(bookingAmount) - discountAmount);

    return sendResponse(res, 200, 'Promo code is valid', {
      code: promo.code,
      description: promo.description,
      discountAmount,
      finalAmount,
    });
  } catch (error) {
    next(error);
  }
};
