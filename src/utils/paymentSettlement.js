const Payment = require('../models/Payment');

async function capturePayment(paymentId, details = {}) {
  const payment = await Payment.findOneAndUpdate(
    {
      _id: paymentId,
      status: { $in: ['pending', 'captured'] },
    },
    {
      $set: {
        razorpayPaymentId: details.razorpayPaymentId,
        razorpaySignature: details.razorpaySignature,
        status: 'captured',
        ...(details.idempotencyKey ? { idempotencyKey: details.idempotencyKey } : {}),
      },
    },
    { returnDocument: 'after' },
  );

  return payment;
}

async function refundPaymentForBooking(bookingId, options = {}) {
  const payment = await Payment.findOneAndUpdate(
    {
      booking: bookingId,
      status: { $ne: 'refunded' },
    },
    {
      $set: {
        status: 'refunded',
        isRefunded: true,
        refundAmount: options.amount,
        refundReason: options.reason || 'Dispatch failed',
        ...(options.refundId ? { refundId: options.refundId } : {}),
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      },
    },
    { returnDocument: 'after' },
  );

  return payment;
}

module.exports = {
  capturePayment,
  refundPaymentForBooking,
};
