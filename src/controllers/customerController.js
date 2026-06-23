const User = require('../models/User');
const CustomerProfile = require('../models/CustomerProfile');
const Notification = require('../models/Notification');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { uploadBufferToCloudinary, destroyCloudinaryAsset } = require('../utils/cloudinaryUpload');
const crypto = require('crypto');

const serializeCustomerUser = (user) => {
  const defaultAvatar =
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150';
  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: user.name,
    phone: user.phone,
    role: user.role,
    language: user.language,
    avatar: user.avatarUrl || defaultAvatar,
    avatarUrl: user.avatarUrl || defaultAvatar,
    avatarPublicId: user.avatarPublicId,
    walletBalance: user.walletBalance,
    rewardPoints: user.rewardPoints,
    referralCode: user.referralCode,
    customerProfile: user.customerProfile,
    addresses: user.addresses || [],
  };
};

/** ================= PROFILE ================= **/

exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate('customerProfile');
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');
    return sendResponse(res, 200, 'Profile retrieved', { customer: serializeCustomerUser(user) });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, phone, avatarUrl, avatarPublicId } = req.body;
    const updateData = {};

    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (firstName || lastName) {
      updateData.name = `${firstName || ''} ${lastName || ''}`.trim();
    }
    if (phone !== undefined) updateData.phone = phone;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (avatarPublicId !== undefined) updateData.avatarPublicId = avatarPublicId;

    const user = await User.findByIdAndUpdate(req.user.id, updateData, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');
    return sendResponse(res, 200, 'Profile updated', { customer: serializeCustomerUser(user) });
  } catch (error) {
    next(error);
  }
};

/** ================= ADDRESSES ================= **/

exports.listAddresses = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    return sendResponse(res, 200, 'Addresses retrieved', { addresses: user.addresses });
  } catch (error) {
    next(error);
  }
};

exports.addAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const isDefault =
      req.body.isDefault !== undefined
        ? req.body.isDefault === true || req.body.isDefault === 'true'
        : !user.addresses.length;

    if (isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    user.addresses.push({
      ...req.body,
      isDefault,
    });

    await user.save();
    return sendResponse(res, 201, 'Address added', { addresses: user.addresses });
  } catch (error) {
    next(error);
  }
};

exports.updateAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const address = user.addresses.id(req.params.id);
    if (!address) return sendError(res, 404, 'Address not found', 'NOT_FOUND');

    const willBeDefault =
      req.body.isDefault !== undefined
        ? req.body.isDefault === true || req.body.isDefault === 'true'
        : address.isDefault;

    if (willBeDefault) {
      user.addresses.forEach((addr) => {
        if (addr._id.toString() !== req.params.id) {
          addr.isDefault = false;
        }
      });
    }

    Object.assign(address, {
      ...req.body,
      isDefault: willBeDefault,
    });

    await user.save();
    return sendResponse(res, 200, 'Address updated', { address, addresses: user.addresses });
  } catch (error) {
    next(error);
  }
};

exports.deleteAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const address = user.addresses.id(req.params.id);
    if (!address) return sendError(res, 404, 'Address not found', 'NOT_FOUND');
    const wasDefault = address.isDefault;

    user.addresses.pull(req.params.id);
    if (wasDefault && user.addresses.length) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    return sendResponse(res, 200, 'Address deleted', { addresses: user.addresses });
  } catch (error) {
    next(error);
  }
};

/** ================= PROPERTY PROFILE ================= **/

exports.savePropertyProfile = async (req, res, next) => {
  try {
    const updateData = {};
    if (req.body) {
      Object.keys(req.body).forEach((key) => {
        updateData[`propertyProfile.${key}`] = req.body[key];
      });
    }

    const profile = await CustomerProfile.findOneAndUpdate(
      { user: req.user.id },
      { $set: updateData },
      { returnDocument: 'after', upsert: true },
    );
    return sendResponse(res, 200, 'Property profile saved', {
      propertyProfile: profile.propertyProfile,
    });
  } catch (error) {
    next(error);
  }
};

