const Booking = require('../models/Booking');
const MaidProfile = require('../models/MaidProfile');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { transitionBooking } = require('./bookingState');
const { refundPaymentForBooking } = require('./paymentSettlement');
const {
  DEFAULT_RADIUS_METERS,
  EXPANDED_RADIUS_METERS,
  MAX_QUEUE_SIZE,
  NO_FREE_MAID_MESSAGE,
  findAvailableMaids,
  getConflictingMaidIds,
  normalizeCoordinates,
} = require('./maidAvailability');
const { cancelDispatchJobs, enqueueDispatchJob, logDispatchAttempt } = require('./dispatchQueue');

const MINUTE_MS = 60 * 1000;
const SCHEDULED_BROADCAST_TIMEOUT_MS =
  Number(process.env.SCHEDULED_BROADCAST_TIMEOUT_MINUTES || 30) * MINUTE_MS;
const SCHEDULED_URGENT_WINDOW_MS =
  Number(process.env.SCHEDULED_URGENT_WINDOW_MINUTES || 180) * MINUTE_MS;
const SCHEDULED_DISPATCH_LEAD_MS =
  Number(process.env.SCHEDULED_DISPATCH_LEAD_MINUTES || 90) * MINUTE_MS;
const SCHEDULED_ADMIN_ATTENTION_LEAD_MS =
  Number(process.env.SCHEDULED_ADMIN_ATTENTION_LEAD_MINUTES || 45) * MINUTE_MS;

function getScheduledTiming(booking, now = new Date()) {
  const scheduleAt = booking.scheduleDate ? new Date(booking.scheduleDate) : now;
  const scheduleTime = Number.isNaN(scheduleAt.getTime()) ? now.getTime() : scheduleAt.getTime();
  const msUntilJob = scheduleTime - now.getTime();
  const retryAt = new Date(scheduleTime - SCHEDULED_DISPATCH_LEAD_MS);
  const adminAttentionAt = new Date(scheduleTime - SCHEDULED_ADMIN_ATTENTION_LEAD_MS);

  return {
    msUntilJob,
    isPlannedWindow: msUntilJob > SCHEDULED_URGENT_WINDOW_MS,
    retryAt,
    adminAttentionAt,
  };
}

function getDispatchMode(booking, options = {}) {
  if (options.mode) return options.mode;
  return getScheduledTiming(booking).isPlannedWindow ? 'planned' : 'urgent';
}

async function notifyOperationsAdmins(booking, options = {}) {
  const admins = await User.find({
    role: 'admin',
    $or: [
      { adminRole: { $in: ['super_admin', 'operations_admin'] } },
      { adminRole: { $exists: false } },
      { adminRole: null },
    ],
  }).select('_id');

  if (!admins.length) return 0;

  const scheduleStr = booking.scheduleDate
    ? new Date(booking.scheduleDate).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      })
    : 'the scheduled time';

  const alertType = options.final
    ? 'scheduled_dispatch_failed'
    : 'scheduled_first_broadcast_failed';
  await Promise.all(
    admins.map((admin) =>
      Notification.updateOne(
        {
          recipient: admin._id,
          'meta.bookingId': booking._id,
          'meta.alertType': alertType,
        },
        {
          $setOnInsert: {
            recipient: admin._id,
            type: 'general',
            title: options.final
              ? 'Urgent booking needs manual assignment'
              : 'Urgent booking: first broadcast unanswered',
            message: options.final
              ? `No maid accepted the urgent booking for ${scheduleStr}. Assign a maid immediately.`
              : `The first maid broadcast for ${scheduleStr} received no acceptance. The 10 km search is continuing; review the booking now.`,
            isRead: false,
            meta: {
              bookingId: booking._id,
              alertType,
              urgency: options.final ? 'critical' : 'urgent',
              scheduleDate: booking.scheduleDate,
              actionView: 'scheduled_operations',
            },
          },
        },
        { upsert: true },
      ),
    ),
  );

  try {
    const { getIO } = require('./socket');
    const io = getIO();
    admins.forEach((admin) =>
      io.to(`user_${admin._id}`).emit('admin:notification', {
        bookingId: booking._id,
        title: options.final
          ? 'Urgent booking needs manual assignment'
          : 'Urgent booking: first broadcast unanswered',
        urgency: options.final ? 'critical' : 'urgent',
      }),
    );
  } catch {
    // In-app inbox remains the source of truth when sockets are unavailable.
  }

  return admins.length;
}

