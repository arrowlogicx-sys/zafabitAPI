const Booking = require('../models/Booking');
const MaidProfile = require('../models/MaidProfile');
const Notification = require('../models/Notification');
const {
  DEFAULT_RADIUS_METERS,
  EXPANDED_RADIUS_METERS,
  MAX_QUEUE_SIZE,
  NO_FREE_MAID_MESSAGE,
  findAvailableMaids,
  normalizeCoordinates,
} = require('./maidAvailability');
const { cancelDispatchJobs, enqueueDispatchJob, logDispatchAttempt } = require('./dispatchQueue');
const {
  DEFAULT_RESERVATION_TTL_MS,
  releaseMaidOfferReservation,
  reserveMaidOffer,
} = require('./maidOfferReservation');

const OFFER_TIMEOUT_MS = 120000;

function queueFromCandidates(candidates) {
  return candidates.map((candidate) => ({
    maidId: candidate.maidId,
    etaMinutes: candidate.etaMinutes,
    distanceMeters: candidate.distanceMeters,
    response: 'pending',
  }));
}

async function notifyOffer(booking, queueEntry, options = {}) {
  if (!queueEntry?.maidId) return;

  const expiresAt = booking.offerExpiresAt || new Date(Date.now() + OFFER_TIMEOUT_MS);

  await Notification.create({
    recipient: queueEntry.maidId,
    type: 'job_assigned',
    title: 'New instant booking offer',
    message: `Instant booking available. Please accept within ${Math.round(OFFER_TIMEOUT_MS / 1000)} seconds.`,
    meta: {
      bookingId: booking._id,
    },
  });

  await logDispatchAttempt({
    booking: booking._id,
    job: options.jobId,
    dispatchType: 'instant',
    event: 'notified',
    maid: queueEntry.maidId,
    radiusMeters: booking.searchRadiusMeters,
    message: 'Instant offer sent to maid',
    metadata: {
      etaMinutes: queueEntry.etaMinutes,
      distanceMeters: queueEntry.distanceMeters,
      expiresAt,
    },
  });

  try {
    const { getIO } = require('./socket');
    const io = getIO();
    const offerPayload = {
      type: 'instant',
      bookingId: booking._id,
      etaMinutes: queueEntry.etaMinutes,
      distanceMeters: queueEntry.distanceMeters,
      expiresAt,
    };
    io.to(`maid_${queueEntry.maidId}`).emit('new_booking_offer', offerPayload);
    io.to(`maid_${queueEntry.maidId}`).emit('booking:offer', offerPayload);
  } catch (err) {
    // Socket is optional in tests and local scripts.
  }
}

async function failDispatch(booking, reason = NO_FREE_MAID_MESSAGE, options = {}) {
  const shouldHoldAssignment =
    booking.bookingType === 'instant' &&
    booking.paymentStatus === 'paid' &&
    reason === NO_FREE_MAID_MESSAGE;

  booking.status = shouldHoldAssignment ? 'searching' : 'failed';
  booking.dispatchFailedReason = reason;
  booking.offerExpiresAt = undefined;
  booking.dispatchStartedAt = booking.dispatchStartedAt || new Date();
  const current = booking.matchingQueue?.[booking.currentQueueIndex];
  if (current?.maidId) {
    await releaseMaidOfferReservation(current.maidId, booking._id).catch(() => {});
  }
  await booking.save();
  await cancelDispatchJobs(booking._id, ['expire_instant_offer']);

  await logDispatchAttempt({
    booking: booking._id,
    job: options.jobId,
    dispatchType: 'instant',
    event: 'failed',
    message: reason,
  });

  return {
    available: false,
    message: reason,
    booking,
    assignmentState: shouldHoldAssignment ? 'pending_assignment' : 'failed',
  };
}

