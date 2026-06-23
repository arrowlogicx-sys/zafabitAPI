const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { findAvailableMaids } = require('../utils/maidAvailability');
const { enqueueDispatchJob, processDispatchJob } = require('../utils/dispatchQueue');
const { transitionBooking } = require('../utils/bookingState');
const { capturePayment } = require('../utils/paymentSettlement');
const {
  beginIdempotentRequest,
  completeIdempotentRequest,
  getRequestIdempotencyKey,
} = require('../utils/idempotency');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const LAST_MINUTE_SCHEDULED_WINDOW_MS =
  Number(process.env.SCHEDULED_LAST_MINUTE_WINDOW_MINUTES || 45) * 60 * 1000;

function buildSuccessBody(message, data, meta = {}) {
  return {
    success: true,
    message,
    data,
    error: null,
    meta: {
      requestId: meta.requestId || uuidv4(),
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

async function sendIdempotentSuccess(res, idempotency, statusCode, message, data) {
  const body = buildSuccessBody(message, data);
  await completeIdempotentRequest(idempotency.record, statusCode, body);
  return res.status(statusCode).json(body);
}

/**
 * @desc    Initiate Razorpay payment order
 * @route   POST /api/v1/payments/initiate
 */
exports.initiatePayment = async (req, res, next) => {
  try {
    const { bookingId, method = 'upi' } = req.body;
    const booking = await Booking.findById(bookingId);

    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    if (req.user.role === 'customer' && booking.customer.toString() !== req.user.id) {
      return sendError(res, 403, 'Not authorized to pay for this booking', 'FORBIDDEN');
    }
    if (booking.bookingType === 'instant' && method !== 'upi') {
      return sendError(res, 400, 'Instant booking supports UPI payment only', 'VALIDATION_ERROR');
    }

    // For instant bookings: verify at least one maid is available BEFORE accepting payment.
    // This prevents charging the customer when no maid can be dispatched.
    if (booking.bookingType === 'instant') {
      const availability = await findAvailableMaids({
        lat: booking.location?.lat,
        lng: booking.location?.lng,
        estimatedDurationMinutes: 60,
        radiusMeters: 5000,
        limit: 1,
      });
      if (!availability.available) {
        return sendError(
          res,
          400,
          'No maids are available near your location right now. Please try again shortly.',
          'NO_MAID_AVAILABLE',
        );
      }
    }

    if (booking.bookingType === 'scheduled') {
      const scheduleAt = booking.scheduleDate ? new Date(booking.scheduleDate) : null;
      const isLastMinuteScheduled =
        scheduleAt &&
        !Number.isNaN(scheduleAt.getTime()) &&
        scheduleAt.getTime() - Date.now() <= LAST_MINUTE_SCHEDULED_WINDOW_MS;

      if (isLastMinuteScheduled) {
        const availability = await findAvailableMaids({
          lat: booking.location?.lat,
          lng: booking.location?.lng,
          estimatedDurationMinutes: booking.totalTime || booking.estimatedTime || 60,
          excludeBookingId: booking._id,
          windowStart: booking.scheduleDate,
          radiusMeters: 5000,
          limit: 1,
        });

        if (!availability.available) {
          return sendError(
            res,
            400,
            'No free maid available for this time. Please choose another slot.',
            'NO_MAID_AVAILABLE',
          );
        }
      }
    }

    // Razorpay logic (Stub)
    // const options = {
    //   amount: booking.totalAmount * 100, // in paisa
    //   currency: 'INR',
    //   receipt: `receipt_${bookingId}`,
    // };
    // const order = await razorpay.orders.create(options);

    const order = {
      id: `mock_upi_${Math.random().toString(36).substring(7)}`,
      amount: booking.totalAmount,
      currency: 'INR',
      method: 'upi',
    };

    const payment = await Payment.create({
      booking: bookingId,
      customer: req.user.id,
      amount: booking.totalAmount,
      razorpayOrderId: order.id,
      method: 'upi',
      status: 'pending',
    });

    return sendResponse(res, 200, 'Payment order initiated', { order, paymentId: payment._id });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify Razorpay payment
 * @route   POST /api/v1/payments/verify
 */
exports.verifyPayment = async (req, res, next) => {
  try {
    const idempotency = await beginIdempotentRequest(
      'payment.verify',
      getRequestIdempotencyKey(req),
      req.body,
    );
    if (idempotency.replay || idempotency.conflict || idempotency.inProgress) {
      return res.status(idempotency.statusCode).json(idempotency.body);
    }

    const { paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature, mock, mockStatus } =
      req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) return sendError(res, 404, 'Payment record not found', 'NOT_FOUND');

    const isMockSuccess = mock === true || mockStatus === 'success';

    if (!isMockSuccess) {
      // Keep legacy signed verification working for existing tests while mock UPI is adopted.
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const generated_signature = crypto
        .createHmac('sha256', secret)
        .update(razorpayOrderId + '|' + razorpayPaymentId)
        .digest('hex');

      if (generated_signature !== razorpaySignature) {
        return sendError(
          res,
          400,
          'Invalid payment signature. Verification failed.',
          'UNAUTHORIZED',
        );
      }
    }

    const booking = await Booking.findById(payment.booking);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    if (req.user.role === 'customer' && booking.customer.toString() !== req.user.id) {
      return sendError(res, 403, 'Not authorized to verify this payment', 'FORBIDDEN');
    }

    const capturedPayment = await capturePayment(payment._id, {
      razorpayPaymentId: razorpayPaymentId || `mock_pay_${Date.now()}`,
      razorpaySignature: razorpaySignature || 'mock_upi_signature',
      idempotencyKey: getRequestIdempotencyKey(req),
    });
    if (!capturedPayment) {
      return sendError(res, 409, 'Payment is already being processed', 'PAYMENT_ALREADY_PROCESSED');
    }

    if (booking.bookingType === 'instant') {
      const transition = await transitionBooking(booking._id, {
        from: ['pending_payment', 'pending', 'searching'],
        to: booking.status === 'searching' ? 'searching' : 'pending_payment',
        note: 'Payment captured for instant booking',
        set: { paymentStatus: 'paid' },
        allowSameStatus: true,
      });
      const paidBooking = transition.booking || booking;
      const job = await enqueueDispatchJob({
        bookingId: paidBooking._id,
        type: 'start_instant',
        idempotencyKey: `start_instant:${paidBooking._id}:${capturedPayment._id}`,
      });
      const dispatch =
        process.env.DISPATCH_PROCESS_INLINE_ON_VERIFY === 'false'
          ? {
              available: true,
              message: 'Dispatch queued',
              booking: paidBooking,
              assignmentState: 'queued',
            }
          : await processDispatchJob(job);
      const checkoutState =
        dispatch.assignmentState === 'failed' ? 'failed' : 'success_pending_assignment';
      const dispatchMessage =
        dispatch.assignmentState === 'failed'
          ? dispatch.message
          : dispatch.available
            ? 'Payment received. Sharing your booking with nearby maids.'
            : 'Payment received. Finding a nearby maid.';

      return sendIdempotentSuccess(res, idempotency, 200, dispatchMessage, {
        payment: capturedPayment,
        booking: dispatch.booking,
        checkoutState,
        dispatch: {
          available: dispatch.available,
          message: dispatchMessage,
          currentOffer: dispatch.currentOffer,
          status: dispatch.assignmentState || 'pending_assignment',
        },
      });
    }

    const paidTransition = await transitionBooking(booking._id, {
      from: [
        'pending_payment',
        'pending',
        'paid_unassigned',
        'searching',
        'admin_attention',
        'accepted',
      ],
      to: booking.bookingType === 'scheduled' && !booking.maid ? 'paid_unassigned' : booking.status,
      note: 'Payment captured',
      set: { paymentStatus: 'paid' },
      allowSameStatus: true,
    });
    const paidBooking = paidTransition.booking || booking;

    if (paidBooking.bookingType === 'scheduled') {
      const job = await enqueueDispatchJob({
        bookingId: paidBooking._id,
        type: 'start_scheduled',
        idempotencyKey: `start_scheduled:${paidBooking._id}:${capturedPayment._id}`,
      });
      const dispatch =
        process.env.DISPATCH_PROCESS_INLINE_ON_VERIFY === 'false'
          ? {
              success: true,
              available: true,
              message: 'Scheduled dispatch queued',
              booking: paidBooking,
              assignmentState: 'queued',
            }
          : await processDispatchJob(job);
      const checkoutState = 'success_pending_assignment';
      return sendIdempotentSuccess(res, idempotency, 200, dispatch.message, {
        payment: capturedPayment,
        booking: dispatch.booking || paidBooking,
        checkoutState,
        dispatch: {
          available: dispatch.available !== false,
          message: dispatch.message,
          candidateCount: dispatch.candidateCount || 0,
          retryAt: dispatch.retryAt,
          expiresAt: dispatch.expiresAt,
          status:
            dispatch.assignmentState || (dispatch.success ? 'broadcast_sent' : 'paid_unassigned'),
        },
      });
    }

    return sendIdempotentSuccess(res, idempotency, 200, 'Payment verified successfully', {
      payment: capturedPayment,
      booking: paidBooking,
      checkoutState: 'success_assigned',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send Payment Reminder (Mock)
 * @route   POST /api/v1/payments/:id/reminder
 */
exports.sendPaymentReminder = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id).populate('customer');
    if (!payment) return sendError(res, 404, 'Payment not found', 'NOT_FOUND');

    if (payment.status !== 'pending') {
      return sendError(res, 400, 'Payment is already processed', 'INVALID_REQUEST');
    }

    const orderRef = payment.razorpayOrderId || `Booking:${payment.booking}`;
    console.log(
      `[PAYMENT REMINDER] Sent to ${payment.customer.phone || payment.customer.name || payment.customer._id}: Please complete payment for Order ${orderRef}`,
    );

    return sendResponse(res, 200, 'Payment reminder sent to customer');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Refund payment
 */
exports.refundPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return sendError(res, 404, 'Payment not found', 'NOT_FOUND');

    // Razorpay refund logic (Stub)
    payment.isRefunded = true;
    payment.status = 'refunded';
    payment.refundAmount = payment.amount;
    await payment.save();

    return sendResponse(res, 200, 'Refund initiated successfully', { payment });
  } catch (error) {
    next(error);
  }
};
