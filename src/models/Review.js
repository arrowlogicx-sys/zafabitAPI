const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    maid: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: String, required: true },
    tags: [
      {
        type: String,
        enum: ['Punctual', 'Friendly', 'Thorough', 'Clean workspace', 'Good value', 'Expertise'],
      },
    ],

    // Feedback Sentiment (Auto-populated in controller)
    sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      default: 'neutral',
    },

    // Issues (Issue Resolution section)
    isIssueRaised: { type: Boolean, default: false },
    issueStatus: {
      type: String,
      enum: ['none', 'pending', 'resolved'],
      default: 'none',
    },
    issueDescription: String,
    adminResolution: String,
    resolvedAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model('Review', ReviewSchema);
