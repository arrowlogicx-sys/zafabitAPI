const mongoose = require('mongoose');

const DispatchAttemptSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchJob', index: true },
    dispatchType: {
      type: String,
      enum: ['instant', 'scheduled'],
      required: true,
      index: true,
    },
    event: {
      type: String,
      enum: [
        'queued',
        'started',
        'candidate_search',
        'notified',
        'accepted',
        'rejected',
        'timeout',
        'expanded',
        'deferred',
        'admin_attention',
        'failed',
        'refunded',
        'completed',
        'cancelled',
      ],
      required: true,
      index: true,
    },
    radiusMeters: Number,
    candidateCount: Number,
    candidates: [
      {
        maidId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        etaMinutes: Number,
        distanceMeters: Number,
        response: String,
      },
    ],
    maid: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: String,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

DispatchAttemptSchema.index({ booking: 1, createdAt: -1 });
DispatchAttemptSchema.index({ dispatchType: 1, event: 1, createdAt: -1 });

module.exports = mongoose.model('DispatchAttempt', DispatchAttemptSchema);