async function offerCurrentMaid(booking, options = {}) {
  while (booking.currentQueueIndex < (booking.matchingQueue || []).length) {
    const current = booking.matchingQueue?.[booking.currentQueueIndex];
    if (!current) {
      break;
    }

    const reservation = await reserveMaidOffer(
      current.maidId,
      booking._id,
      DEFAULT_RESERVATION_TTL_MS,
    );

    if (!reservation.reserved) {
      current.response = 'unavailable';
      current.respondedAt = new Date();
      await logDispatchAttempt({
        booking: booking._id,
        job: options.jobId,
        dispatchType: 'instant',
        event: 'rejected',
        maid: current.maidId,
        message: 'Instant offer skipped because maid is already reserved',
      });
      booking.currentQueueIndex += 1;
      continue;
    }

    current.offeredAt = new Date();
    current.response = 'pending';
    booking.offerExpiresAt = new Date(Date.now() + OFFER_TIMEOUT_MS);
    await booking.save();
    await notifyOffer(booking, current, options);
    await enqueueDispatchJob({
      bookingId: booking._id,
      type: 'expire_instant_offer',
      runAt: booking.offerExpiresAt,
      idempotencyKey: `expire_instant_offer:${booking._id}:${booking.offerExpiresAt.getTime()}`,
    });

    return {
      available: true,
      message: 'Instant dispatch started',
      booking,
      currentOffer: current,
      assignmentState: 'pending_assignment',
    };
  }

  return failDispatch(booking, NO_FREE_MAID_MESSAGE, options);
}

async function startInstantDispatch(bookingId, options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    return { available: false, message: 'Booking not found' };
  }

  if (!booking.dispatchStartedAt) {
    booking.dispatchStartedAt = new Date();
    await booking.save();
  }

  const MINUTE_MS = 60 * 1000;
  const INSTANT_SEARCH_TIMEOUT_MS = Number(process.env.INSTANT_SEARCH_TIMEOUT_MINUTES || 10) * MINUTE_MS;
  const expireUnassignedAt = new Date(booking.dispatchStartedAt.getTime() + INSTANT_SEARCH_TIMEOUT_MS);
  await enqueueDispatchJob({
    bookingId: booking._id,
    type: 'expire_unassigned_instant',
    runAt: expireUnassignedAt,
    idempotencyKey: `expire_unassigned_instant:${booking._id}:${expireUnassignedAt.getTime()}`,
  });

  const location = normalizeCoordinates(booking.location);
  if (!location) {
    return failDispatch(booking, 'Customer location is required', options);
  }

  let availability = await findAvailableMaids({
    ...location,
    estimatedDurationMinutes: booking.totalTime || booking.estimatedTime || 60,
    excludeBookingId: booking._id,
    radiusMeters: DEFAULT_RADIUS_METERS,
    limit: MAX_QUEUE_SIZE,
  });

  await logDispatchAttempt({
    booking: booking._id,
    job: options.jobId,
    dispatchType: 'instant',
    event: 'candidate_search',
    radiusMeters: DEFAULT_RADIUS_METERS,
    candidateCount: availability.count,
    candidates: availability.maids,
    message: availability.message,
  });

  if (!availability.available) {
    availability = await findAvailableMaids({
      ...location,
      estimatedDurationMinutes: booking.totalTime || booking.estimatedTime || 60,
      excludeBookingId: booking._id,
      radiusMeters: EXPANDED_RADIUS_METERS,
      limit: MAX_QUEUE_SIZE,
    });

    await logDispatchAttempt({
      booking: booking._id,
      job: options.jobId,
      dispatchType: 'instant',
      event: 'expanded',
      radiusMeters: EXPANDED_RADIUS_METERS,
      candidateCount: availability.count,
      candidates: availability.maids,
      message: availability.message,
    });
  }

  if (!availability.available) {
    return failDispatch(booking, NO_FREE_MAID_MESSAGE, options);
  }

  booking.matchingQueue = queueFromCandidates(availability.maids);
  booking.currentQueueIndex = 0;
  booking.searchRadiusMeters = availability.radiusMeters;
  booking.dispatchStartedAt = new Date();
  booking.dispatchFailedReason = undefined;
  booking.status = 'searching';
  booking.paymentStatus = 'paid';

  return offerCurrentMaid(booking, options);
}

