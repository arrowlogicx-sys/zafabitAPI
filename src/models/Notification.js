const mongoose = require('mongoose');

/**
 * Per-user in-app notification inbox.
 * Used for real-time alerts: extra time decisions, job updates, etc.
 */
const NotificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'extra_time_approved',
        'extra_time_rejected',
        'job_assigned',
        'job_offer_broadcast',
        'job_offer_taken',
        'job_started',
        'job_completed',
        'booking_cancelled',
        'otp_generated',
        'general',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    meta: {
      bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
      extraCost: Number,
      extraMins: Number,
      newTotal: Number,
      alertType: String,
      urgency: { type: String, enum: ['normal', 'urgent', 'critical'] },
      scheduleDate: Date,
      actionView: String,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Notification', NotificationSchema);