async function enqueueScheduledRetry(booking, options = {}) {
  const { retryAt } = getScheduledTiming(booking);
  if (retryAt.getTime() <= Date.now() + MINUTE_MS) {
    return null;
  }

  return enqueueDispatchJob({
    bookingId: booking._id,
    type: 'start_scheduled',
    runAt: retryAt,
    payload: {
      mode: 'urgent',
      finalAttempt: true,
    },
    idempotencyKey: `scheduled_retry:${booking._id}:${retryAt.getTime()}`,
  });
}

async function markScheduledUnassigned(booking, reason, options = {}) {
  const retryJob = await enqueueScheduledRetry(booking, options);
  await cancelDispatchJobs(booking._id, ['expire_scheduled_broadcast']);

  const transition = await transitionBooking(booking._id, {
    from: ['pending', 'paid_unassigned', 'searching', 'admin_attention'],
    to: 'paid_unassigned',
    note: reason,
    set: {
      paymentStatus: 'paid',
      dispatchFailedReason: reason,
      currentQueueIndex: 0,
    },
    unset: {
      offerExpiresAt: '',
    },
    allowSameStatus: true,
  });
  const heldBooking = transition.booking || booking;

  await Notification.create({
    recipient: heldBooking.customer,
    type: 'general',
    title: 'Scheduled booking confirmed',
    message:
      'We are arranging a maid for your selected time and will retry before the service starts.',
    meta: { bookingId: heldBooking._id, retryAt: retryJob?.runAt },
  });

  await logDispatchAttempt({
    booking: heldBooking._id,
    job: options.jobId,
    dispatchType: 'scheduled',
    event: 'deferred',
    message: reason,
    metadata: { retryAt: retryJob?.runAt },
  });

  return {
    success: true,
    available: false,
    message: 'Scheduled booking confirmed. We are arranging a maid for your selected time.',
    booking: heldBooking,
    assignmentState: 'paid_unassigned',
    retryAt: retryJob?.runAt,
  };
}

async function markScheduledAdminAttention(booking, reason, options = {}) {
  await cancelDispatchJobs(booking._id, ['expire_scheduled_broadcast']);

  const transition = await transitionBooking(booking._id, {
    from: ['pending', 'paid_unassigned', 'searching', 'admin_attention'],
    to: 'admin_attention',
    note: reason,
    set: {
      paymentStatus: 'paid',
      dispatchFailedReason: reason,
      currentQueueIndex: 0,
    },
    unset: {
      offerExpiresAt: '',
    },
    allowSameStatus: true,
  });
  const attentionBooking = transition.booking || booking;

  await notifyOperationsAdmins(attentionBooking, { final: true });

  await Notification.create({
    recipient: attentionBooking.customer,
    type: 'general',
    title: 'Maid assignment in progress',
    message: 'We need a little more time to assign a maid. Our operations team has been alerted.',
    meta: { bookingId: attentionBooking._id },
  });

  await logDispatchAttempt({
    booking: attentionBooking._id,
    job: options.jobId,
    dispatchType: 'scheduled',
    event: 'admin_attention',
    message: reason,
  });

  return {
    success: true,
    available: false,
    message: 'No maid accepted automatically. Operations team attention required.',
    booking: attentionBooking,
    assignmentState: 'admin_attention',
  };
}

