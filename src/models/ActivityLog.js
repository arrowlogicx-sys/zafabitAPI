const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    details: { type: String },
    status: { type: String, enum: ['Success', 'Warning', 'Failure'], default: 'Success' },
    ipAddress: { type: String, default: 'Internal' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
