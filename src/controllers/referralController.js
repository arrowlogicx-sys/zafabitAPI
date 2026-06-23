const User = require('../models/User');
const { sendResponse, sendError } = require('../utils/apiResponse');

/**
 * @desc    Get complete referral details & leaderboard (Admin)
 * @route   GET /api/v1/admin/referrals
 */
exports.getReferralsReport = async (req, res, next) => {
  try {
    // 1. Fetch all referred user registrations
    const referredUsers = await User.find({ referredBy: { $exists: true, $ne: null } })
      .select('name phone referredBy isVerified isReferralRewardClaimed createdAt')
      .sort('-createdAt');

    // 2. Aggregate the referrers leaderboard
    const leaderboard = await User.aggregate([
      { $match: { referredBy: { $exists: true, $ne: null, $ne: '' } } },
      {
        $group: {
          _id: '$referredBy',
          refsCount: { $sum: 1 },
          verifiedCount: { $sum: { $cond: ['$isVerified', 1, 0] } },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'referralCode',
          as: 'referrerInfo',
        },
      },
      {
        $project: {
          referralCode: '$_id',
          refsCount: 1,
          verifiedCount: 1,
          referrer: { $arrayElemAt: ['$referrerInfo', 0] },
        },
      },
      {
        $project: {
          referralCode: 1,
          refsCount: 1,
          verifiedCount: 1,
          name: { $ifNull: ['$referrer.name', '$referralCode'] },
          phone: '$referrer.phone',
          avatarBg: { $literal: 'bg-[#6c5ce7]' },
        },
      },
      { $sort: { refsCount: -1 } },
    ]);

    return sendResponse(res, 200, 'Referrals report compiled successfully', {
      referredUsers,
      leaderboard,
    });
  } catch (error) {
    next(error);
  }
};