exports.getPropertyProfile = async (req, res, next) => {
  try {
    const profile = await CustomerProfile.findOne({ user: req.user.id });
    const propertyProfile = profile ? profile.propertyProfile : {};
    return sendResponse(res, 200, 'Property profile retrieved', { propertyProfile });
  } catch (error) {
    next(error);
  }
};

/** ================= WALLET & REFERRAL ================= **/

exports.getWallet = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(
      'walletBalance walletTransactions rewardPoints',
    );
    return sendResponse(res, 200, 'Wallet details retrieved', {
      wallet: {
        balance: user.walletBalance,
        rewardPoints: user.rewardPoints || 0,
        transactions: user.walletTransactions,
      },
      balance: user.walletBalance,
      transactions: user.walletTransactions,
      rewardPoints: user.rewardPoints || 0,
    });
  } catch (error) {
    next(error);
  }
};

exports.getReferral = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('referralCode referralCredits');
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    // Count users referred by this user
    const invited = await User.countDocuments({ referredBy: user.referralCode });
    // Count referred users who completed their first booking (reward claimed)
    const joined = await User.countDocuments({
      referredBy: user.referralCode,
      isReferralRewardClaimed: true,
    });
    const earned = user.referralCredits || 0;

    const baseUrl = process.env.APP_BASE_URL || 'https://zafabit.app';
    const joiningLink = `${baseUrl}/join?ref=${user.referralCode}`;
    const shareText = `Use my Zaffabit referral code ${user.referralCode} to sign up: ${joiningLink}`;

    return sendResponse(res, 200, 'Referral info retrieved', {
      referralCode: user.referralCode,
      invited,
      joined,
      earned,
      invitedCount: invited,
      joinedCount: joined,
      earnedAmount: earned,
      joiningLink,
      shareText,
    });
  } catch (error) {
    next(error);
  }
};

exports.applyReferral = async (req, res, next) => {
  try {
    const code = req.body.code || req.body.referralCode;
    if (!code) return sendError(res, 400, 'Referral code is required', 'VALIDATION_ERROR');
    if (req.user.referredBy)
      return sendError(res, 400, 'Referral code already applied', 'CONFLICT');

    const referrer = await User.findOne({ referralCode: code });
    if (!referrer) return sendError(res, 404, 'Invalid referral code', 'NOT_FOUND');
    if (referrer._id.toString() === req.user.id)
      return sendError(res, 400, 'Cannot refer yourself', 'INVALID_REQUEST');

    // Link the user to the referrer
    const user = await User.findById(req.user.id);
    user.referredBy = code;

    // Award Welcome Bonus to the New User ONLY
    const { getActiveBookingConfig } = require('../utils/billingConfig');
    const billingConfig = await getActiveBookingConfig();
    const welcomeBonus = billingConfig.referralWelcomeBonus ?? 100;

    user.walletBalance += welcomeBonus;
    user.walletTransactions.push({
      amount: welcomeBonus,
      type: 'credit',
      reason: `Welcome bonus using referral code ${code}. Referrer will be rewarded after your first booking.`,
    });

    await user.save();

    return sendResponse(res, 200, 'Referral code applied. Expect your welcome bonus!', {
      newBalance: user.walletBalance,
      message: 'Your friend will receive their bonus after your first completed service.',
    });
  } catch (error) {
    next(error);
  }
};

exports.addMoneyToWallet = async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || isNaN(amount) || amount <= 0) {
      return sendError(res, 400, 'Invalid amount to add to wallet', 'VALIDATION_ERROR');
    }

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    user.walletBalance += Number(amount);
    user.walletTransactions.push({
      amount: Number(amount),
      type: 'credit',
      reason: 'Added money to wallet',
    });

    await user.save();

    return sendResponse(res, 200, 'Money added to wallet successfully', {
      walletBalance: user.walletBalance,
      transactions: user.walletTransactions,
    });
  } catch (error) {
    next(error);
  }
};