async function startBroadcastDispatch(bookingId, options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) return { success: false, message: 'Booking not found' };

  if (booking.bookingType !== 'scheduled') {
    return { success: false, message: 'Not a scheduled booking' };
  }

  const canStartBroadcast =
    ['pending', 'paid_unassigned', 'admin_attention'].includes(booking.status) ||
    (booking.status === 'searching' && Array.isArray(options.excludeMaidIds));
  if (!canStartBroadcast) {
    return { success: false, message: `Booking already in status: ${booking.status}` };
  }
  if (booking.paymentStatus !== 'paid') {
    return { success: false, message: 'Booking not paid yet' };
  }

  let radius = options.radiusMeters || DEFAULT_RADIUS_METERS;
  const broadcastTimeoutMs = options.broadcastTimeoutMs || SCHEDULED_BROADCAST_TIMEOUT_MS;
  const excludedMaidIds = options.excludeMaidIds || [];
  const dispatchMode = getDispatchMode(booking, options);
  let availability = await getScheduledBroadcastAvailability(booking, radius, excludedMaidIds);

  await logDispatchAttempt({
    booking: booking._id,
    job: options.jobId,
    dispatchType: 'scheduled',
    event: excludedMaidIds.length ? 'expanded' : 'candidate_search',
    radiusMeters: radius,
    candidateCount: availability.count,
    candidates: availability.maids,
    message: availability.message,
  });

  if (!availability.available && radius < EXPANDED_RADIUS_METERS) {
    radius = EXPANDED_RADIUS_METERS;
    availability = await getScheduledBroadcastAvailability(booking, radius, excludedMaidIds);
    await logDispatchAttempt({
      booking: booking._id,
      job: options.jobId,
      dispatchType: 'scheduled',
      event: 'expanded',
      radiusMeters: radius,
      candidateCount: availability.count,
      candidates: availability.maids,
      message: availability.message,
    });
  }

  if (!availability.available) {
    const reason = 'No eligible maids accepted or matched for this scheduled slot';
    return dispatchMode === 'planned' && !options.finalAttempt
      ? markScheduledUnassigned(booking, reason, options)
      : markScheduledAdminAttention(booking, reason, options);
  }

  booking.matchingQueue = availability.maids.map((m) => ({
    maidId: m.maidId,
    etaMinutes: m.etaMinutes,
    distanceMeters: m.distanceMeters,
    response: 'pending',
    offeredAt: new Date(),
  }));
  booking.currentQueueIndex = 0;
  booking.searchRadiusMeters = radius;
  booking.dispatchStartedAt = new Date();
  booking.dispatchFailedReason = undefined;
  booking.offerExpiresAt = new Date(Date.now() + broadcastTimeoutMs);
  const transition = await transitionBooking(booking._id, {
    from: ['pending', 'paid_unassigned', 'admin_attention', 'searching'],
    to: 'searching',
    note: excludedMaidIds.length
      ? 'Expanded scheduled broadcast'
      : dispatchMode === 'planned'
        ? 'Planned scheduled broadcast started'
        : 'Urgent scheduled broadcast started',
    set: {
      matchingQueue: booking.matchingQueue,
      currentQueueIndex: booking.currentQueueIndex,
      searchRadiusMeters: booking.searchRadiusMeters,
      dispatchStartedAt: booking.dispatchStartedAt,
      dispatchFailedReason: undefined,
      offerExpiresAt: booking.offerExpiresAt,
    },
    allowSameStatus: true,
  });
  if (!transition.transitioned) {
    return { success: false, message: transition.message };
  }
  const activeBooking = transition.booking;

  const io = (() => {
    try {
      return require('./socket').getIO();
    } catch {
      return null;
    }
  })();

  const scheduleStr = activeBooking.scheduleDate
    ? new Date(activeBooking.scheduleDate).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      })
    : 'scheduled';

  const notifyPromises = availability.maids.map(async (maid) => {
    try {
      await Notification.create({
        recipient: maid.maidId,
        type: 'job_offer_broadcast',
        title: 'New Scheduled Booking Offer',
        message: `Scheduled cleaning at ${scheduleStr}. ₹${activeBooking.totalAmount}. First to accept gets the job!`,
        meta: {
          bookingId: activeBooking._id,
          distanceMeters: maid.distanceMeters,
          etaMinutes: maid.etaMinutes,
        },
      });

      await logDispatchAttempt({
        booking: activeBooking._id,
        job: options.jobId,
        dispatchType: 'scheduled',
        event: 'notified',
        maid: maid.maidId,
        radiusMeters: radius,
        message: 'Scheduled broadcast offer sent to maid',
        metadata: {
          etaMinutes: maid.etaMinutes,
          distanceMeters: maid.distanceMeters,
          expiresAt: activeBooking.offerExpiresAt,
          dispatchMode,
        },
      });

      if (io) {
        const offerPayload = {
          type: 'broadcast',
          bookingId: activeBooking._id,
          scheduleDate: activeBooking.scheduleDate,
          amount: activeBooking.totalAmount,
          distanceMeters: maid.distanceMeters,
          etaMinutes: maid.etaMinutes,
          expiresAt: activeBooking.offerExpiresAt,
          dispatchMode,
          message:
            dispatchMode === 'planned'
              ? `Scheduled cleaning at ${scheduleStr}. Accept to reserve this job.`
              : `Scheduled cleaning at ${scheduleStr}. First to accept wins!`,
        };
        io.to(`maid_${maid.maidId}`).emit('new_booking_offer', offerPayload);
        io.to(`maid_${maid.maidId}`).emit('booking:offer', offerPayload);
      }
    } catch (err) {
      console.error(`Broadcast notify failed for maid ${maid.maidId}:`, err.message);
    }
  });

  await Promise.allSettled(notifyPromises);
  await enqueueDispatchJob({
    bookingId: activeBooking._id,
    type: 'expire_scheduled_broadcast',
    runAt: activeBooking.offerExpiresAt,
    idempotencyKey: `expire_scheduled_broadcast:${activeBooking._id}:${activeBooking.offerExpiresAt.getTime()}`,
  });

  // Enqueue automatic timeout refund job to run 15 minutes after the scheduled start time
  const scheduleTime = new Date(activeBooking.scheduleDate).getTime();
  const expireUnassignedAt = new Date(scheduleTime + 15 * 60 * 1000); // 15 minutes after start time
  await enqueueDispatchJob({
    bookingId: activeBooking._id,
    type: 'expire_unassigned_scheduled',
    runAt: expireUnassignedAt,
    idempotencyKey: `expire_unassigned_scheduled:${activeBooking._id}:${expireUnassignedAt.getTime()}`,
  });

  return {
    success: true,
    available: true,
    message: `Broadcast sent to ${availability.maids.length} maids`,
    booking: activeBooking,
    candidateCount: availability.maids.length,
    expiresAt: activeBooking.offerExpiresAt,
    assignmentState: 'broadcast_sent',
    dispatchMode,
  };
}

