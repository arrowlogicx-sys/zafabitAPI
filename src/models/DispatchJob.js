const mongoose = require('mongoose');

const DispatchJobSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    type: {
      type: String,
      enum: [
        'start_instant',
        'start_scheduled',
        'expire_instant_offer',
        'expire_scheduled_broadcast',
        'expire_unassigned_scheduled',
        'expire_unassigned_instant',
      ],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    runAt: { type: Date, default: Date.now, index: true },
    lockedAt: Date,
    lockToken: String,
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastError: String,
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

DispatchJobSchema.index({ status: 1, runAt: 1 });
DispatchJobSchema.index({ booking: 1, type: 1, status: 1 });

module.exports = mongoose.model('DispatchJob', DispatchJobSchema);
