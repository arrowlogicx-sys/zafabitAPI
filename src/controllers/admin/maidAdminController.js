const User = require('../../models/User');
const MaidProfile = require('../../models/MaidProfile');
const { sendResponse, sendError } = require('../../utils/apiResponse');
const { paginationMeta, parsePagination } = require('./adminControllerUtils');

/**
 * @desc    Create a new Maid (Admin initiated)
 * @route   POST /api/v1/admin/maids
 */
exports.createMaid = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      zone,
      rating,
      completedJobs,
      totalEarnings,
      language,
      jobType,
      activeStatus,
      isIdentityVerified,
    } = req.body;

    // Check if user exists
    let user = await User.findOne({ email });
    if (user) return sendError(res, 400, 'User already exists', 'CONFLICT');

    // Auto-generate Unique Employee ID
    const count = await User.countDocuments({ role: 'maid' });
    const employeeId = `MAID${String(count + 1).padStart(4, '0')}`;

    // Create user
    user = await User.create({
      name,
      email,
      password,
      phone,
      employeeId,
      role: 'maid',
      language: language || 'en',
      isVerified: isIdentityVerified !== undefined ? isIdentityVerified : true,
    });

    // Create Maid Profile
    const profile = await MaidProfile.create({
      user: user._id,
      zone,
      language: language || 'en',
      jobType: jobType || null,
      rating: rating !== undefined ? Number(rating) : 5,
      completedJobs: completedJobs !== undefined ? Number(completedJobs) : 0,
      totalEarnings: totalEarnings !== undefined ? Number(totalEarnings) : 0,
      activeStatus: activeStatus || 'inactive',
      isIdentityVerified: isIdentityVerified !== undefined ? isIdentityVerified : true,
    });

    user.maidProfile = profile._id;
    await user.save();

    return sendResponse(res, 201, 'Maid account created successfully', {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        employeeId: user.employeeId,
        role: user.role,
      },
      profile,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update Maid Details (Admin initiated)
 * @route   PUT /api/v1/admin/maids/:id
 */
exports.updateMaid = async (req, res, next) => {
  try {
    const {
      name,
      phone,
      email,
      zone,
      rating,
      completedJobs,
      totalEarnings,
      language,
      jobType,
      activeStatus,
      isIdentityVerified,
    } = req.body;

    let user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');
    if (user.role !== 'maid') return sendError(res, 400, 'User is not a maid', 'INVALID_REQUEST');

    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (email !== undefined) user.email = email;
    if (language !== undefined) user.language = language;
    if (isIdentityVerified !== undefined) user.isVerified = isIdentityVerified;
    await user.save();

    let updateFields = {};
    if (zone !== undefined) updateFields.zone = zone;
    if (language !== undefined) updateFields.language = language;
    if (jobType !== undefined) updateFields.jobType = jobType;
    if (rating !== undefined) updateFields.rating = Number(rating);
    if (completedJobs !== undefined) updateFields.completedJobs = Number(completedJobs);
    if (totalEarnings !== undefined) updateFields.totalEarnings = Number(totalEarnings);
    if (activeStatus !== undefined) updateFields.activeStatus = activeStatus;
    if (isIdentityVerified !== undefined) updateFields.isIdentityVerified = isIdentityVerified;

    const profile = await MaidProfile.findOneAndUpdate(
      { user: user._id },
      { $set: updateFields },
      { new: true, upsert: true, returnDocument: 'after' },
    );

    return sendResponse(res, 200, 'Maid profile updated successfully', { user, profile });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a Maid completely
 * @route   DELETE /api/v1/admin/maids/:id
 */
exports.deleteMaid = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    await MaidProfile.findOneAndDelete({ user: user._id });
    await User.findByIdAndDelete(req.params.id);

    return sendResponse(res, 200, 'Maid successfully deleted');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Maids Pending Verification
 * @route   GET /api/v1/admin/verifications/pending
 */
exports.getPendingVerifications = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 20, maxLimit: 100 });
    const query = { isIdentityVerified: false };
    const [maids, total] = await Promise.all([
      MaidProfile.find(query)
        .populate('user', 'name email phone')
        .sort('-createdAt')
        .skip(skip)
        .limit(limit)
        .lean(),
      MaidProfile.countDocuments(query),
    ]);

    return sendResponse(
      res,
      200,
      'Pending verifications retrieved',
      { maids },
      {
        pagination: paginationMeta(page, limit, total),
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve/Reject Maid Verification
 * @route   PATCH /api/v1/admin/verifications/:id/approve
 */
exports.approveMaidVerification = async (req, res, next) => {
  try {
    const { isIdentityVerified, documentStatus, activeStatus } = req.body || {};

    const profile = await MaidProfile.findById(req.params.id);
    if (!profile) return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');

    // Default to true if not passed
    const targetIdentityVerified =
      typeof isIdentityVerified !== 'undefined' ? isIdentityVerified : true;
    profile.isIdentityVerified = targetIdentityVerified;

    // Default to 'active' if not passed
    const targetActiveStatus = activeStatus || 'active';

    if (targetActiveStatus) {
      profile.activeStatus = targetActiveStatus;
    }

    // Update specific document status if provided, otherwise default all to 'verified'
    if (documentStatus && Array.isArray(documentStatus)) {
      documentStatus.forEach((ds) => {
        const doc = profile.documents.find((d) => d._id.toString() === ds.id);
        if (doc) doc.status = ds.status;
      });
    } else {
      profile.documents.forEach((doc) => {
        doc.status = 'verified';
      });
    }

    await profile.save();

    return sendResponse(res, 200, 'Verification status updated', { profile });
  } catch (error) {
    next(error);
  }
};
