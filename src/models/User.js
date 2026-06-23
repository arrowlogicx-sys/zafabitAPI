const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PropertyProfileSchema = new mongoose.Schema(
  {
    bhkType: { type: String }, // Home size / BHK
    homeType: { type: String }, // Apartment, House, Villa, etc.
    memberCount: { type: Number }, // Number of family members
    hasPets: { type: Boolean }, // Has pets status
    petTemperament: { type: String }, // Friendly, Aggressive, Nervous, etc.
    floor: { type: String }, // Floor number or level
    cleaningFrequency: { type: String }, // Weekly, Monthly, etc.
    surfaceType: { type: [String] }, // Marble, Wood, Tile, etc.
    estimatedServiceTime: { type: Number }, // In minutes
  },
  { _id: false },
);

const AddressSchema = new mongoose.Schema(
  {
    title: { type: String, required: true }, // Home, Office, etc.
    houseName: { type: String, required: true }, // House/Flat/Building name
    street: { type: String }, // Street/Area
    landmark: { type: String }, // Landmark
    city: { type: String, required: true },
    state: { type: String }, // State (optional)
    pincode: { type: String, required: true }, // Pincode
    phone: { type: String }, // Mobile number for the address
    latitude: { type: Number }, // GPS location
    longitude: { type: Number }, // GPS location
    isDefault: { type: Boolean, default: true },
    propertyProfile: { type: PropertyProfileSchema, default: () => ({}) },
  },
  { _id: true },
);

const PaymentMethodSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['upi', 'card'], required: true },
    label: { type: String },
    upiId: { type: String },
    last4: { type: String },
    brand: { type: String },
    token: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true },
);

const WalletTopUpSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    method: { type: String, enum: ['upi', 'card', 'netbanking', 'wallet'], default: 'upi' },
    status: { type: String, enum: ['pending', 'captured', 'failed'], default: 'pending' },
    gatewayPaymentId: { type: String },
    capturedAt: { type: Date },
  },
  { _id: true, timestamps: true },
);

const UserSchema = new mongoose.Schema(
  {
    firstName: { type: String },
    lastName: { type: String },
    name: { type: String }, // Legacy/Full name support
    email: { type: String, unique: true, lowercase: true, sparse: true },
    phone: { type: String },
    role: { type: String, enum: ['customer', 'maid', 'admin', 'agent'], default: 'customer' },
    adminRole: {
      type: String,
      enum: [
        'super_admin',
        'operations_admin',
        'finance_admin',
        'support_admin',
        'marketing_admin',
      ],
    },
    employeeId: { type: String, unique: true, sparse: true }, // Unique ID for maids/staff
    password: { type: String },
    addresses: [AddressSchema],
    walletBalance: { type: Number, default: 0 },
    isWalletFrozen: { type: Boolean, default: false },
    walletTransactions: [
      {
        amount: Number,
        type: { type: String, enum: ['credit', 'debit'] },
        reason: String,
        date: { type: Date, default: Date.now },
      },
    ],
    paymentMethods: [PaymentMethodSchema],
    walletTopUps: [WalletTopUpSchema],
    rewardPoints: { type: Number, default: 0 },
    referralCode: { type: String, unique: true },
    referredBy: { type: String },
    referralCredits: { type: Number, default: 0 },
    isReferralRewardClaimed: { type: Boolean, default: false },

    // App Preferences
    language: { type: String, enum: ['en', 'ml', 'hi', 'ta'], default: 'en' },
    pushToken: { type: String },

    // Auth Fields
    otp: { type: String },
    otpExpires: { type: Date },
    isVerified: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },

    // Avatar image
    avatarUrl: { type: String },
    avatarPublicId: { type: String },
    // Profile References (Normalization)
    maidProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'MaidProfile' },
    customerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerProfile' },
    agentProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' },
  },
  { timestamps: true },
);

// Password hashing middleware
UserSchema.pre('save', async function () {
  if (this.isModified('password') && this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Populate name from firstName and lastName
  if (this.firstName || this.lastName) {
    this.name = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }

  if (!this.referralCode) {
    this.referralCode = `AR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }
});

// Compare password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.index({ role: 1, createdAt: -1 });
UserSchema.index({ role: 1, walletBalance: -1, createdAt: -1 });
UserSchema.index({ referredBy: 1 });
UserSchema.index({ role: 1, isBlocked: 1, isVerified: 1, createdAt: -1 });

module.exports = mongoose.model('User', UserSchema);
