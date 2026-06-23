const mongoose = require('mongoose');

const CustomerProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // Property Profile (Help Us Serve You Better)
    propertyProfile: {
      bhkType: { type: String }, // Home size / BHK
      homeType: { type: String }, // Apartment, House, Villa, etc.
      memberCount: { type: Number }, // Number of family members
      hasPets: { type: Boolean }, // Has pets status
      petTemperament: { type: String }, // Friendly, Aggressive, Nervous, etc.
      floor: { type: String }, // NEW: Floor number or level
      cleaningFrequency: { type: String }, // Weekly, Monthly, etc.
      surfaceType: { type: [String] }, // Marble, Wood, Tile, etc.
      estimatedServiceTime: { type: Number }, // In minutes
    },

    // Preferences
    preferredLanguage: { type: String },
    favoriteMaids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // History Summary
    totalBookings: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('CustomerProfile', CustomerProfileSchema);