async function expandOrFail(booking, options = {}) {
  const location = normalizeCoordinates(booking.location);
  const alreadyTried = (booking.matchingQueue || []).map((entry) => entry.maidId).filter(Boolean);

  if (booking.searchRadiusMeters < EXPANDED_RADIUS_METERS && location) {
    const availability = await findAvailableMaids({
      ...location,
      estimatedDurationMinutes: booking.totalTime || booking.estimatedTime || 60,
      excludeBookingId: booking._id,
      excludeMaidIds: alreadyTried,
      radiusMeters: EXPANDED_RADIUS_METERS,
      limit: MAX_QUEUE_SIZE,
    });

    if (availability.available) {
      booking.matchingQueue = queueFromCandidates(availability.maids);
      booking.currentQueueIndex = 0;
      booking.searchRadiusMeters = EXPANDED_RADIUS_METERS;
      booking.status = 'searching';
      await logDispatchAttempt({
        booking: booking._id,
        job: options.jobId,
        dispatchType: 'instant',
        event: 'expanded',
        radiusMeters: EXPANDED_RADIUS_METERS,
        candidateCount: availability.count,
        candidates: availability.maids,
        message: availability.message,
      });
      return offerCurrentMaid(booking, options);
    }
  }

  return failDispatch(booking, NO_FREE_MAID_MESSAGE, options);
}

async function advanceDispatchQueue(bookingId, previousResponse = 'rejected', options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    return { available: false, message: 'Booking not found' };
  }

  const current = booking.matchingQueue?.[booking.currentQueueIndex];
  if (current && current.response === 'pending') {
    current.response = previousResponse;
    current.respondedAt = new Date();
    await releaseMaidOfferReservation(current.maidId, booking._id).catch(() => {});
    try {
      const { getIO } = require('./socket');
      const io = getIO();
      io.to(`maid_${current.maidId}`).emit('booking:offer_expired', { bookingId: booking._id });
    } catch (err) {}
    await logDispatchAttempt({
      booking: booking._id,
      job: options.jobId,
      dispatchType: 'instant',
      event: previousResponse === 'timeout' ? 'timeout' : 'rejected',
      maid: current.maidId,
      message: `Instant offer marked ${previousResponse}`,
    });
  }

  let nextIndex = booking.currentQueueIndex + 1;
  while (nextIndex < (booking.matchingQueue || []).length) {
    const nextOffer = booking.matchingQueue[nextIndex];
    const profile = await MaidProfile.findOne({
      user: nextOffer.maidId,
      activeStatus: 'active',
      isAvailable: true,
      isOnline: true,
    });

    if (profile) {
      booking.currentQueueIndex = nextIndex;
      return offerCurrentMaid(booking, options);
    }

    nextOffer.response = 'skipped';
    nextOffer.respondedAt = new Date();
    nextIndex += 1;
  }

  return expandOrFail(booking, options);
}

async function expireCurrentOffer(bookingId, options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking || booking.status !== 'searching' || !booking.offerExpiresAt) {
    return { available: false, message: 'No active offer' };
  }

  if (new Date(booking.offerExpiresAt).getTime() > Date.now()) {
    return { available: true, message: 'Offer is still active', booking };
  }

  return advanceDispatchQueue(booking._id, 'timeout', options);
}

