const User = require('../models/User');
const MaidProfile = require('../models/MaidProfile');
const CustomerProfile = require('../models/CustomerProfile');
const Agent = require('../models/Agent');
const { sendOtpEmail } = require('../utils/mailer');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { generateToken } = require('../utils/authToken');

const resolveAdminRole = (user) =>
  user && user.role === 'admin' ? user.adminRole || 'super_admin' : undefined;

const serializeCustomerUser = (user) => ({
  id: user._id,
  phone: user.phone,
  role: user.role,
  isVerified: user.isVerified,
  name: user.name,
  firstName: user.firstName,
  lastName: user.lastName,
  language: user.language,
  walletBalance: user.walletBalance,
  rewardPoints: user.rewardPoints,
  referralCode: user.referralCode,
  customerProfile: user.customerProfile,
  addresses: user.addresses || [],
});

const serializeMaidUser = (user) => ({
  id: user._id,
  employeeId: user.employeeId,
  role: user.role,
  name: user.name,
  firstName: user.firstName,
  lastName: user.lastName,
  phone: user.phone,
  language: user.language,
  maidProfile: user.maidProfile,
  isVerified: user.isVerified,
  isBlocked: user.isBlocked,
});

// Helper to generate 6-digit OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

/**
 * @desc    Send OTP to user phone (SMS)
 * @route   POST /api/v1/auth/send-otp
 */
