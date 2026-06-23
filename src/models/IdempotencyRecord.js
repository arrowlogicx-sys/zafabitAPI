const mongoose = require('mongoose');

const IdempotencyRecordSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    scope: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      default: 'processing',
      index: true,
    },
    requestHash: String,
    response: {
      statusCode: Number,
      body: mongoose.Schema.Types.Mixed,
    },
    expiresAt: { type: Date, index: { expires: 0 } },
  },
  { timestamps: true },
);

IdempotencyRecordSchema.index({ scope: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyRecord', IdempotencyRecordSchema);