async function acceptCurrentOffer(bookingId, maidId, options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    return { accepted: false, statusCode: 404, message: 'Booking not found' };
  }

  if (booking.status !== 'searching') {
    return { accepted: false, statusCode: 400, message: 'Booking is not searching for a maid' };
  }

  if (booking.offerExpiresAt && new Date(booking.offerExpiresAt).getTime() <= Date.now()) {
    await advanceDispatchQueue(booking._id, 'timeout', options);
    return { accepted: false, statusCode: 409, message: 'Offer expired' };
  }

  const current = booking.matchingQueue?.[booking.currentQueueIndex];
  if (!current || current.maidId.toString() !== maidId.toString()) {
    return {
      accepted: false,
      statusCode: 403,
      message: 'This maid is not the current booking offer target',
    };
  }

  const profile = await MaidProfile.findOneAndUpdate(
    {
      user: maidId,
      activeStatus: 'active',
      isAvailable: true,
      isOnline: true,
    },
    { $set: { isAvailable: false } },
    { returnDocument: 'after' },
  );

  if (!profile) {
    await releaseMaidOfferReservation(maidId, booking._id).catch(() => {});
    const advanced = await advanceDispatchQueue(booking._id, 'unavailable', options);
    return {
      accepted: false,
      statusCode: advanced.available ? 409 : 200,
      message: advanced.available
        ? 'Maid is not free. Offer moved to next maid.'
        : NO_FREE_MAID_MESSAGE,
      dispatch: advanced,
    };
  }

  current.response = 'accepted';
  current.respondedAt = new Date();
  booking.maid = maidId;
  booking.status = 'accepted';
  booking.offerExpiresAt = undefined;
  booking.startOtp = Math.floor(100000 + Math.random() * 900000).toString();
  await booking.save();
  await releaseMaidOfferReservation(maidId, booking._id).catch(() => {});
  await cancelDispatchJobs(booking._id, ['expire_instant_offer', 'expire_unassigned_instant']);

  await logDispatchAttempt({
    booking: booking._id,
    job: options.jobId,
    dispatchType: 'instant',
    event: 'accepted',
    maid: maidId,
    message: 'Instant booking accepted',
  });

  return { accepted: true, statusCode: 200, message: 'Booking accepted successfully', booking };
}

async function expireUnassignedInstant(bookingId, options = {}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) return { success: false, message: 'Booking not found' };

  if (booking.bookingType !== 'instant') {
    return { success: false, message: 'Not an instant booking' };
  }

  const isUnassigned = ['pending', 'paid_unassigned', 'searching', 'admin_attention'].includes(
    booking.status,
  );
  if (!isUnassigned) {
    return {
      success: true,
      message: `Booking is already resolved (status: ${booking.status})`,
    };
  }

  const reason = 'No maid accepted the instant booking';
  const { transitionBooking } = require('./bookingState');
  const transition = await transitionBooking(booking._id, {
    from: ['pending', 'paid_unassigned', 'searching', 'admin_attention'],
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

  const cancelledBooking = transition.booking || booking;

  await cancelDispatchJobs(cancelledBooking._id, [
    'expire_instant_offer',
    'expire_unassigned_instant',
  ]);

  const { refundPaymentForBooking } = require('./paymentSettlement');
  await refundPaymentForBooking(cancelledBooking._id, {
    amount: cancelledBooking.totalAmount,
    reason,
  });

  await Notification.create({
    recipient: cancelledBooking.customer,
    type: 'general',
    title: 'Booking cancelled',
    message: 'No maid accepted your instant booking request, so it has been cancelled.',
    meta: { bookingId: cancelledBooking._id },
  });

  await logDispatchAttempt({
    booking: cancelledBooking._id,
    job: options.jobId,
    dispatchType: 'instant',
    event: 'cancelled',
    message: reason,
  });

  return {
    success: true,
    available: false,
    message: reason,
    booking: cancelledBooking,
    assignmentState: 'cancelled',
  };
}

module.exports = {
  acceptCurrentOffer,
  advanceDispatchQueue,
  expireCurrentOffer,
  startInstantDispatch,
  expireUnassignedInstant,
};
