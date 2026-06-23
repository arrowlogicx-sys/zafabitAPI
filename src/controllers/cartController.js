const Cart = require('../models/Cart');
const Service = require('../models/Service');
const User = require('../models/User');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { getActiveBookingConfig, calculateBookingTotals } = require('../utils/billingConfig');

// Helper to calculate bill details
const calculateBillDetails = async (cart) => {
  const config = await getActiveBookingConfig();
  const subtotal = cart.totalAmount || 0;
  const {
    platformFee,
    gstPercent,
    maidSharePercent,
    gst,
    taxAmount,
    totalAmount,
    maidShareAmount,
    companyShareAmount,
    companyRevenueAmount,
  } = calculateBookingTotals(subtotal, cart.serviceCart.length, config);

  return {
    subtotal,
    platformFee,
    gstPercent,
    maidSharePercent,
    gst,
    taxAmount,
    maidShareAmount,
    companyShareAmount,
    companyRevenueAmount,
    total: totalAmount,
  };
};

// Helper to get customer profile and addresses
const getCustomerDetails = async (userId) => {
  try {
    const user = await User.findById(userId);
    return user
      ? {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          name: user.name,
          phone: user.phone,
          role: user.role,
          language: user.language,
          avatarUrl: user.avatarUrl,
          walletBalance: user.walletBalance,
          rewardPoints: user.rewardPoints,
          addresses: user.addresses || [],
        }
      : null;
  } catch (err) {
    return null;
  }
};

// Helper to format cart items and inject placeholder image
const formatCartResponse = (cart) => {
  if (!cart) return null;
  const cartObj = cart.toObject ? cart.toObject() : cart;
  if (cartObj.serviceCart) {
    cartObj.serviceCart.forEach((item) => {
      if (item.service) {
        if (!item.service.image) {
          item.service.image =
            'https://res.cloudinary.com/dydsfw6w7/image/upload/v1780592384/zaffabit/services/lq550xrevofrui9h6byo.png';
        }
        item.service.icon = item.service.image;
      }
    });
  }
  return cartObj;
};

/**
 * @desc    Get Customer Cart
 * @route   GET /api/v1/cart
 */
