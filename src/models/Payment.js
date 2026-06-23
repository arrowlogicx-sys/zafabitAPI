const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },

    // Razorpay Specific
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,

    status: {
      type: String,
      enum: ['pending', 'captured', 'failed', 'refunded'],
      default: 'pending',
    },

    method: { type: String, enum: ['card', 'upi', 'netbanking', 'wallet'], default: 'upi' },

    // Refund Info
    isRefunded: { type: Boolean, default: false },
    refundId: String,
    refundReason: String,
    refundAmount: Number,
    idempotencyKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

PaymentSchema.index({ booking: 1, status: 1 });
PaymentSchema.index({ customer: 1, createdAt: -1 });
PaymentSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', PaymentSchema);
