const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema(
  {
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    duration: { type: Number, required: true }, // in minutes
  },
  { _id: false },
);

const CartSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    serviceCart: [CartItemSchema],
    totalAmount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Cart', CartSchema);
