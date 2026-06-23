const mongoose = require('mongoose');

const ServiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    category: { type: String, required: true }, // Deep Cleaning, Kitchen, etc.
    price: { type: Number, required: true },
    originalPrice: { type: Number }, // Crossed-out original price
    estimatedTime: { type: Number }, // in minutes
    image: { type: String },
    imagePublicId: { type: String },
    whatsIncluded: [{ type: String }], // What is included in this service
    doesNotInclude: [{ type: String }], // Exclusions
    howItsDone: [
      {
        title: { type: String, required: true },
        description: { type: String },
        iconUrl: { type: String },
      },
    ],
    faqs: [
      {
        question: { type: String, required: true },
        answer: { type: String },
      },
    ],
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    translations: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Service', ServiceSchema);
