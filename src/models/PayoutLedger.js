const mongoose = require('mongoose');

const PayoutLedgerSchema = new mongoose.Schema(
  {
    maid: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookingIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }],
    bookingCount: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    serviceSubtotal: { type: Number, default: 0 },
    maidShareAmount: { type: Number, default: 0 },
    companyShareAmount: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    grossAmount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'released', 'failed'],
      default: 'released',
    },
    referenceId: { type: String, required: true, unique: true },
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    releasedAt: Date,
    failureReason: String,
  },
  { timestamps: true },
);

PayoutLedgerSchema.index({ maid: 1, createdAt: -1 });
PayoutLedgerSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('PayoutLedger', PayoutLedgerSchema);
