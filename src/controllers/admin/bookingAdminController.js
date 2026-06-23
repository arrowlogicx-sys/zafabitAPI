const User = require('../../models/User');
const MaidProfile = require('../../models/MaidProfile');
const Booking = require('../../models/Booking');
const Notification = require('../../models/Notification');
const { sendResponse, sendError } = require('../../utils/apiResponse');
const { startBroadcastDispatch } = require('../../utils/scheduledDispatch');

const getRecentBookings = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const bookings = await Booking.find()
      .populate('customer', 'name')
      .populate('maid', 'name email')
      .populate('service', 'name')
      .sort('-createdAt')
      .limit(limit);

    return sendResponse(res, 200, 'Recent bookings retrieved', { bookings });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin manually assigns a Maid to a Booking
 * @route   PATCH /api/v1/admin/bookings/:id/assign
 */

const assignMaidToBooking = async (req, res, next) => {
  try {
    const { maidId } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    const maidUser = await User.findById(maidId);
    if (!maidUser || maidUser.role !== 'maid') {
      return sendError(res, 400, 'Invalid maid ID provided', 'INVALID_REQUEST');
    }

    booking.maid = maidId;
    if (['pending', 'paid_unassigned', 'searching', 'admin_attention'].includes(booking.status)) {
      booking.status = 'accepted';
      booking.startOtp = Math.floor(100000 + Math.random() * 900000).toString();
    }

    booking.statusHistory.push({
      status: booking.status,
      updatedBy: req.user.id,
      note: `Admin assigned maid: ${maidUser.name}`,
    });

    await booking.save();

    const populated = await Booking.findById(booking._id)
      .populate('customer', 'name phone')
      .populate('maid', 'name email phone')
      .populate('service', 'name');

    try {
      const { getIO } = require('../../utils/socket');
      const io = getIO();
      io.to(booking._id.toString()).emit('booking_assigned', {
        bookingId: booking._id,
        maid: populated.maid,
        status: populated.status,
      });
    } catch (err) {
      console.warn('Socket emit ignored in admin assignment');
    }

    return sendResponse(res, 200, 'Maid assigned to booking successfully', populated);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin retries scheduled booking broadcast dispatch
 * @route   PATCH /api/v1/admin/bookings/:id/retry-dispatch
 */

const retryScheduledDispatch = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    if (booking.bookingType !== 'scheduled') {
      return sendError(
        res,
        400,
        'Only scheduled bookings can use scheduled retry dispatch',
        'INVALID_REQUEST',
      );
    }
    if (booking.paymentStatus !== 'paid') {
      return sendError(res, 400, 'Booking payment is not captured yet', 'INVALID_REQUEST');
    }
    if (booking.status === 'accepted' && booking.maid) {
      return sendError(res, 400, 'Booking already has an assigned maid', 'INVALID_REQUEST');
    }

    const dispatch = await startBroadcastDispatch(booking._id, {
      mode: 'urgent',
      finalAttempt: true,
    });

    return sendResponse(res, 200, dispatch.message || 'Scheduled dispatch retried', {
      dispatch,
      booking: dispatch.booking,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin updates a Booking status manually
 * @route   PATCH /api/v1/admin/bookings/:id/status
 */

const updateBookingStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    booking.status = status;

    if (status === 'ongoing') {
      booking.isStarted = true;
      booking.startTime = booking.startTime || Date.now();
    } else if (status === 'completed') {
      booking.endTime = booking.endTime || Date.now();
    } else if (status === 'cancelled' || status === 'refunded') {
      // 1. Cancel background dispatch jobs
      const { cancelDispatchJobs } = require('../../utils/dispatchQueue');
      await cancelDispatchJobs(booking._id, [
        'expire_instant_offer',
        'expire_scheduled_broadcast',
        'start_scheduled',
        'expire_unassigned_scheduled',
        'expire_unassigned_instant',
      ]);

      // 2. Automatically make the maid available again if assigned
      if (booking.maid) {
        const MaidProfile = require('../../models/MaidProfile');
        await MaidProfile.findOneAndUpdate({ user: booking.maid }, { isAvailable: true });
      }

      // 3. Process payment status update so it goes to the refund page
      if (booking.paymentStatus === 'paid') {
        const { refundPaymentForBooking } = require('../../utils/paymentSettlement');
        await refundPaymentForBooking(booking._id, {
          amount: booking.totalAmount,
          reason: `Admin manually ${status === 'refunded' ? 'refunded' : 'cancelled'}`,
        });

        booking.paymentStatus = 'refunded';
      }

      // 4. Send customer notification
      const Notification = require('../../models/Notification');
      await Notification.create({
        recipient: booking.customer,
        type: 'general',
        title: `Booking ${status === 'refunded' ? 'refunded' : 'cancelled'}`,
        message: `Your booking was manually ${status === 'refunded' ? 'refunded' : 'cancelled'} by administration.`,
        meta: { bookingId: booking._id },
      });
    }

    booking.statusHistory.push({
      status,
      updatedBy: req.user.id,
      note: `Admin updated status to ${status}`,
    });

    await booking.save();

    const populated = await Booking.findById(booking._id)
      .populate('customer', 'name phone')
      .populate('maid', 'name email phone')
      .populate('service', 'name');

    return sendResponse(res, 200, 'Booking status updated successfully', populated);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin updates any booking details
 * @route   PUT /api/v1/admin/bookings/:id
 */

const updateAdminBooking = async (req, res, next) => {
  try {
    const { status, totalAmount, scheduleDate } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    if (status) booking.status = status;
    if (totalAmount) booking.totalAmount = parseFloat(totalAmount);
    if (scheduleDate) {
      const nextScheduleDate = new Date(scheduleDate);
      const previousScheduleDate = booking.scheduleDate ? new Date(booking.scheduleDate) : null;
      if (!previousScheduleDate || previousScheduleDate.getTime() !== nextScheduleDate.getTime()) {
        booking.statusHistory.push({
          status: booking.status,
          timestamp: new Date(),
          updatedBy: req.user.id,
          note: `Admin rescheduled booking from ${previousScheduleDate ? previousScheduleDate.toISOString() : 'unscheduled'} to ${nextScheduleDate.toISOString()}`,
        });
      }
      booking.scheduleDate = nextScheduleDate;
    }

    await booking.save();

    const populated = await Booking.findById(booking._id)
      .populate('customer', 'name phone')
      .populate('maid', 'name email phone')
      .populate('service', 'name');

    return sendResponse(res, 200, 'Booking updated successfully by admin', populated);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin deletes a booking
 * @route   DELETE /api/v1/admin/bookings/:id
 */

const deleteAdminBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    return sendResponse(res, 200, 'Booking deleted successfully by admin', null);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Export Platform Datasets (CSV/JSON)
 * @route   GET /api/v1/admin/export/:dataset
 */

module.exports = {
  getRecentBookings,
  assignMaidToBooking,
  retryScheduledDispatch,
  updateBookingStatus,
  updateAdminBooking,
  deleteAdminBooking,
};
