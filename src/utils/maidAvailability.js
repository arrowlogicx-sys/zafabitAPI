const Booking = require('../models/Booking');
const MaidProfile = require('../models/MaidProfile');
const { filterReservedMaidIds } = require('./maidOfferReservation');

const DEFAULT_RADIUS_METERS = 5000;
const EXPANDED_RADIUS_METERS = 10000;
const MAX_QUEUE_SIZE = 5;
const ONLINE_STALE_MS =
  process.env.NODE_ENV === 'development' ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
const SCHEDULED_TRAVEL_BUFFER_MINUTES = 60;
const NO_FREE_MAID_MESSAGE = 'No free maid available';

const BUSY_STATUSES = ['accepted', 'in_transit', 'arrived', 'ongoing'];
const CONFLICT_STATUSES = [
  'pending',
  'pending_payment',
  'paid_unassigned',
  'searching',
  'admin_attention',
  'accepted',
  'in_transit',
  'arrived',
  'ongoing',
];
const FINAL_STATUSES = ['cancelled', 'refunded', 'reschedule_requested', 'completed', 'failed'];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeCoordinates(input = {}) {
  const lat = Number(input.lat ?? input.latitude);
  const lng = Number(input.lng ?? input.lon ?? input.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function getDistanceMeters(origin, destination) {
  if (!origin || !destination) return Infinity;

  const R = 6371e3;
  const phi1 = (origin.lat * Math.PI) / 180;
  const phi2 = (destination.lat * Math.PI) / 180;
  const deltaPhi = ((destination.lat - origin.lat) * Math.PI) / 180;
  const deltaLambda = ((destination.lng - origin.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

function getMockEtaMinutes(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return 999;
  return Math.max(3, Math.ceil(distanceMeters / 250));
}

function getProfileCoordinates(profile) {
  const coordinates = profile.currentLocation?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    return { lng: coordinates[0], lat: coordinates[1] };
  }

  if (isFiniteNumber(profile.lastLocation?.lat) && isFiniteNumber(profile.lastLocation?.lng)) {
    return { lat: profile.lastLocation.lat, lng: profile.lastLocation.lng };
  }

  return null;
}

function getBookingWindow(options = {}) {
  const start = options.windowStart ? new Date(options.windowStart) : new Date();
  const duration = Number(options.estimatedDurationMinutes) || 60;
  const end = new Date(start.getTime() + (duration + SCHEDULED_TRAVEL_BUFFER_MINUTES) * 60000);

  return { start, end };
}

async function getConflictingMaidIds(maidIds, options = {}) {
  if (!maidIds.length) return new Set();

  const excludeBookingId = options.excludeBookingId;
  const { start, end } = getBookingWindow(options);
  const queryBase = {
    maid: { $in: maidIds },
    status: { $in: CONFLICT_STATUSES },
  };

  if (excludeBookingId) {
    queryBase._id = { $ne: excludeBookingId };
  }

  // Find all active/ongoing bookings (both instant and scheduled)
  const activeBookings = await Booking.find({
    ...queryBase,
    status: { $in: BUSY_STATUSES },
  }).select('maid scheduleDate estimatedTime totalTime bookingType createdAt');

  const conflictIds = new Set();
  for (const booking of activeBookings) {
    const bookingStart = new Date(booking.scheduleDate || booking.createdAt);
    const bookingDuration = booking.totalTime || booking.estimatedTime || 60;
    const bookingEnd = new Date(
      bookingStart.getTime() + (bookingDuration + SCHEDULED_TRAVEL_BUFFER_MINUTES) * 60000,
    );
    if (bookingStart < end && bookingEnd > start) {
      conflictIds.add(booking.maid.toString());
    }
  }

  // Also check scheduled bookings in the dispatch process
  const scheduledConflicts = await Booking.find({
    ...queryBase,
    bookingType: 'scheduled',
    status: { $nin: FINAL_STATUSES },
    scheduleDate: { $lt: end },
  }).select('maid scheduleDate estimatedTime totalTime');

  for (const booking of scheduledConflicts) {
    const bookingStart = new Date(booking.scheduleDate);
    const bookingDuration = booking.totalTime || booking.estimatedTime || 60;
    const bookingEnd = new Date(
      bookingStart.getTime() + (bookingDuration + SCHEDULED_TRAVEL_BUFFER_MINUTES) * 60000,
    );
    if (bookingStart < end && bookingEnd > start) {
      conflictIds.add(booking.maid.toString());
    }
  }

  return conflictIds;
}

async function findAvailableMaids(options) {
  const customerLocation = normalizeCoordinates(options);
  if (!customerLocation) {
    return {
      available: false,
      message: 'Customer location is required',
      count: 0,
      maids: [],
      radiusMeters: options.radiusMeters || DEFAULT_RADIUS_METERS,
    };
  }

  const radiusMeters = Number(options.radiusMeters) || DEFAULT_RADIUS_METERS;
  const limit = Number(options.limit) || MAX_QUEUE_SIZE;
  const staleCutoff = new Date(Date.now() - ONLINE_STALE_MS);
  const excludeMaidIds = new Set((options.excludeMaidIds || []).map((id) => id.toString()));

  const query = {
    activeStatus: 'active',
    isIdentityVerified: true,
    currentLocation: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [customerLocation.lng, customerLocation.lat],
        },
        $maxDistance: radiusMeters,
      },
    },
  };

  if (options.requireAvailable !== false) {
    query.isAvailable = true;
  }

  if (options.requireOnline !== false) {
    query.isOnline = true;
    query.lastLocationUpdatedAt = { $gte: staleCutoff };
  }

  const profiles = await MaidProfile.find(query)
    .populate('user', 'name phone')
    .limit(Math.max(limit * 3, 20));

  const maidIds = profiles
    .map((profile) => profile.user?._id || profile.user)
    .filter(Boolean)
    .filter((id) => !excludeMaidIds.has(id.toString()));
  const conflictingMaidIds = await getConflictingMaidIds(maidIds, {
    estimatedDurationMinutes: options.estimatedDurationMinutes,
    excludeBookingId: options.excludeBookingId,
    windowStart: options.windowStart,
  });

  const { getBatchRoadDistance } = require('./location');

  const validProfiles = profiles.filter((profile) => {
    const maidId = profile.user?._id || profile.user;
    return (
      maidId && !excludeMaidIds.has(maidId.toString()) && !conflictingMaidIds.has(maidId.toString())
    );
  });
  const reservedMaidIds = options.ignoreOfferReservations
    ? new Set()
    : await filterReservedMaidIds(
        validProfiles.map((profile) => profile.user?._id || profile.user).filter(Boolean),
        options.excludeBookingId,
      );

  const validProfilesWithLocation = [];
  const candidateOrigins = [];

  for (const profile of validProfiles) {
    const markerLocation = getProfileCoordinates(profile);
    const maidId = profile.user?._id || profile.user;
    if (markerLocation && maidId && !reservedMaidIds.has(maidId.toString())) {
      validProfilesWithLocation.push({ profile, markerLocation });
      candidateOrigins.push(markerLocation);
    }
  }

  const batchDistances = await getBatchRoadDistance(candidateOrigins, customerLocation);

  const maids = validProfilesWithLocation
    .map(({ profile, markerLocation }, index) => {
      const distData = batchDistances[index] || {
        distanceMeters: getDistanceMeters(customerLocation, markerLocation),
        durationSeconds:
          getMockEtaMinutes(getDistanceMeters(customerLocation, markerLocation)) * 60,
        source: 'haversine',
      };

      const distanceMeters = distData.distanceMeters;
      const etaMinutes = Math.max(3, Math.ceil(distData.durationSeconds / 60));

      return {
        maidId: profile.user?._id || profile.user,
        name: profile.user?.name || 'Available maid',
        rating: profile.rating || 0,
        distanceMeters,
        etaMinutes,
        location: markerLocation,
        coordinates: markerLocation ? [markerLocation.lng, markerLocation.lat] : undefined,
      };
    })
    .sort((a, b) => a.etaMinutes - b.etaMinutes || a.distanceMeters - b.distanceMeters)
    .slice(0, limit);

  return {
    available: maids.length > 0,
    message: maids.length > 0 ? 'Free maids available' : NO_FREE_MAID_MESSAGE,
    count: maids.length,
    maids,
    radiusMeters,
  };
}

module.exports = {
  DEFAULT_RADIUS_METERS,
  EXPANDED_RADIUS_METERS,
  MAX_QUEUE_SIZE,
  NO_FREE_MAID_MESSAGE,
  findAvailableMaids,
  getBookingWindow,
  getConflictingMaidIds,
  getDistanceMeters,
  normalizeCoordinates,
};
