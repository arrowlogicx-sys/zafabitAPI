const mongoose = require('mongoose');

const AgentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    agentCode: { type: String, required: true, unique: true }, // Tracking code
    zone: { type: String }, // Area of operation
    commissionRate: { type: Number, default: 0 }, // Incentive per referral
    referredMaids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    earnings: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Agent', AgentSchema);
