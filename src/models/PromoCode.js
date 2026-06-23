const mongoose = require('mongoose');

const PromoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, required: true },
    type: { type: String, enum: ['percentage', 'flat'], default: 'percentage' },
    discountValue: { type: Number, required: true },
    maxDiscount: { type: Number },
    minBookingAmount: { type: Number, default: 0 },
    expiryDate: { type: Date },
    usageLimit: { type: Number },
    redemptionsCount: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'expired', 'scheduled'], default: 'active' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PromoCode', PromoCodeSchema);
