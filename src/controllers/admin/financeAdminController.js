const mongoose = require('mongoose');
const User = require('../../models/User');
const Booking = require('../../models/Booking');
const BookingConfig = require('../../models/BookingConfig');
const Payment = require('../../models/Payment');
const PayoutLedger = require('../../models/PayoutLedger');
const { sendResponse, sendError } = require('../../utils/apiResponse');
const { DEFAULT_BOOKING_CONFIG, financeAggregationStages } = require('../../utils/billingConfig');
const {
  financeTotalsGroup,
  maidMatchValue,
  normalizeFinanceTotals,
  paginationMeta,
  parsePagination,
} = require('./adminControllerUtils');

/**
 * @desc    Get Financial Settlements (Payouts)
 * @route   GET /api/v1/admin/finance/settlements
 */
exports.getSettlements = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 20, maxLimit: 100 });
    // Real payout roster: only the maid share from completed, unreleased jobs.
    const settlementResult = await Booking.aggregate([
      { $match: { status: 'completed', isPaidOut: { $ne: true } } },
      ...financeAggregationStages(),
      {
        $group: {
          _id: '$maid',
          totalEarnings: { $sum: '$financeMaidShareAmount' },
          serviceSubtotal: { $sum: '$financeSubtotal' },
          companyShareAmount: { $sum: '$financeCompanyShareAmount' },
          platformFee: { $sum: '$financePlatformFee' },
          gst: { $sum: '$financeTaxAmount' },
          grossAmount: { $sum: '$financeGrossAmount' },
          bookingCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'maidDetails',
        },
      },
      { $unwind: '$maidDetails' },
      {
        $project: {
          maidId: '$_id',
          maidName: '$maidDetails.name',
          totalEarnings: 1,
          serviceSubtotal: 1,
          companyShareAmount: 1,
          platformFee: 1,
          gst: 1,
          grossAmount: 1,
          bookingCount: 1,
          status: { $literal: 'pending' },
        },
      },
      { $sort: { totalEarnings: -1, maidName: 1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ]);
    const settlements = settlementResult[0]?.rows || [];
    const totalSettlements = settlementResult[0]?.total?.[0]?.count || 0;

    const [allRows, pendingRows, releasedRows] = await Promise.all([
      Booking.aggregate([
        { $match: { status: 'completed' } },
        ...financeAggregationStages(),
        { $group: financeTotalsGroup },
      ]),
      Booking.aggregate([
        { $match: { status: 'completed', isPaidOut: { $ne: true } } },
        ...financeAggregationStages(),
        { $group: financeTotalsGroup },
      ]),
      Booking.aggregate([
        { $match: { status: 'completed', isPaidOut: true } },
        ...financeAggregationStages(),
        { $group: financeTotalsGroup },
      ]),
    ]);

    const allTotals = normalizeFinanceTotals(allRows[0]);
    const pendingTotals = normalizeFinanceTotals(pendingRows[0]);
    const releasedTotals = normalizeFinanceTotals(releasedRows[0]);
    const pendingPayouts = pendingTotals.maidShareAmount;
    const completedPayouts = releasedTotals.maidShareAmount;
    const activeBookingConfig = await BookingConfig.findOne({ isActive: true });

    const kpis = {
      grossRevenue: allTotals.grossRevenue,
      serviceSubtotal: allTotals.serviceSubtotal,
      pendingPayouts,
      completedPayouts,
      averageSettlement: totalSettlements > 0 ? Math.round(pendingPayouts / totalSettlements) : 0,
      companyRevenue: allTotals.companyRevenueAmount,
      companyShareAmount: allTotals.companyShareAmount,
      platformFee: allTotals.platformFee,
      taxBucket: allTotals.taxAmount,
      pendingLedgerCount: totalSettlements,
      completedLedgerCount: releasedTotals.bookingCount,
      completedBookingCount: allTotals.bookingCount,
      maidSharePercent:
        activeBookingConfig?.maidSharePercent ?? DEFAULT_BOOKING_CONFIG.maidSharePercent,
      currency: 'INR',
    };

    const payoutDistribution = [
      { name: 'Released', value: completedPayouts },
      { name: 'Pending', value: pendingPayouts },
      { name: 'Tax', value: allTotals.taxAmount },
    ];

    const trends = {
      Daily: await Booking.aggregate([
        {
          $match: {
            status: 'completed',
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        },
        ...financeAggregationStages(),
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$financeGrossAmount' },
            payout: { $sum: '$financeMaidShareAmount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Weekly: await Booking.aggregate([
        {
          $match: {
            status: 'completed',
            createdAt: { $gte: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000) },
          },
        },
        ...financeAggregationStages(),
        {
          $group: {
            _id: { $dateToString: { format: '%Y-W%U', date: '$createdAt' } },
            revenue: { $sum: '$financeGrossAmount' },
            payout: { $sum: '$financeMaidShareAmount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Monthly: await Booking.aggregate([
        {
          $match: {
            status: 'completed',
            createdAt: { $gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) },
          },
        },
        ...financeAggregationStages(),
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            revenue: { $sum: '$financeGrossAmount' },
            payout: { $sum: '$financeMaidShareAmount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    };

    return sendResponse(
      res,
      200,
      'Settlement report generated',
      {
        settlements,
        kpis,
        payoutDistribution,
        trends,
      },
      {
        pagination: paginationMeta(page, limit, totalSettlements),
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all payments/transactions
 * @route   GET /api/v1/admin/payments
 */
exports.getAdminPayments = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req);

    const query = {};

    if (req.query.status && req.query.status !== 'ALL') {
      query.status = req.query.status;
    }

    if (req.query.method && req.query.method !== 'ALL') {
      query.method = req.query.method;
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');

      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { phone: searchRegex }, { email: searchRegex }],
      })
        .select('_id')
        .limit(100);

      const userIds = matchingUsers.map((u) => u._id);
      const isValidObjectId = mongoose.Types.ObjectId.isValid(req.query.search);

      query.$or = [{ customer: { $in: userIds } }];

      if (isValidObjectId) {
        query.$or.push({ _id: req.query.search });
      }
    }

    const [total, payments, summaryRows, recent] = await Promise.all([
      Payment.countDocuments(query),
      Payment.find(query)
        .populate('customer', 'name phone')
        .populate('booking', 'scheduleDate totalAmount status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            capturedCount: { $sum: { $cond: [{ $eq: ['$status', 'captured'] }, 1, 0] } },
            failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            totalCapturedAmount: {
              $sum: { $cond: [{ $eq: ['$status', 'captured'] }, '$amount', 0] },
            },
          },
        },
      ]),
      Payment.find(query).select('amount status createdAt').sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const rawSummary = summaryRows[0] || {};
    const summary = {
      totalCount: rawSummary.totalCount || 0,
      capturedCount: rawSummary.capturedCount || 0,
      failedCount: rawSummary.failedCount || 0,
      totalCapturedAmount: rawSummary.totalCapturedAmount || 0,
      averageCapturedAmount: rawSummary.capturedCount
        ? rawSummary.totalCapturedAmount / rawSummary.capturedCount
        : 0,
      failedRate: rawSummary.totalCount
        ? (rawSummary.failedCount / rawSummary.totalCount) * 100
        : 0,
      recent,
    };

    return sendResponse(
      res,
      200,
      'Payments retrieved successfully',
      { payments, summary },
      {
        pagination: paginationMeta(page, limit, total),
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new manual payment record
 * @route   POST /api/v1/admin/payments
 */
exports.createAdminPayment = async (req, res, next) => {
  try {
    const { bookingId, customerId, amount, method, status } = req.body;
    if (!customerId || !amount) {
      return sendError(res, 400, 'Customer and amount are required', 'BAD_REQUEST');
    }

    let targetBookingId = bookingId;
    if (!targetBookingId) {
      const existingBooking = await Booking.findOne({ customer: customerId });
      if (existingBooking) {
        targetBookingId = existingBooking._id;
      } else {
        const anyBooking = await Booking.findOne();
        if (anyBooking) {
          targetBookingId = anyBooking._id;
        } else {
          return sendError(
            res,
            400,
            'A booking reference is required to record a payment',
            'BAD_REQUEST',
          );
        }
      }
    }

    const newPayment = await Payment.create({
      booking: targetBookingId,
      customer: customerId,
      amount: parseFloat(amount),
      method: method || 'upi',
      status: status || 'captured',
    });

    const populated = await Payment.findById(newPayment._id)
      .populate('customer', 'name phone')
      .populate('booking', 'scheduleDate totalAmount status');

    return sendResponse(res, 201, 'Manual payment recorded successfully', populated);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a payment status/details
 * @route   PUT /api/v1/admin/payments/:id
 */
exports.updateAdminPayment = async (req, res, next) => {
  try {
    const { status, amount, method } = req.body;
    const payment = await Payment.findById(req.params.id);
    if (!payment) return sendError(res, 404, 'Payment log not found', 'NOT_FOUND');

    if (status) payment.status = status;
    if (amount) payment.amount = parseFloat(amount);
    if (method) payment.method = method;

    await payment.save();

    const populated = await Payment.findById(payment._id)
      .populate('customer', 'name phone')
      .populate('booking', 'scheduleDate totalAmount status');

    return sendResponse(res, 200, 'Payment updated successfully', populated);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a payment record
 * @route   DELETE /api/v1/admin/payments/:id
 */
exports.deleteAdminPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) return sendError(res, 404, 'Payment log not found', 'NOT_FOUND');

    return sendResponse(res, 200, 'Payment log deleted successfully', null);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Release payout settlement for a maid
 * @route   POST /api/v1/admin/finance/settlements/:maidId/release
 */
exports.releaseSettlement = async (req, res, next) => {
  try {
    const { maidId } = req.params;
    const maid = maidMatchValue(maidId);
    const match = { maid, status: 'completed', isPaidOut: { $ne: true } };

    const settlementRows = await Booking.aggregate([
      { $match: match },
      ...financeAggregationStages(),
      {
        $group: {
          _id: '$maid',
          bookingIds: { $push: '$_id' },
          bookingCount: { $sum: 1 },
          amount: { $sum: '$financeMaidShareAmount' },
          serviceSubtotal: { $sum: '$financeSubtotal' },
          companyShareAmount: { $sum: '$financeCompanyShareAmount' },
          platformFee: { $sum: '$financePlatformFee' },
          taxAmount: { $sum: '$financeTaxAmount' },
          grossAmount: { $sum: '$financeGrossAmount' },
        },
      },
    ]);

    const settlement = settlementRows[0] || {
      bookingIds: [],
      bookingCount: 0,
      amount: 0,
      serviceSubtotal: 0,
      companyShareAmount: 0,
      platformFee: 0,
      taxAmount: 0,
      grossAmount: 0,
    };

    const releasedAt = new Date();
    const referenceId = `payout_${maidId}_${releasedAt.getTime()}`;
    let ledger = null;

    if (settlement.amount > 0 && mongoose.Types.ObjectId.isValid(maidId)) {
      ledger = await PayoutLedger.create({
        maid,
        bookingIds: settlement.bookingIds,
        bookingCount: settlement.bookingCount,
        amount: settlement.amount,
        maidShareAmount: settlement.amount,
        serviceSubtotal: settlement.serviceSubtotal,
        companyShareAmount: settlement.companyShareAmount,
        platformFee: settlement.platformFee,
        taxAmount: settlement.taxAmount,
        grossAmount: settlement.grossAmount,
        status: 'released',
        referenceId,
        releasedBy: req.user?._id,
        releasedAt,
      });
    }

    await Booking.updateMany(match, {
      $set: {
        isPaidOut: true,
        payoutStatus: 'released',
        payoutReleasedAt: releasedAt,
        payoutReferenceId: referenceId,
        ...(ledger?._id ? { payoutLedger: ledger._id } : {}),
      },
    });

    return sendResponse(res, 200, 'Settlement released successfully', {
      payout: {
        referenceId,
        ledgerId: ledger?._id,
        amount: settlement.amount,
        bookingCount: settlement.bookingCount,
        status: 'released',
        releasedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all refund logs
 * @route   GET /api/v1/admin/finance/refunds
 */
exports.getAdminRefunds = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req);

    // Base query for refunds
    const query = {
      $or: [{ status: 'refunded' }, { isRefunded: true }, { refundAmount: { $gt: 0 } }],
    };

    if (req.query.status && req.query.status !== 'ALL') {
      query.status = req.query.status;
    }

    if (req.query.method && req.query.method !== 'ALL') {
      query.method = req.query.method;
    }

    if (req.query.customer && req.query.customer !== 'ALL') {
      query.customer = req.query.customer;
    }

    if (req.query.refundReason && req.query.refundReason !== 'ALL') {
      query.refundReason = { $regex: req.query.refundReason, $options: 'i' };
    }

    if (req.query.startDate || req.query.endDate) {
      query.createdAt = {};
      if (req.query.startDate) {
        query.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        query.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');

      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { phone: searchRegex }, { email: searchRegex }],
      })
        .select('_id')
        .limit(100);

      const userIds = matchingUsers.map((u) => u._id);
      const isValidObjectId = mongoose.Types.ObjectId.isValid(req.query.search);

      const searchConditions = [{ customer: { $in: userIds } }];

      if (isValidObjectId) {
        searchConditions.push({ _id: req.query.search });
      }

      query.$and = [
        {
          $or: searchConditions,
        },
      ];
    }

    const [total, refunds, summaryRows, recent] = await Promise.all([
      Payment.countDocuments(query),
      Payment.find(query)
        .populate('customer', 'name phone')
        .populate('booking', 'scheduleDate totalAmount status')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            approvedCount: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } },
            failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            totalRefunded: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'refunded'] },
                  { $ifNull: ['$refundAmount', '$amount'] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      Payment.find(query)
        .select('amount refundAmount status updatedAt')
        .sort({ updatedAt: -1 })
        .limit(8)
        .lean(),
    ]);
    const rawSummary = summaryRows[0] || {};
    const summary = {
      totalCount: rawSummary.totalCount || 0,
      approvedCount: rawSummary.approvedCount || 0,
      failedCount: rawSummary.failedCount || 0,
      pendingCount: Math.max(
        0,
        (rawSummary.totalCount || 0) -
          (rawSummary.approvedCount || 0) -
          (rawSummary.failedCount || 0),
      ),
      totalRefunded: rawSummary.totalRefunded || 0,
      recent,
    };

    return sendResponse(
      res,
      200,
      'Refunds retrieved successfully',
      { refunds, summary },
      {
        pagination: paginationMeta(page, limit, total),
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Request/create a new refund record
 * @route   POST /api/v1/admin/finance/refunds
 */
exports.createAdminRefund = async (req, res, next) => {
  try {
    const { paymentId, customerId, amount, reason } = req.body;

    let payment;
    if (paymentId) {
      payment = await Payment.findById(paymentId);
    } else {
      payment = await Payment.findOne({ customer: customerId });
    }

    if (!payment) {
      let targetBooking = await Booking.findOne({ customer: customerId });
      if (!targetBooking) {
        targetBooking = await Booking.findOne();
      }
      if (!targetBooking) {
        return sendError(
          res,
          400,
          'Customer has no active bookings to request a refund against.',
          'BAD_REQUEST',
        );
      }

      payment = await Payment.create({
        booking: targetBooking._id,
        customer: customerId,
        amount: parseFloat(amount),
        status: 'pending',
        isRefunded: true,
        refundAmount: parseFloat(amount),
        refundReason: reason || 'Cancellation',
        refundId: `RFD-${Math.floor(9000 + Math.random() * 999)}`,
      });
    } else {
      payment.isRefunded = true;
      payment.refundAmount = parseFloat(amount);
      payment.refundReason = reason || 'Cancellation';
      payment.status = 'pending';
      payment.refundId = payment.refundId || `RFD-${Math.floor(9000 + Math.random() * 999)}`;
      await payment.save();
    }

    const populated = await Payment.findById(payment._id)
      .populate('customer', 'name phone')
      .populate('booking', 'scheduleDate totalAmount status');

    return sendResponse(res, 201, 'Refund recorded successfully', populated);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a refund status or details
 * @route   PUT /api/v1/admin/finance/refunds/:id
 */
exports.updateAdminRefund = async (req, res, next) => {
  try {
    const { status, refundReason, refundAmount } = req.body;
    const payment = await Payment.findById(req.params.id);
    if (!payment) return sendError(res, 404, 'Refund record not found', 'NOT_FOUND');

    if (status) {
      payment.status =
        status === 'Approved' ? 'refunded' : status === 'Rejected' ? 'failed' : 'pending';
      if (status === 'Approved') payment.isRefunded = true;
    }
    if (refundReason) payment.refundReason = refundReason;
    if (refundAmount) payment.refundAmount = parseFloat(refundAmount);

    await payment.save();

    const populated = await Payment.findById(payment._id)
      .populate('customer', 'name phone')
      .populate('booking', 'scheduleDate totalAmount status');

    return sendResponse(res, 200, 'Refund status updated successfully', populated);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete/revert a refund log
 * @route   DELETE /api/v1/admin/finance/refunds/:id
 */
exports.deleteAdminRefund = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return sendError(res, 404, 'Refund record not found', 'NOT_FOUND');

    payment.isRefunded = false;
    payment.refundAmount = undefined;
    payment.refundReason = undefined;
    payment.status = 'captured';
    await payment.save();

    return sendResponse(res, 200, 'Refund record cleared successfully', null);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all users' wallets & transaction history
 * @route   GET /api/v1/admin/wallets
 */
exports.getAdminWallets = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 20, maxLimit: 100 });
    const query = { role: 'customer' };
    if (req.query.search) {
      const search = { $regex: req.query.search, $options: 'i' };
      query.$or = [{ name: search }, { email: search }, { phone: search }];
    }
    if (req.query.frozen === 'true') query.isWalletFrozen = true;
    if (req.query.frozen === 'false') query.isWalletFrozen = { $ne: true };

    const [users, total, summaryRows] = await Promise.all([
      User.find(query)
        .select({
          name: 1,
          email: 1,
          phone: 1,
          walletBalance: 1,
          isWalletFrozen: 1,
          walletTransactions: { $slice: -20 },
          rewardPoints: 1,
          referralCredits: 1,
        })
        .sort({ walletBalance: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
      User.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            customerCount: { $sum: 1 },
            totalWalletBalance: { $sum: { $ifNull: ['$walletBalance', 0] } },
            totalRewardPoints: { $sum: { $ifNull: ['$rewardPoints', 0] } },
            totalReferralCredits: { $sum: { $ifNull: ['$referralCredits', 0] } },
            frozenWalletCount: { $sum: { $cond: ['$isWalletFrozen', 1, 0] } },
          },
        },
      ]),
    ]);
    const summary = summaryRows[0] || {
      customerCount: 0,
      totalWalletBalance: 0,
      totalRewardPoints: 0,
      totalReferralCredits: 0,
      frozenWalletCount: 0,
    };

    return sendResponse(
      res,
      200,
      'Wallets retrieved successfully',
      { users, summary },
      {
        pagination: paginationMeta(page, limit, total),
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Adjust wallet balance for a user
 * @route   POST /api/v1/admin/wallets/:userId/adjust
 */
exports.adjustUserWallet = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { amount, type, reason } = req.body;

    if (!amount || !type || !reason) {
      return sendError(res, 400, 'Amount, type, and reason are required', 'BAD_REQUEST');
    }

    const user = await User.findById(userId);
    if (!user) {
      return sendError(res, 404, 'User not found', 'NOT_FOUND');
    }

    if (user.isWalletFrozen) {
      return sendError(
        res,
        400,
        'Wallet is frozen. Unfreeze it to perform adjustments.',
        'FORBIDDEN',
      );
    }

    const numericAmount = parseFloat(amount);
    if (type === 'credit') {
      user.walletBalance = (user.walletBalance || 0) + numericAmount;
    } else if (type === 'debit') {
      user.walletBalance = (user.walletBalance || 0) - numericAmount;
    } else {
      return sendError(res, 400, 'Invalid transaction type', 'BAD_REQUEST');
    }

    user.walletTransactions.push({
      amount: numericAmount,
      type,
      reason,
      date: new Date(),
    });

    await user.save();

    return sendResponse(res, 200, 'Wallet adjusted successfully', user);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle freeze status of user's wallet
 * @route   POST /api/v1/admin/wallets/:userId/freeze
 */
exports.toggleUserWalletFreeze = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return sendError(res, 404, 'User not found', 'NOT_FOUND');
    }

    user.isWalletFrozen = !user.isWalletFrozen;
    await user.save();

    return sendResponse(
      res,
      200,
      `Wallet ${user.isWalletFrozen ? 'frozen' : 'unfrozen'} successfully`,
      user,
    );
  } catch (error) {
    next(error);
  }
};
