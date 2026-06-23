const User = require('../models/User');
const MaidProfile = require('../models/MaidProfile');
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { markMaidOnline, refreshMaidPresence } = require('../utils/presence');
const { resolveBookingFinanceSnapshot } = require('../utils/billingConfig');
const { resolvePublicAssetUrl } = require('../utils/publicAssetUrl');

/**
 * @desc    Toggle Availability Status
 * @route   PATCH /api/v1/maids/availability
 */
exports.toggleAvailability = async (req, res, next) => {
  try {
    if (req.user.role !== 'maid') {
      return sendError(res, 403, 'Only maids can update availability', 'FORBIDDEN');
    }

    const profile = await MaidProfile.findOne({ user: req.user.id });
    if (!profile) return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');

    const hasExplicitValue = req.body && req.body.isAvailable !== undefined;
    const nextAvailability = hasExplicitValue
      ? req.body.isAvailable === true || req.body.isAvailable === 'true'
      : !profile.isAvailable;

    profile.isAvailable = nextAvailability;
    await profile.save();

    if (profile.isOnline) {
      await refreshMaidPresence(req.user.id, { source: 'availability' });
    }

    return sendResponse(res, 200, `Availability turned ${profile.isAvailable ? 'ON' : 'OFF'}`, {
      isAvailable: profile.isAvailable,
      isOnline: profile.isOnline,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update maid live location for instant dispatch and tracking
 * @route   PATCH /api/v1/maids/location
 */
exports.updateMaidLocation = async (req, res, next) => {
  try {
    if (req.user.role !== 'maid') {
      return sendError(res, 403, 'Only maids can update live location', 'FORBIDDEN');
    }

    const lat = Number(req.body.lat ?? req.body.latitude);
    const lng = Number(req.body.lng ?? req.body.lon ?? req.body.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return sendError(res, 400, 'lat and lng are required', 'VALIDATION_ERROR');
    }

    const isOnline =
      req.body.isOnline === undefined
        ? true
        : req.body.isOnline === true || req.body.isOnline === 'true';
    const profile = await MaidProfile.findOne({ user: req.user.id });
    if (!profile) return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');

    profile.isOnline = isOnline;
    profile.lastLocationUpdatedAt = new Date();
    profile.lastLocation = {
      lat,
      lng,
      lastUpdated: profile.lastLocationUpdatedAt,
    };
    profile.currentLocation = {
      type: 'Point',
      coordinates: [lng, lat],
    };

    if (req.body.isAvailable !== undefined) {
      profile.isAvailable = req.body.isAvailable === true || req.body.isAvailable === 'true';
    }

    await profile.save();

    if (isOnline) {
      await markMaidOnline(req.user.id, { source: 'location' });
    }

    return sendResponse(res, 200, 'Live location updated', {
      isOnline: profile.isOnline,
      isAvailable: profile.isAvailable,
      location: {
        lat,
        lng,
      },
      lastLocationUpdatedAt: profile.lastLocationUpdatedAt,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Upload Verification Documents
 * @route   POST /api/v1/maids/documents
 */
exports.uploadVerifyDocs = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return sendError(res, 400, 'Please upload documents', 'VALIDATION_ERROR');
    }

    const docUrls = req.files.map((file) => ({
      type: req.body.type || 'ID_PROOF',
      url: `/uploads/documents/${file.filename}`,
      status: 'pending',
    }));

    const profile = await MaidProfile.findOneAndUpdate(
      { user: req.user.id },
      { $push: { documents: { $each: docUrls } }, activeStatus: 'on-hold' },
      { returnDocument: 'after' },
    );

    return sendResponse(res, 200, 'Documents uploaded. Status moved to on-hold.', {
      documents: profile.documents,
      activeStatus: profile.activeStatus,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Upload Selfie for status activation
 * @route   POST /api/v1/maids/selfie
 */
exports.uploadSelfie = async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(res, 400, 'Please upload a selfie', 'VALIDATION_ERROR');
    }

    const url = `/uploads/selfies/${req.file.filename}`;
    const profile = await MaidProfile.findOneAndUpdate(
      { user: req.user.id },
      { selfieUrl: url }, // Keep on-hold until admin verification
      { returnDocument: 'after' },
    );

    return sendResponse(res, 200, 'Selfie uploaded. Waiting for admin verification.', {
      selfieUrl: profile.selfieUrl,
      activeStatus: profile.activeStatus,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Earnings Dashboard
 * @route   GET /api/v1/maids/earnings
 * @access  Protected (Maid)
 *
 * Query params:
 *   period — "week" (default) | "month" | "all"
 *
 * Returns:
 *   totalEarnings      — all-time net maid share from completed bookings
 *   thisWeek / lastWeek — comparison for the badge (e.g. +18.8% vs last week)
 *   weeklyTrend        — array of { day: "Mon", earnings: 680 } for the chart
 *   dailyBreakdown     — list of { date, label, jobCount, earnings } for the list
 */
exports.getEarnings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const profile = await MaidProfile.findOne({ user: userId });
    if (!profile) return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');

    // ── All-time totals ───────────────────────────────────────────────────
    const allCompleted = await Booking.find({ maid: userId, status: 'completed' });
    const totalRevenue = allCompleted.reduce(
      (s, b) => s + resolveBookingFinanceSnapshot(b).grossAmount,
      0,
    );
    const totalEarnings = allCompleted.reduce(
      (s, b) => s + resolveBookingFinanceSnapshot(b).maidShareAmount,
      0,
    );
    const totalJobs = allCompleted.length;

    // ── Week boundaries ─────────────────────────────────────────────────
    const now = new Date();
    // This week: Mon 00:00 → Sun 23:59
    const dayOfWeek = now.getDay(); // 0=Sun
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() + diffToMon);
    thisMonday.setHours(0, 0, 0, 0);
    const thisSunday = new Date(thisMonday);
    thisSunday.setDate(thisMonday.getDate() + 6);
    thisSunday.setHours(23, 59, 59, 999);

    // Last week
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);
    lastSunday.setHours(23, 59, 59, 999);

    // ── This week & last week earnings ─────────────────────────────────
    const [thisWeekJobs, lastWeekJobs] = await Promise.all([
      Booking.find({
        maid: userId,
        status: 'completed',
        scheduleDate: { $gte: thisMonday, $lte: thisSunday },
      }),
      Booking.find({
        maid: userId,
        status: 'completed',
        scheduleDate: { $gte: lastMonday, $lte: lastSunday },
      }),
    ]);

    const thisWeekEarnings = thisWeekJobs.reduce(
      (s, b) => s + resolveBookingFinanceSnapshot(b).maidShareAmount,
      0,
    );
    const lastWeekEarnings = lastWeekJobs.reduce(
      (s, b) => s + resolveBookingFinanceSnapshot(b).maidShareAmount,
      0,
    );

    // Percent change vs last week
    let weeklyChange = 0;
    let weeklyChangeLabel = 'No data for last week';
    if (lastWeekEarnings > 0) {
      weeklyChange = ((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100;
      weeklyChangeLabel = `${weeklyChange >= 0 ? '+' : ''}${weeklyChange.toFixed(1)}% vs last week`;
    }

    // ── Weekly trend (Mon–Sun bar chart data) ─────────────────────────────
    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weeklyTrend = DAY_LABELS.map((label, i) => {
      const dayStart = new Date(thisMonday);
      dayStart.setDate(thisMonday.getDate() + i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const dayJobs = thisWeekJobs.filter((b) => {
        const d = new Date(b.scheduleDate);
        return d >= dayStart && d <= dayEnd;
      });
      const dayEarnings = dayJobs.reduce(
        (s, b) => s + resolveBookingFinanceSnapshot(b).maidShareAmount,
        0,
      );

      return { day: label, earnings: dayEarnings, jobs: dayJobs.length };
    });

    // ── Daily breakdown (last 7 distinct working days) ───────────────────────
    // Group last 30 days of completions by calendar date
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const recentJobs = await Booking.find({
      maid: userId,
      status: 'completed',
      scheduleDate: { $gte: thirtyDaysAgo },
    }).sort('-scheduleDate');

    // Group by date string
    const byDate = {};
    recentJobs.forEach((b) => {
      const key = new Date(b.scheduleDate).toDateString();
      if (!byDate[key]) byDate[key] = { date: new Date(b.scheduleDate), jobs: [] };
      byDate[key].jobs.push(b);
    });

    const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    const dailyBreakdown = Object.values(byDate)
      .sort((a, b) => b.date - a.date)
      .slice(0, 14) // last 14 working days
      .map(({ date, jobs }) => {
        const earnings = jobs.reduce(
          (s, b) => s + resolveBookingFinanceSnapshot(b).maidShareAmount,
          0,
        );
        return {
          date: date.toISOString().split('T')[0],
          label: `${DAY_SHORT[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`,
          dayInitial: DAY_SHORT[date.getDay()][0], // "M", "T", etc. for avatar
          jobCount: jobs.length,
          jobLabel: `${jobs.length} booking${jobs.length !== 1 ? 's' : ''} completed`,
          earnings,
        };
      });

    return sendResponse(res, 200, 'Earnings data retrieved', {
      summary: {
        totalEarnings,
        totalJobs,
        referralIncentives: profile.referralIncentives || 0,
        totalPayout: totalEarnings + (profile.referralIncentives || 0),
        currency: 'INR',
      },
      thisWeek: {
        earnings: thisWeekEarnings,
        jobs: thisWeekJobs.length,
        changeLabel: weeklyChangeLabel,
        changePct: Math.round(weeklyChange * 10) / 10,
      },
      weeklyTrend, // [{day:"Mon", earnings:680, jobs:4}, ...]
      dailyBreakdown, // [{date, label, dayInitial, jobCount, jobLabel, earnings}, ...]
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Jobs for Maid (All or filtered by Date)
 * @route   GET /api/v1/maids/jobs
 */
exports.getMaidJobs = async (req, res, next) => {
  try {
    const { date, filter } = req.query;
    let query = { maid: req.user.id, status: { $nin: ['cancelled', 'refunded'] } };

    if (date) {
      const searchDate = new Date(date);
      const startOfDay = new Date(searchDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(searchDate.setHours(23, 59, 59, 999));
      query.scheduleDate = { $gte: startOfDay, $lte: endOfDay };
    } else if (filter === 'week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      query.scheduleDate = { $gte: startOfWeek, $lte: endOfWeek };
    } else if (filter === 'month') {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const endOfMonth = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      query.scheduleDate = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const jobs = await Booking.find(query)
      .populate('customer', 'name phone')
      .populate('service', 'name')
      .sort('scheduleDate');

    let message = 'All jobs retrieved';
    if (date) message = `Jobs for ${date} retrieved`;
    else if (filter === 'week') message = 'Jobs for this week retrieved';
    else if (filter === 'month') message = 'Jobs for this month retrieved';

    return sendResponse(res, 200, message, { jobs });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Support & Safety Access
 * @route   GET /api/v1/maids/support
 */
exports.getSupportInfo = async (req, res, next) => {
  try {
    const supportInfo = {
      sos: {
        police: '100',
        ambulance: '108',
        emergency_contact: '9999999999',
      },
      helpline: '1800-CLEAN-APP',
      safety_guidelines: [
        'Always share your location while on a job',
        'Verify customer identity if possible',
        'Use the SOS button in case of immediate danger',
        'Contact support for any payment discrepancies',
      ],
    };

    return sendResponse(res, 200, 'Support information retrieved', supportInfo);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update Own Profile Details (Maid App)
 * @route   PUT /api/v1/maid/profile
 */
exports.updateOwnProfile = async (req, res, next) => {
  try {
    const { name, phone, email, zone } = req.body;

    let user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (email) user.email = email;
    await user.save();

    let profile;
    if (zone) {
      profile = await MaidProfile.findOneAndUpdate(
        { user: req.user.id },
        { zone },
        { returnDocument: 'after' },
      );
    } else {
      profile = await MaidProfile.findOne({ user: req.user.id });
    }

    return sendResponse(res, 200, 'Your profile was updated successfully', { user, profile });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  POST-LOGIN ONBOARDING FLOW  (Steps 1 → 4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    Step 1 — Submit Selfie for face-verification during onboarding
 * @route   POST /api/v1/maids/onboarding/selfie
 * @access  Protected (Maid)
 *
 * Body (multipart/form-data):
 *   selfie  — image file
 */
exports.onboardingSelfie = async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(res, 400, 'Please upload a selfie image', 'VALIDATION_ERROR');
    }

    const selfieUrl = `/uploads/selfies/${req.file.filename}`;

    const profile = await MaidProfile.findOneAndUpdate(
      { user: req.user.id },
      {
        selfieUrl,
        activeStatus: 'on-hold', // Held until admin verifies
        onboardingStep: 1, // Mark step 1 complete
      },
      { returnDocument: 'after' },
    );

    if (!profile) {
      return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');
    }

    return sendResponse(res, 200, 'Selfie uploaded. Waiting for admin verification.', {
      selfieUrl: profile.selfieUrl,
      activeStatus: profile.activeStatus,
      onboardingStep: profile.onboardingStep,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Step 2 — Save Preferred Job Type
 * @route   POST /api/v1/maids/onboarding/job-type
 * @access  Protected (Maid)
 *
 * Body (JSON):
 *   jobType  — "full_time" | "part_time" | "weekend_only" | "morning_shift" | "evening_shift"
 *   language — optional, defaults to "en"
 */
exports.onboardingJobType = async (req, res, next) => {
  try {
    const { jobType, language } = req.body;

    const VALID_JOB_TYPES = [
      'full_time',
      'part_time',
      'weekend_only',
      'morning_shift',
      'evening_shift',
    ];

    if (!jobType || !VALID_JOB_TYPES.includes(jobType)) {
      return sendError(
        res,
        400,
        `jobType is required. Valid values: ${VALID_JOB_TYPES.join(', ')}`,
        'VALIDATION_ERROR',
      );
    }

    // Persist language on the User document (default 'en')
    const user = await User.findById(req.user.id);
    if (user) {
      user.language = language || 'en';
      await user.save();
    }

    const profile = await MaidProfile.findOneAndUpdate(
      { user: req.user.id },
      {
        jobType,
        language: language || 'en',
        onboardingStep: 2,
      },
      { returnDocument: 'after' },
    );

    if (!profile) {
      return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');
    }

    return sendResponse(res, 200, 'Job type preference saved', {
      jobType: profile.jobType,
      language: profile.language,
      onboardingStep: profile.onboardingStep,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Step 3 — Save Work Area Preferences
 * @route   POST /api/v1/maids/onboarding/work-areas
 * @access  Protected (Maid)
 *
 * Body (JSON):
 *   workAreas — string[]  e.g. ["Kakkanad", "Vyttila", "Edappally"]
 */
exports.onboardingWorkAreas = async (req, res, next) => {
  try {
    const { workAreas } = req.body;

    if (!workAreas || !Array.isArray(workAreas) || workAreas.length === 0) {
      return sendError(
        res,
        400,
        'workAreas must be a non-empty array of area names',
        'VALIDATION_ERROR',
      );
    }

    // Sanitise: trim whitespace from each area
    const sanitised = workAreas.map((a) => String(a).trim()).filter(Boolean);

    const profile = await MaidProfile.findOneAndUpdate(
      { user: req.user.id },
      {
        workAreas: sanitised,
        onboardingStep: 3,
      },
      { returnDocument: 'after' },
    );

    if (!profile) {
      return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');
    }

    return sendResponse(res, 200, 'Work area preferences saved', {
      workAreas: profile.workAreas,
      onboardingStep: profile.onboardingStep,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Step 4 — Confirm & Complete Onboarding (returns full profile summary)
 * @route   POST /api/v1/maids/onboarding/confirm
 * @access  Protected (Maid)
 *
 * No body required — just marks onboarding as complete and returns the summary
 * shown on the "Almost Done!" screen.
 */
exports.onboardingConfirm = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const profile = await MaidProfile.findOneAndUpdate(
      { user: req.user.id },
      { onboardingStep: 4 },
      { returnDocument: 'after' },
    );

    if (!profile) {
      return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');
    }

    const JOB_TYPE_LABELS = {
      full_time: 'Full Time',
      part_time: 'Part Time',
      weekend_only: 'Weekend Only',
      morning_shift: 'Morning Shift',
      evening_shift: 'Evening Shift',
    };

    const LANGUAGE_LABELS = {
      en: 'English',
      ml: 'Malayalam',
      hi: 'Hindi',
      ta: 'Tamil',
    };

    return sendResponse(res, 200, 'Onboarding complete. Welcome!', {
      onboardingStep: profile.onboardingStep,
      summary: {
        language: LANGUAGE_LABELS[profile.language] || 'English',
        jobType: JOB_TYPE_LABELS[profile.jobType] || profile.jobType,
        workAreas: profile.workAreas,
        activeStatus: profile.activeStatus,
        selfieUrl: profile.selfieUrl,
      },
      user: {
        id: user._id,
        name: user.name,
        employeeId: user.employeeId,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current onboarding status (resume from last step)
 * @route   GET /api/v1/maids/onboarding/status
 * @access  Protected (Maid)
 */
exports.getOnboardingStatus = async (req, res, next) => {
  try {
    const profile = await MaidProfile.findOne({ user: req.user.id });

    if (!profile) {
      return sendError(res, 404, 'Maid profile not found', 'NOT_FOUND');
    }

    const STEP_LABELS = {
      0: 'selfie_verification',
      1: 'job_type_selection',
      2: 'work_area_selection',
      3: 'confirm',
      4: 'completed',
    };

    return sendResponse(res, 200, 'Onboarding status retrieved', {
      onboardingStep: profile.onboardingStep,
      nextStep: STEP_LABELS[profile.onboardingStep] || 'completed',
      isOnboardingComplete: profile.onboardingStep === 4,
      data: {
        selfieUrl: profile.selfieUrl,
        jobType: profile.jobType,
        workAreas: profile.workAreas,
        language: profile.language || 'en',
        activeStatus: profile.activeStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  HOME DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    Home Dashboard — stats, latest new request, today's schedule
 * @route   GET /api/v1/maids/dashboard
 * @access  Protected (Maid)
 */
exports.getMaidDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // ── Date helpers ────────────────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // ── Profile ─────────────────────────────────────────────────────────
    const profile = await MaidProfile.findOne({ user: userId });

    // ── Stats ────────────────────────────────────────────────────────────
    // Jobs today (any non-cancelled booking scheduled today)
    const jobsTodayCount = await Booking.countDocuments({
      maid: userId,
      scheduleDate: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ['accepted', 'in_transit', 'arrived', 'ongoing', 'completed'] },
    });

    // Earnings today (sum of completed bookings scheduled today — maid gets 70%)
    const todayCompleted = await Booking.find({
      maid: userId,
      scheduleDate: { $gte: todayStart, $lte: todayEnd },
      status: 'completed',
    });
    const earnedToday = todayCompleted.reduce((sum, b) => sum + b.totalAmount * 0.7, 0);

    // Rating from MaidProfile
    const rating = profile ? profile.rating : 0;

    // ── Latest New Request ───────────────────────────────────────────────
    // Most recent pending booking assigned to this maid (or unassigned if admin pushed it)
    let latestRequest = await Booking.findOne({
      maid: userId,
      status: 'pending',
    })
      .populate('customer', 'name phone')
      .populate('service', 'name')
      .sort('-createdAt');

    let activeOfferDoc = null;
    if (!latestRequest) {
      // Find a booking in 'searching' status where the offer is targeted to this maid and not expired yet
      const activeOffer = await Booking.findOne({
        status: 'searching',
        offerExpiresAt: { $gt: new Date() },
      })
        .populate('customer', 'name phone')
        .populate('service', 'name')
        .sort('-createdAt');

      if (activeOffer) {
        if (activeOffer.bookingType === 'scheduled') {
          // Broadcast: check if this maid is in the queue with response 'pending'
          const myOffer = activeOffer.matchingQueue?.find(
            (q) => q.maidId.toString() === userId.toString() && q.response === 'pending',
          );
          if (myOffer) {
            latestRequest = activeOffer;
            activeOfferDoc = activeOffer;
          }
        } else {
          // Instant: check if current queue index matches this maid and response is 'pending'
          const currentOffer = activeOffer.matchingQueue?.[activeOffer.currentQueueIndex];
          if (
            currentOffer &&
            currentOffer.maidId.toString() === userId.toString() &&
            currentOffer.response === 'pending'
          ) {
            latestRequest = activeOffer;
            activeOfferDoc = activeOffer;
          }
        }
      }
    }

    // ── Today's Schedule ─────────────────────────────────────────────────
    const todaySchedule = await Booking.find({
      maid: userId,
      scheduleDate: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ['accepted', 'in_transit', 'arrived', 'ongoing', 'completed'] },
    })
      .populate('service', 'name')
      .populate('customer', 'name phone')
      .sort('scheduleDate')
      .limit(10);

    // Format schedule items for the app
    const formattedSchedule = todaySchedule.map((b) => {
      const start = b.scheduleDate;
      const durationMins = b.estimatedTime || 60;
      const end = new Date(start.getTime() + durationMins * 60000);

      const fmt = (d) =>
        d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      return {
        bookingId: b._id,
        serviceName: b.service?.name || 'Service',
        customerName: b.customer?.name || '',
        address: b.address
          ? `${b.address.houseName || ''}, ${b.address.street || ''}, ${b.address.city || ''}`.replace(
              /^,\s*|,\s*$/g,
              '',
            )
          : '',
        timeSlot: `${fmt(start)} – ${fmt(end)}`,
        status: b.status, // pending | accepted | ongoing | completed
        totalAmount: b.totalAmount,
      };
    });

    // ── Format latest request ────────────────────────────────────────────
    let formattedRequest = null;
    if (latestRequest) {
      const start = latestRequest.scheduleDate;
      const durationMins = latestRequest.estimatedTime || 60;
      const end = new Date(start.getTime() + durationMins * 60000);
      const fmt = (d) =>
        d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      // Determine precise timestamp of when the request was targeted/offered to this maid
      let offerTimestamp = latestRequest.createdAt;
      if (activeOfferDoc) {
        const queueOffer = activeOfferDoc.matchingQueue?.[activeOfferDoc.currentQueueIndex];
        if (queueOffer && queueOffer.offeredAt) {
          offerTimestamp = queueOffer.offeredAt;
        } else if (activeOfferDoc.updatedAt) {
          offerTimestamp = activeOfferDoc.updatedAt;
        }
      }

      formattedRequest = {
        bookingId: latestRequest._id,
        serviceName: latestRequest.service?.name || 'Service',
        customerName: latestRequest.customer?.name || '',
        address: latestRequest.address
          ? `${latestRequest.address.houseName || ''}, ${latestRequest.address.city || ''}`
          : '',
        timeSlot: `${fmt(start)} – ${fmt(end)}`,
        totalAmount: latestRequest.totalAmount,
        createdAt: offerTimestamp,
        scheduleDate: latestRequest.scheduleDate,
      };
    }

    const maidPhotoUrl = resolvePublicAssetUrl(req, profile?.selfieUrl || req.user.avatarUrl);

    return sendResponse(res, 200, 'Dashboard data retrieved', {
      maid: {
        name: req.user.name,
        avatarUrl: maidPhotoUrl,
        photoUrl: maidPhotoUrl,
        isAvailable: profile?.isAvailable ?? false,
        activeStatus: profile?.activeStatus ?? 'inactive',
      },
      stats: {
        jobsToday: jobsTodayCount,
        earnedToday: Math.round(earnedToday),
        rating: rating,
      },
      latestRequest: formattedRequest,
      todaySchedule: formattedSchedule,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  MY JOBS  (New / Upcoming / Completed tabs)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    My Jobs — tabs: new | upcoming | completed
 * @route   GET /api/v1/maids/my-jobs?tab=new|upcoming|completed
 * @access  Protected (Maid)
 *
 * Tab meanings (matching the UI):
 *   new       → status: pending   (Decline / Accept buttons shown)
 *   upcoming  → status: accepted  (Start Task button shown)
 *   completed → status: completed
 */
exports.getMyJobs = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tab = (req.query.tab || 'new').toLowerCase();

    const TAB_STATUS_MAP = {
      new: ['pending'],
      upcoming: ['accepted', 'ongoing'],
      completed: ['completed'],
    };

    const statuses = TAB_STATUS_MAP[tab];
    if (!statuses) {
      return sendError(
        res,
        400,
        'Invalid tab. Use: new, upcoming, or completed',
        'VALIDATION_ERROR',
      );
    }

    // Find active searching offers targeted to this maid
    const activeOffers = await Booking.find({
      status: 'searching',
      offerExpiresAt: { $gt: new Date() },
    })
      .populate('customer', 'name phone')
      .populate('service', 'name category');

    const matchingOffers = activeOffers.filter((b) => {
      if (b.bookingType === 'scheduled') {
        return b.matchingQueue?.some(
          (q) => q.maidId.toString() === userId.toString() && q.response === 'pending',
        );
      } else {
        const currentOffer = b.matchingQueue?.[b.currentQueueIndex];
        return (
          currentOffer &&
          currentOffer.maidId.toString() === userId.toString() &&
          currentOffer.response === 'pending'
        );
      }
    });

    let bookings = [];
    if (tab === 'new') {
      const pendingBookings = await Booking.find({
        maid: userId,
        status: 'pending',
      })
        .populate('customer', 'name phone')
        .populate('service', 'name category');

      bookings = [...pendingBookings, ...matchingOffers];
      bookings.sort((a, b) => b.createdAt - a.createdAt);
    } else {
      bookings = await Booking.find({
        maid: userId,
        status: { $in: statuses },
      })
        .populate('customer', 'name phone')
        .populate('service', 'name category')
        .sort(tab === 'completed' ? '-updatedAt' : 'scheduleDate');
    }

    // ── Count badges for all tabs (shown in tab bar) ─────────────────────
    const pendingCount = await Booking.countDocuments({ maid: userId, status: 'pending' });
    const newCount = pendingCount + matchingOffers.length;

    const [upcomingCount, completedCount] = await Promise.all([
      Booking.countDocuments({ maid: userId, status: { $in: ['accepted', 'ongoing'] } }),
      Booking.countDocuments({ maid: userId, status: 'completed' }),
    ]);

    // ── Format each booking for the app ─────────────────────────────────
    const fmt = (d) =>
      d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const formattedJobs = bookings.map((b) => {
      const start = b.scheduleDate;
      const durationMins = b.estimatedTime || 60;
      const end = new Date(start.getTime() + durationMins * 60000);

      const today = new Date();
      const isToday =
        start.getDate() === today.getDate() &&
        start.getMonth() === today.getMonth() &&
        start.getFullYear() === today.getFullYear();

      return {
        bookingId: b._id,
        serviceName: b.service?.name || 'Service',
        customerName: b.customer?.name || '',
        customerPhone: b.customer?.phone || '',
        address: b.address
          ? {
              full: `${b.address.houseName || ''}, ${b.address.street || ''}, ${b.address.city || ''}`.replace(
                /^,\s*|,\s*$/g,
                '',
              ),
              city: b.address.city || '',
            }
          : { full: '', city: '' },
        location:
          b.location && Number.isFinite(b.location.lat) && Number.isFinite(b.location.lng)
            ? {
                lat: b.location.lat,
                lng: b.location.lng,
              }
            : null,
        timeSlot: `${fmt(start)} – ${fmt(end)} (${isToday ? 'Today' : start.toLocaleDateString('en-IN')})`,
        totalAmount: b.totalAmount,
        status: b.status,
        // Only for 'upcoming' tab — shows "Start Task" flow
        canStart: b.status === 'accepted',
        startOtpSent: !!b.startOtp,
        isStarted: b.isStarted,
        startTime: b.startTime,
        scheduleDate: b.scheduleDate,
      };
    });

    return sendResponse(res, 200, `${tab.charAt(0).toUpperCase() + tab.slice(1)} jobs retrieved`, {
      tab,
      tabCounts: {
        new: newCount,
        upcoming: upcomingCount,
        completed: completedCount,
      },
      jobs: formattedJobs,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  ACTIVE JOB VIEW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    Get the maid's current active (ongoing) job with checklist & elapsed time
 * @route   GET /api/v1/maids/active-job
 * @access  Protected (Maid)
 *
 * Returns everything needed for the "Job in Progress" screen:
 *   - Elapsed time (seconds since startTime)
 *   - Checklist with per-task done status and overall progress badge
 *   - Extra time request (if any) — pending / approved / rejected
 *   - Price summary (original cost, extra cost, new total)
 */
exports.getActiveJob = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({
      maid: req.user.id,
      status: 'ongoing',
    })
      .populate('customer', 'name phone')
      .populate('service', 'name category');

    if (!booking) {
      return sendResponse(res, 200, 'No active job found', { activeJob: null });
    }

    // ── Elapsed time ────────────────────────────────────────────────────
    const now = new Date();
    const startTime = booking.startTime || now;
    const elapsedSecs = Math.floor((now - startTime) / 1000);

    const pad = (n) => String(n).padStart(2, '0');
    const hh = pad(Math.floor(elapsedSecs / 3600));
    const mm = pad(Math.floor((elapsedSecs % 3600) / 60));
    const ss = pad(elapsedSecs % 60);
    const elapsedDisplay = `${hh}:${mm}:${ss}`;

    // ── Checklist progress ───────────────────────────────────────────────
    const checklist = booking.checklist || [];
    const doneCount = checklist.filter((c) => c.isDone).length;
    const totalCount = checklist.length;
    const allDone = totalCount > 0 && doneCount === totalCount;

    // ── Extra time summary ───────────────────────────────────────────────
    let extraTimeSummary = null;
    if (booking.extraTimeRequest && booking.extraTimeRequest.minutes) {
      extraTimeSummary = {
        minutes: booking.extraTimeRequest.minutes,
        cost: booking.extraTimeRequest.cost,
        note: booking.extraTimeRequest.note,
        status: booking.extraTimeRequest.status, // pending | approved | rejected
      };
    }

    // ── Price summary ─────────────────────────────────────────────────────
    const approvedExtra =
      booking.extraTimeRequest?.status === 'approved' ? booking.extraTimeRequest.cost || 0 : 0;

    return sendResponse(res, 200, 'Active job retrieved', {
      activeJob: {
        bookingId: booking._id,
        serviceName: booking.service?.name || 'Service',
        customer: {
          name: booking.customer?.name || '',
          phone: booking.customer?.phone || '',
        },
        address: booking.address
          ? `${booking.address.houseName || ''}, ${booking.address.city || ''}`.replace(
              /^,\s*|,\s*$/g,
              '',
            )
          : '',
        startTime: booking.startTime,
        elapsedSeconds: elapsedSecs,
        elapsedDisplay, // "01:24:37" format for the timer
        checklist,
        progress: `${doneCount}/${totalCount} Done`,
        allDone,
        canComplete:
          allDone && (!booking.extraTimeRequest || booking.extraTimeRequest.status !== 'pending'),
        extraTimeRequest: extraTimeSummary,
        priceSummary: {
          originalCost: booking.subtotal,
          approvedExtra,
          totalAmount: booking.totalAmount,
          currency: 'INR',
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  MAID NOTIFICATION INBOX
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    Get maid's in-app notification inbox
 * @route   GET /api/v1/maids/notifications
 * @access  Protected (Maid)
 *
 * Query params:
 *   unreadOnly=true  — only return unread notifications
 *   limit            — default 20
 *
 * Notifications are sorted unread-first, then newest-first.
 * The maid app should poll this after sending an extra-time request
 * to detect the customer's decision (extra_time_approved / extra_time_rejected).
 */
exports.getMyNotifications = async (req, res, next) => {
  try {
    const { unreadOnly, limit = 20, page = 1 } = req.query;
    const limitNum = Number(limit);
    const pageNum = Number(page);
    const skip = (pageNum - 1) * limitNum;

    const filter = { recipient: req.user.id };
    if (unreadOnly === 'true') filter.isRead = false;

    const totalNotifications = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter)
      .sort({ isRead: 1, createdAt: -1 }) // unread first, then newest
      .skip(skip)
      .limit(limitNum);

    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false,
    });

    const totalPages = Math.ceil(totalNotifications / limitNum);
    const hasMore = pageNum < totalPages;

    return sendResponse(res, 200, 'Notifications retrieved', {
      unreadCount,
      notifications,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount: totalNotifications,
        hasMore,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark a single notification as read
 * @route   PATCH /api/v1/maids/notifications/:id/read
 * @access  Protected (Maid)
 */
exports.markNotificationRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { isRead: true },
      { returnDocument: 'after' },
    );

    if (!notification) {
      return sendError(res, 404, 'Notification not found', 'NOT_FOUND');
    }

    return sendResponse(res, 200, 'Notification marked as read', { notification });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark ALL notifications as read
 * @route   PATCH /api/v1/maids/notifications/read-all
 * @access  Protected (Maid)
 */
exports.markAllNotificationsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { isRead: true },
    );

    return sendResponse(res, 200, `${result.modifiedCount} notification(s) marked as read`, {
      markedRead: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  EXTRA TIME STATUS  (maid polls while waiting for customer decision)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    Get extra time request status for the maid's active job
 * @route   GET /api/v1/maids/active-job/extra-time-status
 * @access  Protected (Maid)
 *
 * The maid app polls this every few seconds after submitting an extra-time request.
 * Returns the current decision + what to show on screen.
 *
 * Possible statuses:
 *   pending   — customer hasn't decided yet    → show spinner/waiting
 *   approved  — customer approved             → show green banner, update timer
 *   rejected  — customer rejected             → show red banner, enable "Mark Complete"
 *   none      — no extra time request exists  → no pending request
 */
exports.getExtraTimeStatus = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({
      maid: req.user.id,
      status: 'ongoing',
    });

    if (!booking) {
      return sendError(res, 404, 'No active job found', 'NOT_FOUND');
    }

    const req_ = booking.extraTimeRequest;

    // No extra time request exists
    if (!req_ || !req_.minutes) {
      return sendResponse(res, 200, 'No extra time request on this job', {
        hasRequest: false,
        status: 'none',
        action: 'none',
      });
    }

    // Build the response based on decision
    const STATUS_ACTIONS = {
      pending: {
        action: 'wait',
        banner: {
          type: 'info',
          title: 'Waiting…',
          message: `Waiting for customer to respond to your ${req_.minutes}-min request.`,
        },
      },
      approved: {
        action: 'continue_job',
        banner: {
          type: 'success',
          title: '\u2705 Approved!',
          message: `Customer approved ${req_.minutes} extra minutes. \u20b9${req_.cost} added.`,
        },
      },
      rejected: {
        action: 'complete_job',
        banner: {
          type: 'error',
          title: '\u274c Rejected',
          message: 'Customer declined extra time. Please wrap up and mark the job complete.',
        },
      },
    };

    const info = STATUS_ACTIONS[req_.status] || STATUS_ACTIONS.pending;

    return sendResponse(res, 200, `Extra time request is ${req_.status}`, {
      hasRequest: true,
      status: req_.status, // pending | approved | rejected
      minutes: req_.minutes,
      cost: req_.cost,
      note: req_.note,
      action: info.action, // what the maid app should do next
      banner: info.banner, // UI banner to display
      // For approved: updated booking totals
      ...(req_.status === 'approved' && {
        priceSummary: {
          extraCost: req_.cost,
          newTotalAmount: booking.totalAmount,
          newTotalTime: booking.totalTime,
          currency: 'INR',
        },
      }),
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  REFERRAL PAGE  (/api/v1/maids/referral-info)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    Referral & Earn page data
 * @route   GET /api/v1/maids/referral-info
 * @access  Protected (Maid)
 *
 * Returns everything the "Refer & Earn" screen needs:
 *   referralCode    — maid's unique code  (e.g. "AR-200")
 *   shareLink       — deep-link/URL for WhatsApp / Copy Link
 *   stats           — referred (total invited), active (registered), earned (₹ credited)
 *   howItWorks      — ordered steps array for the "How It Works" section
 */
exports.getMaidReferral = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('referralCode referralCredits name');

    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    // Ensure referral code exists (edge case for old records)
    if (!user.referralCode) {
      user.referralCode = `AR-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      await user.save();
    }

    // ── Stats ──────────────────────────────────────────────────────────────
    // Referred: total users who used this maid's code
    const referred = await User.countDocuments({ referredBy: user.referralCode });

    // Active: users who signed up AND completed at least 1 booking
    const referredUsers = await User.find({ referredBy: user.referralCode }).select('_id name');
    const referredIds = referredUsers.map((u) => u._id);

    const Booking = require('../models/Booking');
    const distinctCustomers = await Booking.distinct('customer', {
      customer: { $in: referredIds },
      status: 'completed',
    });

    const activeCustomerIdsStr = distinctCustomers.map((id) => id.toString());
    const referredList = referredUsers.map((u) => ({
      name: u.name || 'Friend',
      joined: activeCustomerIdsStr.includes(u._id.toString()),
    }));

    const active = distinctCustomers.length;
    const earned = user.referralCredits || 0;

    // ── Share link (replace with your deep-link / app URL) ────────────────
    const baseUrl = process.env.APP_BASE_URL || 'https://zafabit.app';
    const shareLink = `${baseUrl}/join?ref=${user.referralCode}`;

    return sendResponse(res, 200, 'Referral info retrieved', {
      referralCode: user.referralCode,
      shareLink,
      shareMessage: `Join Zafabit Partners and earn money! Use my code *${user.referralCode}* when you sign up: ${shareLink}`,
      stats: {
        referred, // "3 Referred" badge
        active, // "2 Active" badge
        earned, // "₹400 Earned" badge
      },
      referredList,
      howItWorks: [
        {
          step: 1,
          title: 'Share Code',
          desc: 'Send your unique referral code to your friends and family.',
        },
        {
          step: 2,
          title: 'Friend Registers',
          desc: 'Friends sign up and use your code on their first service.',
        },
        {
          step: 3,
          title: 'Get Credited',
          desc: 'Credit added to your wallet after their service completion.',
        },
      ],
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  PROFILE PAGE  (/api/v1/maids/profile-info)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    Get Maid's full Profile page data
 * @route   GET /api/v1/maids/profile-info
 * @access  Protected (Maid)
 *
 * Returns:
 *   personal   — name, email, phone, photo
 *   stats      — rating, reviewCount, totalJobs, experience (months since joining)
 *   account    — menu items list for the Profile screen
 */
exports.getMaidProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(
      'name firstName lastName email phone referralCode createdAt',
    );
    const profile = await MaidProfile.findOne({ user: req.user.id }).select(
      'rating reviewCount selfieUrl activeStatus jobType workAreas language',
    );

    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    // Experience = months since account creation (rounded)
    const now = new Date();
    const joinedDate = user.createdAt || now;
    const monthsActive = Math.max(
      0,
      Math.round((now - joinedDate) / (1000 * 60 * 60 * 24 * 30.44)),
    );
    const experienceLabel =
      monthsActive < 1 ? 'New' : monthsActive === 1 ? '1 month' : `${monthsActive} months`;

    // Total completed jobs
    const totalJobs = await Booking.countDocuments({ maid: req.user.id, status: 'completed' });

    return sendResponse(res, 200, 'Maid profile retrieved', {
      personal: {
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        email: user.email || '',
        phone: user.phone || '',
        photoUrl: profile?.selfieUrl || null,
      },
      stats: {
        rating: profile?.rating ?? 0,
        reviewCount: profile?.reviewCount ?? 0,
        totalJobs,
        experience: experienceLabel, // e.g. "4 Exp" shown in UI
        activeStatus: profile?.activeStatus ?? 'inactive',
      },
      preferences: {
        jobType: profile?.jobType || null,
        workAreas: profile?.workAreas || [],
        language: profile?.language || 'en',
      },
      // Menu items for the Profile screen list
      menu: [
        { id: 'personal_info', label: 'Personal Information', route: '/profile/personal' },
        { id: 'referral_earn', label: 'Referral & Earn', route: '/referral' },
        { id: 'support_safety', label: 'Support & Safety', route: '/support' },
        { id: 'privacy_terms', label: 'Privacy & Terms', route: '/privacy' },
      ],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update Maid's personal information (Personal Information screen)
 * @route   PUT /api/v1/maids/profile-info
 * @access  Protected (Maid)
 *
 * Body (all optional):
 *   firstName, lastName, email, phone, language
 */
exports.updateMaidPersonalInfo = async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, language, photoUrl } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    // Update user fields
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (email !== undefined) user.email = email.toLowerCase();
    if (phone !== undefined) user.phone = phone;
    // language synced to both User and MaidProfile
    if (language !== undefined) user.language = language;

    await user.save(); // pre-save rebuilds user.name from firstName + lastName

    // Sync language and photoUrl to MaidProfile too
    const profileUpdates = {};
    if (language !== undefined) profileUpdates.language = language;
    if (photoUrl !== undefined) profileUpdates.selfieUrl = photoUrl;

    if (Object.keys(profileUpdates).length > 0) {
      await MaidProfile.findOneAndUpdate({ user: req.user.id }, profileUpdates, {
        returnDocument: 'after',
      });
    }

    return sendResponse(res, 200, 'Personal information updated', {
      name: user.name,
      email: user.email,
      phone: user.phone,
      language: user.language,
      photoUrl: photoUrl,
    });
  } catch (error) {
    next(error);
  }
};
