const mongoose = require('mongoose');

const NotificationLogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    recipientType: {
      type: String,
      enum: ['all', 'customers', 'maids', 'zone-wise'],
      default: 'all',
    },
    zone: String, // Specific zone if applicable
    sentAt: { type: Date, default: Date.now },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin who sent it
    totalRecipients: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('NotificationLog', NotificationLogSchema);
