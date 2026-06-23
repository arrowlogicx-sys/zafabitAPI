const mongoose = require('mongoose');

const BOOKING_STATUSES = [
  'pending_payment',
  'pending',
  'paid_unassigned',
  'searching',
  'admin_attention',
  'accepted',
  'in_transit',
  'arrived',
  'ongoing',
  'completed',
  'cancelled',
  'refunded',
  'reschedule_requested',
  'failed',
];

const BookingStatusSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: BOOKING_STATUSES,
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  note: String,
});

const BookingSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    maid: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    items: [
      {
        service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
        name: String,
        price: Number,
        duration: { type: Number, required: true },
      },
    ],
    subtotal: { type: Number, required: true },
    platformFee: { type: Number, default: 29 },
    gstPercent: { type: Number, default: 9 },
    gst: { type: Number, default: 0 },
    grossAmount: { type: Number },
    maidSharePercent: { type: Number, default: 70 },
    maidShareAmount: { type: Number, default: 0 },
    companyShareAmount: { type: Number, default: 0 },
    companyRevenueAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    isPaidOut: { type: Boolean, default: false },
    payoutStatus: {
      type: String,
      enum: ['pending', 'processing', 'released', 'failed'],
      default: 'pending',
    },
    payoutReleasedAt: Date,
    payoutReferenceId: String,
    payoutLedger: { type: mongoose.Schema.Types.ObjectId, ref: 'PayoutLedger' },
    totalAmount: { type: Number, required: true },
    address: {
      title: String,
      houseName: String,
      street: String,
      landmark: String,
      city: String,
      pincode: String,
      state: String,
      phone: String,
    },
    scheduleDate: { type: Date, required: true }, // For advance scheduling
    bookingType: { type: String, enum: ['instant', 'scheduled'], default: 'instant' },

    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    statusHistory: [BookingStatusSchema],

    matchingQueue: [
      {
        maidId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        etaMinutes: Number,
        distanceMeters: Number,
        offeredAt: Date,
        respondedAt: Date,
        response: {
          type: String,
          enum: ['pending', 'accepted', 'rejected', 'timeout', 'skipped', 'unavailable'],
          default: 'pending',
        },
      },
    ],
    currentQueueIndex: { type: Number, default: 0 },
    offerExpiresAt: { type: Date },
    searchRadiusMeters: { type: Number, default: 5000 },
    dispatchStartedAt: { type: Date },
    dispatchFailedReason: { type: String },

    // Job Workflow
    startOtp: { type: String },
    isStarted: { type: Boolean, default: false },
    startTime: { type: Date },
    endTime: { type: Date },

    // ── Task Checklist (auto-generated from booking items when job starts) ───
    checklist: [
      {
        task: { type: String, required: true }, // e.g. "Sweep all rooms"
        isDone: { type: Boolean, default: false },
      },
    ],

    // Extras & Tracking
    extraTimeRequest: {
      minutes: Number,
      cost: Number,
      note: { type: String }, // Maid's reason / note to customer
      status: { type: String, enum: ['pending', 'approved', 'rejected'] },
    },
    photos: {
      before: [String],
      after: [String],
    },
    location: {
      lat: Number,
      lng: Number,
    },
    // Real-time tracking status
    isNearbyNotificationSent: { type: Boolean, default: false },
    lastMaidLocation: {
      lat: Number,
      lng: Number,
    },
    lastSeenAt: { type: Date },

    // Property Profiling & Estimation
    propertyProfile: {
      bhkType: {
        type: String,
      },
      cleaningFrequency: {
        type: String,
      },
      surfaceType: [
        {
          type: String,
        },
      ],
    },
    estimatedTime: { type: Number }, // Result in minutes
    totalTime: { type: Number }, // Result in minutes including approved extra time
  },
  { timestamps: true },
);

// Middleware to push to statusHistory
BookingSchema.pre('save', async function () {
  if (this.isModified('status')) {
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date(),
    });
  }

  // Initialize totalTime to estimatedTime on creation if not set
  if (this.isNew && !this.totalTime && this.estimatedTime) {
    this.totalTime = this.estimatedTime;
  }
});

BookingSchema.index({ maid: 1, status: 1 });
BookingSchema.index({ bookingType: 1, scheduleDate: 1, status: 1 });
BookingSchema.index({ paymentStatus: 1, status: 1 });
BookingSchema.index({ status: 1, updatedAt: -1 });
BookingSchema.index({ customer: 1, createdAt: -1 });
BookingSchema.index({ maid: 1, isPaidOut: 1, status: 1 });
BookingSchema.index({ status: 1, isPaidOut: 1, maid: 1 });
BookingSchema.index({ status: 1, createdAt: -1 });
BookingSchema.index({ status: 1, createdAt: 1 });
BookingSchema.index({ createdAt: -1 });
BookingSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Booking', BookingSchema);