async function getScheduledBroadcastAvailability(booking, radiusMeters, excludeMaidIds = []) {
  const location = normalizeCoordinates(booking.location);
  if (!location) {
    return {
      available: false,
      message: 'No customer location on booking',
      count: 0,
      maids: [],
      radiusMeters,
    };
  }

  return findAvailableMaids({
    ...location,
    estimatedDurationMinutes: booking.totalTime || booking.estimatedTime || 60,
    excludeBookingId: booking._id,
    excludeMaidIds,
    windowStart: booking.scheduleDate,
    radiusMeters,
    limit: MAX_QUEUE_SIZE,
    requireAvailable: false,
    requireOnline: false,
    ignoreOfferReservations: true,
  });
}

async function refundScheduledBooking(booking, reason = NO_FREE_MAID_MESSAGE, options = {}) {
  const transition = await transitionBooking(booking._id, {
    from: ['pending', 'paid_unassigned', 'searching', 'admin_attention', 'accepted'],
    to: 'cancelled',
    note: reason,
    set: {
      paymentStatus: 'refunded',
      dispatchFailedReason: reason,
      dispatchStartedAt: booking.dispatchStartedAt || new Date(),
    },
    unset: {
      offerExpiresAt: '',
    },
    allowSameStatus: true,
  });
  const refundedBooking = transition.booking || booking;
  await cancelDispatchJobs(refundedBooking._id, [
    'expire_scheduled_broadcast',
    'start_scheduled',
    'expire_unassigned_scheduled',
  ]);

  await refundPaymentForBooking(refundedBooking._id, {
    amount: refundedBooking.totalAmount,
    reason,
  });

  await Notification.create({
    recipient: refundedBooking.customer,
    type: 'general',
    title: 'Booking cancelled',
    message: 'No maid accepted your scheduled booking, so the booking has been cancelled.',
    meta: { bookingId: refundedBooking._id },
  });

  await logDispatchAttempt({
    booking: refundedBooking._id,
    job: options.jobId,
    dispatchType: 'scheduled',
    event: 'cancelled',
    message: reason,
  });

  return {
    success: false,
    available: false,
    message: reason,
    booking: refundedBooking,
    assignmentState: 'cancelled',
  };
}