exports.sendOtp = async (req, res, next) => {
  try {
    const { phone, language, channel } = req.body;

    if (!phone) {
      return sendError(res, 400, 'Phone number is required', 'VALIDATION_ERROR');
    }

    // For testing/staging as requested, use static OTP 111111
    const isStaging = process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'development';
    const otp = isStaging ? '111111' : '123456';
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    let user = await User.findOne({ phone });

    if (!user) {
      // Create a temporary user if it doesn't exist
      user = await User.create({
        phone,
        otp,
        otpExpires,
        language: language || 'en',
      });
    } else {
      user.otp = otp;
      user.otpExpires = otpExpires;
      if (language) user.language = language;
      await user.save();
    }

    const currentChannel = channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
    console.log(
      `[TEST ${currentChannel.toUpperCase()} OTP] Mock ${currentChannel} OTP '${otp}' sent to ${phone}`,
    );

    return sendResponse(res, 200, `OTP sent successfully via ${currentChannel}`, {
      phone,
      otp,
      channel: channel || 'sms',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Capture preferred app language before login and return a localized response
 * @route   PUT /api/v1/auth/language
 * @route   PUT /api/v1/auth/languager
 * @access  Public
 *
 * Body: { "language": "en" | "ml" | "hi" | "ta", "phone"?: "+919999999999" }
 */
exports.updateLanguage = async (req, res, next) => {
  try {
    const supportedLanguages = ['en', 'ml', 'hi', 'ta'];
    const { language, phone } = req.body;
    const requestedLanguage = typeof language === 'string' ? language.toLowerCase() : '';

    if (!supportedLanguages.includes(requestedLanguage)) {
      return sendError(res, 400, 'Unsupported language', 'VALIDATION_ERROR');
    }

    if (phone) {
      const user = await User.findOne({ phone });
      if (user) {
        user.language = requestedLanguage;
        await user.save();
      }
    }

    return sendResponse(res, 200, 'Language updated successfully', {
      language: requestedLanguage,
      locale: requestedLanguage,
    });
  } catch (error) {
    next(error);
  }
};

// Helper to ensure profile exists
const ensureProfile = async (user) => {
  if (user.role === 'maid' && !user.maidProfile) {
    const profile = await MaidProfile.create({ user: user._id });
    user.maidProfile = profile._id;
    await user.save();
  } else if (user.role === 'customer' && !user.customerProfile) {
    const profile = await CustomerProfile.create({ user: user._id });
    user.customerProfile = profile._id;
    await user.save();
  }
};

/**
 * @desc    Verify OTP and return token
 * @route   POST /api/v1/auth/verify-otp
 */
exports.verifyOtp = async (req, res, next) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return sendError(res, 400, 'Phone and OTP are required', 'VALIDATION_ERROR');
    }

    const user = await User.findOne({ phone });

    if (!user || user.otp !== otp || user.otpExpires < Date.now()) {
      return sendError(res, 400, 'Invalid or expired OTP', 'INVALID_REQUEST');
    }

    if (user.isBlocked) {
      return sendError(
        res,
        403,
        'Your account has been blocked by the administrator',
        'ACCOUNT_BLOCKED',
      );
    }

    // Clear OTP and verify user
    user.otp = undefined;
    user.otpExpires = undefined;
    user.isVerified = true;
    await user.save();

    // Ensure profile exists for the role
    await ensureProfile(user);

    // Populate customerProfile to return home details
    await user.populate('customerProfile');

    const token = generateToken(user._id, user.role);

    return sendResponse(res, 200, 'Verification successful', {
      token,
      user: serializeCustomerUser(user),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Login with email and password (Maid/Admin)
 * @route   POST /api/v1/auth/login
 */
exports.login = async (req, res, next) => {
  try {
    const { email, employeeId, maidId, password } = req.body;
    const identifier = email || employeeId || maidId;
    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
      return sendError(
        res,
        400,
        'Please provide an email, phone number, employee ID, or maid ID',
        'VALIDATION_ERROR',
      );
    }
    if (!password || typeof password !== 'string') {
      return sendError(res, 400, 'Password is required', 'VALIDATION_ERROR');
    }
    const normalizedIdentifier = identifier.trim();
    let query = {};
    if (normalizedIdentifier.includes('@')) {
      query = { email: normalizedIdentifier.toLowerCase() };
    } else if (/^\+?[0-9]{10,15}$/.test(normalizedIdentifier)) {
      query = { phone: normalizedIdentifier };
    } else {
      query = {
        $or: [{ employeeId: normalizedIdentifier }, { email: normalizedIdentifier.toLowerCase() }],
      };
    }
    const user = await User.findOne(query).select('+password');

    if (!user || user.role === 'customer') {
      return sendError(res, 401, 'Invalid credentials or unauthorized access', 'AUTH_ERROR');
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return sendError(res, 401, 'Invalid credentials', 'AUTH_ERROR');
    }

    if (user.isBlocked) {
      return sendError(
        res,
        403,
        'Your account has been blocked by the administrator',
        'ACCOUNT_BLOCKED',
      );
    }

    // Ensure profile exists (for Maids/Admins who might be newly converted)
    await ensureProfile(user);

    const token = generateToken(user._id, user.role);

    return sendResponse(res, 200, 'Login successful', {
      token,
      user:
        user.role === 'maid'
          ? serializeMaidUser(user)
          : {
              id: user._id,
              email: user.email,
              role: user.role,
              name: user.name,
              adminRole: resolveAdminRole(user),
            },
    });
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    let query = User.findById(req.user.id);

    // Populate profile based on role
    const userRole = req.user.role;
    if (userRole === 'maid') query = query.populate('maidProfile');
    if (userRole === 'customer') query = query.populate('customerProfile');
    if (userRole === 'agent') query = query.populate('agentProfile');

    const user = await query;
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');
    const responseUser =
      user.role === 'customer'
        ? serializeCustomerUser(user)
        : user.role === 'maid'
          ? serializeMaidUser(user)
          : user;
    return sendResponse(res, 200, 'User profile retrieved', { user: responseUser });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Logout user
 * @route   GET /api/v1/auth/logout
 */
exports.logout = async (req, res, next) => {
  try {
    // On the server-side, for JWT without a blacklist, we just send a success response.
    // The client should delete the token from local storage.
    return sendResponse(res, 200, 'User logged out successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete logged-in user profile and account
 * @route   DELETE /api/v1/auth/me
 * @access  Protected
 */
exports.deleteMe = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return sendError(res, 404, 'User not found', 'NOT_FOUND');
    }

    // Delete associated profiles
    if (user.role === 'customer') {
      await CustomerProfile.findOneAndDelete({ user: userId });
    } else if (user.role === 'maid') {
      await MaidProfile.findOneAndDelete({ user: userId });
    } else if (user.role === 'agent') {
      await Agent.findOneAndDelete({ user: userId });
    }

    // Delete user
    await User.findByIdAndDelete(userId);

    return sendResponse(res, 200, 'User account deleted successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update FCM Push Token for the User
 * @route   PUT /api/v1/auth/push-token
 * @access  Protected
 *
 * Body: { "pushToken": "fcm_device_token_string" }
 */
exports.updatePushToken = async (req, res, next) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken) {
      return sendError(res, 400, 'pushToken is required', 'VALIDATION_ERROR');
    }

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    user.pushToken = pushToken;
    await user.save();

    return sendResponse(res, 200, 'Push token updated successfully', { pushToken });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update Logged-in User Profile
 * @route   PUT /api/v1/auth/profile
 * @access  Protected
 */
exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, email, name, language } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (email !== undefined && user.role !== 'customer' && user.role !== 'maid') user.email = email;
    if (name !== undefined) user.name = name;
    if (language !== undefined) user.language = language;

    await user.save();

    if (user.role === 'customer') {
      return sendResponse(res, 200, 'Profile updated successfully', {
        user: serializeCustomerUser(user),
      });
    } else if (user.role === 'maid') {
      return sendResponse(res, 200, 'Profile updated successfully', {
        user: serializeMaidUser(user),
      });
    }

    return sendResponse(res, 200, 'Profile updated successfully', {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        language: user.language,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update Logged-in User Password
 * @route   PUT /api/v1/auth/password
 * @access  Protected
 */
exports.updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return sendError(
        res,
        400,
        'Please provide current password and new password',
        'VALIDATION_ERROR',
      );
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return sendError(res, 401, 'Incorrect current password', 'AUTH_ERROR');
    }

    user.password = newPassword;
    await user.save();

    return sendResponse(res, 200, 'Password updated successfully');
  } catch (error) {
    next(error);
  }
};