exports.redeemWalletRewards = async (req, res, next) => {
  try {
    const requestedPoints = Number(req.body.points ?? req.body.amount);
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const pointsToRedeem = requestedPoints > 0 ? requestedPoints : user.rewardPoints || 0;
    if (!pointsToRedeem) {
      return sendError(res, 400, 'No reward points available to redeem', 'VALIDATION_ERROR');
    }
    if (pointsToRedeem > (user.rewardPoints || 0)) {
      return sendError(res, 400, 'Insufficient reward points', 'VALIDATION_ERROR');
    }

    user.rewardPoints -= pointsToRedeem;
    user.walletBalance += pointsToRedeem;
    user.walletTransactions.push({
      amount: pointsToRedeem,
      type: 'credit',
      reason: 'Redeemed reward points to wallet',
    });
    await user.save();

    return sendResponse(res, 200, 'Reward points redeemed', {
      walletBalance: user.walletBalance,
      rewardPoints: user.rewardPoints,
      redeemedAmount: pointsToRedeem,
      transactions: user.walletTransactions,
    });
  } catch (error) {
    next(error);
  }
};

exports.listPaymentMethods = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('paymentMethods');
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');
    return sendResponse(res, 200, 'Payment methods retrieved', {
      paymentMethods: user.paymentMethods || [],
    });
  } catch (error) {
    next(error);
  }
};

exports.savePaymentMethod = async (req, res, next) => {
  try {
    const { type = 'upi', label, upiId, last4, brand, token, isDefault = false } = req.body;
    if (!['upi', 'card'].includes(type)) {
      return sendError(res, 400, 'Unsupported payment method type', 'VALIDATION_ERROR');
    }
    if (type === 'upi' && !upiId) {
      return sendError(res, 400, 'UPI ID is required', 'VALIDATION_ERROR');
    }
    if (type === 'card' && !last4) {
      return sendError(res, 400, 'Card last4 is required', 'VALIDATION_ERROR');
    }

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    if (isDefault || !user.paymentMethods.length) {
      user.paymentMethods.forEach((method) => {
        method.isDefault = false;
      });
    }

    user.paymentMethods.push({
      type,
      label: label || (type === 'upi' ? upiId : `${brand || 'Card'} ${last4}`),
      upiId,
      last4,
      brand,
      token,
      isDefault: isDefault || !user.paymentMethods.length,
    });

    await user.save();
    const paymentMethod = user.paymentMethods[user.paymentMethods.length - 1];
    return sendResponse(res, 201, 'Payment method saved', {
      paymentMethod,
      paymentMethods: user.paymentMethods,
    });
  } catch (error) {
    next(error);
  }
};

exports.deletePaymentMethod = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const method = user.paymentMethods.id(req.params.id);
    if (!method) return sendError(res, 404, 'Payment method not found', 'NOT_FOUND');
    const wasDefault = method.isDefault;

    user.paymentMethods.pull(req.params.id);
    if (wasDefault && user.paymentMethods.length) {
      user.paymentMethods[0].isDefault = true;
    }
    await user.save();

    return sendResponse(res, 200, 'Payment method deleted', {
      paymentMethods: user.paymentMethods,
    });
  } catch (error) {
    next(error);
  }
};

exports.initiateWalletTopUp = async (req, res, next) => {
  try {
    const { amount, method = 'upi' } = req.body;
    const numericAmount = Number(amount);
    if (!numericAmount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return sendError(res, 400, 'Invalid top-up amount', 'VALIDATION_ERROR');
    }

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const order = {
      id: `wallet_topup_${crypto.randomBytes(8).toString('hex')}`,
      amount: numericAmount,
      currency: 'INR',
      method,
    };

    user.walletTopUps.push({
      orderId: order.id,
      amount: numericAmount,
      currency: order.currency,
      method,
      status: 'pending',
    });
    await user.save();

    const topUp = user.walletTopUps[user.walletTopUps.length - 1];
    return sendResponse(res, 200, 'Wallet top-up initiated', { order, topUpId: topUp._id });
  } catch (error) {
    next(error);
  }
};