async function resolveUnacceptedScheduledBroadcast(booking, options = {}) {
  const triedMaidIds = (booking.matchingQueue || []).map((entry) => entry.maidId).filter(Boolean);

  const dispatchMode = getDispatchMode(booking, options);
  const isFirstBroadcast =
    (booking.searchRadiusMeters || DEFAULT_RADIUS_METERS) < EXPANDED_RADIUS_METERS;
  if (dispatchMode === 'urgent' && isFirstBroadcast) {
    await notifyOperationsAdmins(booking, { final: false });
  }

  if (isFirstBroadcast) {
    const expanded = await startBroadcastDispatch(booking._id, {
      radiusMeters: EXPANDED_RADIUS_METERS,
      excludeMaidIds: triedMaidIds,
      broadcastTimeoutMs: SCHEDULED_BROADCAST_TIMEOUT_MS,
      mode: dispatchMode,
      finalAttempt: options.finalAttempt,
      jobId: options.jobId,
    });

    if (expanded.success) return expanded;
  }

  const reason = 'All notified maids rejected or timed out for this scheduled slot';
  return dispatchMode === 'planned' && !options.finalAttempt
    ? markScheduledUnassigned(booking, reason, options)
    : markScheduledAdminAttention(booking, reason, options);
}

async function declineBroadcastOffer(bookingId, maidId, response = 'rejected', options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) return { success: false, statusCode: 404, message: 'Booking not found' };
  if (booking.bookingType !== 'scheduled' || booking.status !== 'searching') {
    return {
      success: false,
      statusCode: 400,
      message: 'Booking is not open for scheduled broadcast response',
    };
  }

  const offer = (booking.matchingQueue || []).find(
    (entry) => entry.maidId?.toString() === maidId.toString(),
  );
  if (!offer) {
    return {
      success: false,
      statusCode: 403,
      message: 'This maid is not in the scheduled booking candidates list',
    };
  }
  if (offer.response !== 'pending') {
    return { success: true, message: 'Response already recorded', booking };
  }

  offer.response = response;
  offer.respondedAt = new Date();

  await logDispatchAttempt({
    booking: booking._id,
    job: options.jobId,
    dispatchType: 'scheduled',
    event: response === 'timeout' ? 'timeout' : 'rejected',
    maid: maidId,
    message: `Scheduled broadcast offer marked ${response}`,
  });

  const hasPendingOffers = booking.matchingQueue.some((entry) => entry.response === 'pending');
  await booking.save();

  if (hasPendingOffers) {
    return {
      success: true,
      available: true,
      message: 'Booking declined. Waiting for other maids.',
      booking,
    };
  }

  return resolveUnacceptedScheduledBroadcast(booking, options);
}

async function expireScheduledBroadcast(bookingId, options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking || booking.bookingType !== 'scheduled' || booking.status !== 'searching') {
    return { success: false, message: 'No active scheduled broadcast' };
  }

  for (const offer of booking.matchingQueue || []) {
    if (offer.response === 'pending') {
      offer.response = 'timeout';
      offer.respondedAt = new Date();
      await logDispatchAttempt({
        booking: booking._id,
        job: options.jobId,
        dispatchType: 'scheduled',
        event: 'timeout',
        maid: offer.maidId,
        message: 'Scheduled broadcast offer timed out',
      });
    }
  }
  await booking.save();

  return resolveUnacceptedScheduledBroadcast(booking, options);
}

async function notifyBroadcastLosers(booking, winnerMaidId) {
  const loserIds = (booking.matchingQueue || [])
    .filter((entry) => entry.maidId && entry.maidId.toString() !== winnerMaidId.toString())
    .map((entry) => entry.maidId);

  await Promise.allSettled(
    loserIds.map((maidId) =>
      Notification.create({
        recipient: maidId,
        type: 'job_offer_taken',
        title: 'Booking taken',
        message: 'Sorry, this scheduled booking was taken by another maid.',
        meta: { bookingId: booking._id },
      }),
    ),
  );

  try {
    const { getIO } = require('./socket');
    const io = getIO();
    loserIds.forEach((maidId) => {
      io.to(`maid_${maidId}`).emit('booking_offer_taken', {
        bookingId: booking._id,
        message: 'Sorry, this booking was taken.',
      });
      io.to(`maid_${maidId}`).emit('booking:taken', {
        bookingId: booking._id,
        message: 'Sorry, this booking was taken.',
      });
    });
  } catch (err) {
    // Socket is optional in tests and local scripts.
  }
}