exports.getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ customer: req.user.id }).populate(
      'serviceCart.service',
      'name category price image estimatedTime',
    );

    if (!cart) {
      cart = await Cart.create({ customer: req.user.id, serviceCart: [], totalAmount: 0 });
    }

    const billDetails = await calculateBillDetails(cart);

    // Fetch the customer's profile and saved addresses in the same DB call/transaction context
    const customer = await getCustomerDetails(req.user.id);

    return sendResponse(res, 200, 'Cart retrieved', {
      cart: formatCartResponse(cart),
      billDetails,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add Item(s) to Cart
 * @route   POST /api/v1/cart/items
 */
exports.addToCart = async (req, res, next) => {
  try {
    let itemsToAdd = [];

    // Support single item or batch array formats
    if (Array.isArray(req.body)) {
      itemsToAdd = req.body;
    } else if (req.body.items && Array.isArray(req.body.items)) {
      itemsToAdd = req.body.items;
    } else {
      itemsToAdd = [req.body];
    }

    if (itemsToAdd.length === 0 || !itemsToAdd[0] || Object.keys(itemsToAdd[0]).length === 0) {
      return sendError(res, 400, 'No items provided to add to cart', 'VALIDATION_ERROR');
    }

    let cart = await Cart.findOne({ customer: req.user.id });
    if (!cart) {
      cart = new Cart({ customer: req.user.id, serviceCart: [], totalAmount: 0 });
    }

    for (const item of itemsToAdd) {
      const { serviceId, duration } = item;
      if (!serviceId) {
        return sendError(res, 400, 'ServiceId is required for all items', 'VALIDATION_ERROR');
      }

      const service = await Service.findById(serviceId);
      if (!service) return sendError(res, 404, `Service ${serviceId} not found`, 'NOT_FOUND');

      // Default duration to service estimatedTime, fallback to 30
      const finalDuration = duration || service.estimatedTime || 30;

      // Find if service already exists in the cart
      let itemInCart = cart.serviceCart.find((s) => s.service.toString() === serviceId);
      if (itemInCart) {
        itemInCart.duration += finalDuration;
      } else {
        cart.serviceCart.push({ service: serviceId, duration: finalDuration });
      }
    }

    // Populate service details to calculate totalAmount
    await cart.populate('serviceCart.service', 'price estimatedTime');
    cart.totalAmount = cart.serviceCart.reduce((total, item) => {
      const baseDuration = item.service?.estimatedTime || 30;
      const calculatedPrice = (item.service?.price || 0) * (item.duration / baseDuration);
      return total + Math.round(calculatedPrice);
    }, 0);

    // Depopulate before saving to only save references
    cart.depopulate('serviceCart.service');
    await cart.save();

    // Re-populate for response
    await cart.populate('serviceCart.service', 'name category price image estimatedTime');

    const billDetails = await calculateBillDetails(cart);
    const customer = await getCustomerDetails(req.user.id);
    return sendResponse(res, 200, 'Items added to cart', {
      cart: formatCartResponse(cart),
      billDetails,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update Item Duration in Cart
 * @route   PUT /api/v1/cart/items/:itemId
 */
exports.updateCartItem = async (req, res, next) => {
  try {
    const { duration } = req.body;
    const { itemId: serviceId } = req.params;

    let cart = await Cart.findOne({ customer: req.user.id });
    if (!cart) return sendError(res, 404, 'Cart not found', 'NOT_FOUND');

    let itemInCart = cart.serviceCart.find((s) => s.service.toString() === serviceId);
    if (!itemInCart) return sendError(res, 404, 'Item not found in cart', 'NOT_FOUND');

    if (duration <= 0) {
      cart.serviceCart = cart.serviceCart.filter((s) => s.service.toString() !== serviceId);
    } else {
      itemInCart.duration = duration;
    }

    // Recalculate total
    await cart.populate('serviceCart.service', 'price estimatedTime');
    cart.totalAmount = cart.serviceCart.reduce((total, item) => {
      const baseDuration = item.service?.estimatedTime || 30;
      const calculatedPrice = (item.service?.price || 0) * (item.duration / baseDuration);
      return total + Math.round(calculatedPrice);
    }, 0);

    cart.depopulate('serviceCart.service');
    await cart.save();

    await cart.populate('serviceCart.service', 'name category price image estimatedTime');

    const billDetails = await calculateBillDetails(cart);
    const customer = await getCustomerDetails(req.user.id);
    return sendResponse(res, 200, 'Cart updated', {
      cart: formatCartResponse(cart),
      billDetails,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clear Cart
 * @route   DELETE /api/v1/cart
 */
exports.clearCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOneAndUpdate(
      { customer: req.user.id },
      { serviceCart: [], totalAmount: 0 },
      { returnDocument: 'after' },
    );

    const customer = await getCustomerDetails(req.user.id);
    return sendResponse(res, 200, 'Cart cleared', {
      cart: formatCartResponse(cart),
      customer,
      billDetails: {
        subtotal: 0,
        platformFee: 0,
        gstPercent: 9,
        maidSharePercent: 70,
        gst: 0,
        taxAmount: 0,
        maidShareAmount: 0,
        companyShareAmount: 0,
        companyRevenueAmount: 0,
        total: 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add single service to cart directly
 * @route   POST /api/v1/cart/items/:itemId
 */
exports.addCartItem = async (req, res, next) => {
  try {
    const { itemId: serviceId } = req.params;
    const { duration } = req.body; // optional duration

    const service = await Service.findById(serviceId);
    if (!service) return sendError(res, 404, `Service ${serviceId} not found`, 'NOT_FOUND');

    let cart = await Cart.findOne({ customer: req.user.id });
    if (!cart) {
      cart = new Cart({ customer: req.user.id, serviceCart: [], totalAmount: 0 });
    }

    const finalDuration = duration || service.estimatedTime || 30;

    let itemInCart = cart.serviceCart.find((s) => s.service.toString() === serviceId);
    if (itemInCart) {
      itemInCart.duration += finalDuration;
    } else {
      cart.serviceCart.push({ service: serviceId, duration: finalDuration });
    }

    // Populate service details to calculate totalAmount
    await cart.populate('serviceCart.service', 'price estimatedTime');
    cart.totalAmount = cart.serviceCart.reduce((total, item) => {
      const baseDuration = item.service?.estimatedTime || 30;
      const calculatedPrice = (item.service?.price || 0) * (item.duration / baseDuration);
      return total + Math.round(calculatedPrice);
    }, 0);

    // Depopulate before saving to only save references
    cart.depopulate('serviceCart.service');
    await cart.save();

    // Re-populate for response
    await cart.populate('serviceCart.service', 'name category price image estimatedTime');

    const billDetails = await calculateBillDetails(cart);
    const customer = await getCustomerDetails(req.user.id);
    return sendResponse(res, 200, 'Item added to cart', {
      cart: formatCartResponse(cart),
      billDetails,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove Item from Cart
 * @route   DELETE /api/v1/cart/items/:itemId
 */
exports.removeCartItem = async (req, res, next) => {
  try {
    const { itemId: serviceId } = req.params;

    let cart = await Cart.findOne({ customer: req.user.id });
    if (!cart) return sendError(res, 404, 'Cart not found', 'NOT_FOUND');

    const itemExists = cart.serviceCart.some((s) => s.service.toString() === serviceId);
    if (!itemExists) return sendError(res, 404, 'Item not found in cart', 'NOT_FOUND');

    cart.serviceCart = cart.serviceCart.filter((s) => s.service.toString() !== serviceId);

    // Recalculate total
    await cart.populate('serviceCart.service', 'price estimatedTime');
    cart.totalAmount = cart.serviceCart.reduce((total, item) => {
      const baseDuration = item.service?.estimatedTime || 30;
      const calculatedPrice = (item.service?.price || 0) * (item.duration / baseDuration);
      return total + Math.round(calculatedPrice);
    }, 0);

    cart.depopulate('serviceCart.service');
    await cart.save();

    await cart.populate('serviceCart.service', 'name category price image estimatedTime');

    const billDetails = await calculateBillDetails(cart);
    const customer = await getCustomerDetails(req.user.id);
    return sendResponse(res, 200, 'Item removed from cart', {
      cart: formatCartResponse(cart),
      billDetails,
      customer,
    });
  } catch (error) {
    next(error);
  }
};