exports.verifyWalletTopUp = async (req, res, next) => {
  try {
    const { topUpId, orderId, paymentId, mock, mockStatus } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const topUp = topUpId
      ? user.walletTopUps.id(topUpId)
      : user.walletTopUps.find((item) => item.orderId === orderId);
    if (!topUp) return sendError(res, 404, 'Wallet top-up not found', 'NOT_FOUND');

    if (topUp.status === 'captured') {
      return sendResponse(res, 200, 'Wallet top-up already verified', {
        walletBalance: user.walletBalance,
        topUp,
      });
    }

    const isMockSuccess = mock === true || mockStatus === 'success' || !paymentId;
    if (!isMockSuccess) {
      topUp.status = 'failed';
      await user.save();
      return sendError(res, 400, 'Wallet top-up verification failed', 'PAYMENT_FAILED');
    }

    topUp.status = 'captured';
    topUp.gatewayPaymentId = paymentId || `mock_wallet_${Date.now()}`;
    topUp.capturedAt = new Date();
    user.walletBalance += topUp.amount;
    user.walletTransactions.push({
      amount: topUp.amount,
      type: 'credit',
      reason: 'Wallet top-up payment verified',
    });
    await user.save();

    return sendResponse(res, 200, 'Wallet top-up verified', {
      walletBalance: user.walletBalance,
      transactions: user.walletTransactions,
      topUp,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Support & Safety Info (SOS)
 * @route   GET /api/v1/customers/support
 */
exports.getSupportInfo = async (req, res, next) => {
  try {
    return sendResponse(res, 200, 'Support info retrieved', {
      supportPhone: '+91 1800 123 4567',
      sosContacts: [
        { name: 'Police', phone: '100' },
        { name: 'Women Helpline', phone: '1091' },
      ],
      faqsUrl: 'https://zafabit.app/faqs',
    });
  } catch (error) {
    next(error);
  }
};

exports.uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(res, 400, 'Please upload an image file', 'VALIDATION_ERROR');
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return sendError(res, 404, 'User not found', 'NOT_FOUND');
    }

    // Delete old avatar from Cloudinary if exists
    if (user.avatarPublicId) {
      await destroyCloudinaryAsset(user.avatarPublicId);
    }

    // Upload new image to Cloudinary
    const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/avatars');

    user.avatarUrl = result.secure_url;
    user.avatarPublicId = result.public_id;
    await user.save();

    return sendResponse(res, 200, 'Avatar updated successfully', {
      avatar: user.avatarUrl,
      avatarUrl: user.avatarUrl,
      user,
    });
  } catch (error) {
    next(error);
  }
};

/** ================= NOTIFICATIONS ================= **/

/**
 * @desc    Get customer's in-app notification inbox
 * @route   GET /api/v1/customers/notifications
 */
exports.getMyNotifications = async (req, res, next) => {
  try {
    const { unreadOnly, limit = 20, page = 1 } = req.query;
    const limitNum = Number(limit);
    const pageNum = Number(page);
    const skip = (pageNum - 1) * limitNum;

    const filter = { recipient: req.user.id };
    if (unreadOnly === 'true') filter.isRead = false;

    const totalNotifications = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter)
      .sort({ isRead: 1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false,
    });

    const totalPages = Math.ceil(totalNotifications / limitNum);
    const hasMore = pageNum < totalPages;

    return sendResponse(res, 200, 'Notifications retrieved', {
      unreadCount,
      notifications,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount: totalNotifications,
        hasMore,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark a single notification as read
 * @route   PATCH /api/v1/customers/notifications/:id/read
 */
exports.markNotificationRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { isRead: true },
      { returnDocument: 'after' },
    );

    if (!notification) {
      return sendError(res, 404, 'Notification not found', 'NOT_FOUND');
    }

    return sendResponse(res, 200, 'Notification marked as read', { notification });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark ALL notifications as read to clear unread count
 * @route   PATCH /api/v1/customers/notifications/read-all
 */
exports.markAllNotificationsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { isRead: true },
    );

    return sendResponse(res, 200, `${result.modifiedCount} notification(s) marked as read`, {
      markedRead: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};