async function acceptBroadcastOffer(bookingId, maidId, options = {}) {
  const profile = await MaidProfile.findOne({
    user: maidId,
    activeStatus: 'active',
    isIdentityVerified: true,
  });

  if (!profile) {
    return declineBroadcastOffer(bookingId, maidId, 'unavailable');
  }

  const booking = await Booking.findById(bookingId).select('scheduleDate estimatedTime totalTime');
  if (!booking) return { accepted: false, statusCode: 404, message: 'Booking not found' };

  const conflictingMaidIds = await getConflictingMaidIds([maidId], {
    excludeBookingId: bookingId,
    estimatedDurationMinutes: booking.totalTime || booking.estimatedTime || 60,
    windowStart: booking.scheduleDate,
  });
  if (conflictingMaidIds.has(maidId.toString())) {
    return declineBroadcastOffer(bookingId, maidId, 'unavailable');
  }

  const now = new Date();
  const startOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const lockedBooking = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      bookingType: 'scheduled',
      status: 'searching',
      paymentStatus: 'paid',
      offerExpiresAt: { $gt: now },
      matchingQueue: {
        $elemMatch: {
          maidId,
          response: 'pending',
        },
      },
    },
    {
      $set: {
        maid: maidId,
        status: 'accepted',
        startOtp,
      },
      $push: {
        statusHistory: {
          status: 'accepted',
          timestamp: now,
          updatedBy: maidId,
          note: 'Accepted by scheduled broadcast candidate',
        },
      },
      $unset: {
        offerExpiresAt: '',
      },
    },
    { returnDocument: 'after' },
  );

  if (!lockedBooking) {
    return { accepted: false, statusCode: 409, message: 'Sorry, this booking was taken.' };
  }

  for (const offer of lockedBooking.matchingQueue || []) {
    if (offer.maidId?.toString() === maidId.toString()) {
      offer.response = 'accepted';
      offer.respondedAt = now;
    } else if (offer.response === 'pending') {
      offer.response = 'skipped';
      offer.respondedAt = now;
    }
  }
  await lockedBooking.save();
  await cancelDispatchJobs(lockedBooking._id, [
    'expire_scheduled_broadcast',
    'expire_unassigned_scheduled',
  ]);
  await notifyBroadcastLosers(lockedBooking, maidId);

  await Notification.create({
    recipient: lockedBooking.customer,
    type: 'job_assigned',
    title: 'Maid found',
    message: 'Maid found for your scheduled booking.',
    meta: { bookingId: lockedBooking._id },
  });

  await logDispatchAttempt({
    booking: lockedBooking._id,
    job: options.jobId,
    dispatchType: 'scheduled',
    event: 'accepted',
    maid: maidId,
    message: 'Scheduled booking accepted',
  });

  return {
    accepted: true,
    statusCode: 200,
    message: 'Scheduled booking accepted successfully',
    booking: lockedBooking,
  };
}
async function expireUnassignedScheduled(bookingId, options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) return { success: false, message: 'Booking not found' };

  if (booking.bookingType !== 'scheduled') {
    return { success: false, message: 'Not a scheduled booking' };
  }

  // Only run refund if booking is still unassigned/searching after schedule date
  const isUnassigned = ['pending', 'paid_unassigned', 'searching', 'admin_attention'].includes(
    booking.status,
  );
  if (!isUnassigned) {
    return {
      success: true,
      message: `Booking is already resolved (status: ${booking.status})`,
    };
  }

  const reason = 'No maid assigned to this scheduled booking by 15 minutes past the start time';
  return refundScheduledBooking(booking, reason, options);
}

module.exports = {
  SCHEDULED_BROADCAST_TIMEOUT_MS,
  acceptBroadcastOffer,
  declineBroadcastOffer,
  expireScheduledBroadcast,
  startBroadcastDispatch,
  expireUnassignedScheduled,
  refundScheduledBooking,
};
