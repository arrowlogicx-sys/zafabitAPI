const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./authToken');
const { getTrackingMetrics } = require('./location');
const User = require('../models/User');
const MaidProfile = require('../models/MaidProfile');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createNamedRedisClient, isRedisConfigured } = require('./redisClient');
const { markMaidOnline, refreshMaidPresence, scheduleOfflineCheck } = require('./presence');

let io;
// Simple in-memory cache to reduce DB hits for destination coordinates
const destinationCache = new Map();

const init = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  attachRedisAdapter(io).catch((error) => {
    console.error('[SOCKET] Redis adapter disabled:', error.message);
  });

  io.on('connection', async (socket) => {
    socket.user = await authenticateSocketUser(socket);
    console.log(`🔌 New Connection: ${socket.id}`);

    if (socket.user?.role === 'maid') {
      const maidId = socket.user._id.toString();
      socket.join(`maid_${maidId}`);
      await markMaidOnline(maidId, { socketId: socket.id });
      socket.emit('maid:presence_ack', {
        status: 'online',
        maidId,
      });
    }

    // Join a specific booking room for tracking
    socket.on('join_booking', async (bookingId) => {
      socket.join(bookingId);
      console.log(`👤 User joined booking room: ${bookingId}`);

      // CATCH-UP LOGIC: Send last known location immediately
      try {
        const Booking = require('../models/Booking');
        const booking = await Booking.findById(bookingId).populate('maid', 'name phone');
        if (!booking) return;

        const destination = {
          lat: booking.location?.lat,
          lng: booking.location?.lng,
          isNearbySent: booking.isNearbyNotificationSent,
        };

        if (booking.location) {
          const cachedDestination = destinationCache.get(bookingId) || {};
          destinationCache.set(bookingId, {
            ...cachedDestination,
            ...destination,
          });
        }

        if (
          Number.isFinite(booking.lastMaidLocation?.lat) &&
          Number.isFinite(booking.lastMaidLocation?.lng)
        ) {
          const cachedDestination = destinationCache.get(bookingId) || destination;
          const metrics = await getTrackingMetrics({
            origin: {
              lat: booking.lastMaidLocation.lat,
              lng: booking.lastMaidLocation.lng,
            },
            destination: cachedDestination,
            cacheEntry: cachedDestination,
          });
          destinationCache.set(bookingId, {
            ...cachedDestination,
            ...metrics.cacheEntry,
            isNearbySent: booking.isNearbyNotificationSent,
          });

          socket.emit('maid_location_changed', {
            lat: booking.lastMaidLocation.lat,
            lng: booking.lastMaidLocation.lng,
            distance: metrics.distanceMeters,
            etaMinutes: metrics.etaMinutes,
            nextUpdateIn: metrics.nextInterval,
            distanceSource: metrics.source,
            routePolyline: metrics.routePolyline,
            routeSource: metrics.routeSource,
            lastSeen: booking.lastSeenAt,
            isNearby: booking.isNearbyNotificationSent,
            status: 'reconnected',
            destinationLocation: {
              lat: destination.lat,
              lng: destination.lng,
            },
            maidLocation: {
              lat: booking.lastMaidLocation.lat,
              lng: booking.lastMaidLocation.lng,
            },
            maid: booking.maid
              ? {
                  id: booking.maid._id,
                  name: booking.maid.name,
                  phone: booking.maid.phone,
                }
              : null,
          });
        }
      } catch (err) {
        console.error('Catch-up error:', err);
      }
    });

    socket.on('join_maid', async (maidId) => {
      const resolvedMaidId = socket.user?.role === 'maid' ? socket.user._id.toString() : maidId;
      socket.join(`maid_${resolvedMaidId}`);
      if (socket.user?.role === 'maid') {
        await markMaidOnline(resolvedMaidId, { socketId: socket.id, source: 'join_maid' });
      }
      console.log(`🧹 Maid joined offer room: ${resolvedMaidId}`);
    });

    socket.on('maid:heartbeat', async (_payload = {}, ack) => {
      if (socket.user?.role !== 'maid') {
        if (typeof ack === 'function') ack({ success: false, message: 'Unauthorized' });
        return;
      }

      await refreshMaidPresence(socket.user._id, { socketId: socket.id });
      if (typeof ack === 'function') {
        ack({
          success: true,
          status: 'online',
          nextHeartbeatIn: 30000,
        });
      }
    });

    socket.on('maid:location', async (payload = {}, ack) => {
      try {
        if (socket.user?.role !== 'maid') {
          if (typeof ack === 'function') ack({ success: false, message: 'Unauthorized' });
          return;
        }

        const coordinates = Array.isArray(payload.coordinates) ? payload.coordinates : null;
        const lat = Number(payload.lat ?? payload.latitude ?? coordinates?.[1]);
        const lng = Number(payload.lng ?? payload.lon ?? payload.longitude ?? coordinates?.[0]);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          if (typeof ack === 'function')
            ack({ success: false, message: 'lat and lng are required' });
          return;
        }

        const update = {
          isOnline: true,
          lastLocationUpdatedAt: new Date(),
          lastLocation: {
            lat,
            lng,
            lastUpdated: new Date(),
          },
          currentLocation: {
            type: 'Point',
            coordinates: [lng, lat],
          },
        };

        if (payload.isAvailable !== undefined) {
          update.isAvailable = payload.isAvailable === true || payload.isAvailable === 'true';
        }

        await MaidProfile.updateOne({ user: socket.user._id }, { $set: update });
        await markMaidOnline(socket.user._id, { socketId: socket.id, source: 'socket_location' });

        if (typeof ack === 'function') {
          ack({
            success: true,
            location: { lat, lng },
            isOnline: true,
          });
        }
      } catch (err) {
        console.error('Maid socket location update error:', err);
        if (typeof ack === 'function') ack({ success: false, message: err.message });
      }
    });

    // Handle live location updates from Maid
    socket.on('update_maid_location', async (payload = {}) => {
      try {
        const Booking = require('../models/Booking');
        const bookingId = payload.bookingId;
        const coordinates = Array.isArray(payload.coordinates) ? payload.coordinates : null;
        const lat = Number(payload.lat ?? payload.latitude ?? coordinates?.[1]);
        const lng = Number(payload.lng ?? payload.lon ?? payload.longitude ?? coordinates?.[0]);

        if (!bookingId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          return;
        }

        // 1. Get Destination (Use Cache to reduce DB overhead)
        let destination = destinationCache.get(bookingId);
        let booking;

        if (!destination) {
          booking = await Booking.findById(bookingId).populate('maid', 'name phone');
          if (!booking) return;

          destination = {
            lat: booking.location?.lat,
            lng: booking.location?.lng,
            isNearbySent: booking.isNearbyNotificationSent,
          };
          destinationCache.set(bookingId, destination);
        }

        if (!booking) {
          booking = await Booking.findById(bookingId).populate('maid', 'name phone');
          if (!booking) return;
        }

        // 2. Calculate Route Distance + ETA with throttled Google refreshes.
        const trackingMetrics = await getTrackingMetrics({
          origin: { lat, lng },
          destination,
          cacheEntry: destination,
        });

        destination = {
          ...destination,
          ...trackingMetrics.cacheEntry,
        };
        destinationCache.set(bookingId, destination);

        // 3. Proximity Notification (200m Alert)
        if (
          Number.isFinite(trackingMetrics.straightDistanceMeters) &&
          trackingMetrics.straightDistanceMeters <= 200 &&
          !destination.isNearbySent
        ) {
          io.to(bookingId).emit('maid_nearby', {
            message: 'Your maid is less than 200 meters away!',
            distance: trackingMetrics.distanceMeters,
            etaMinutes: trackingMetrics.etaMinutes,
            distanceSource: trackingMetrics.source,
            routePolyline: trackingMetrics.routePolyline,
            routeSource: trackingMetrics.routeSource,
            timestamp: new Date(),
            destinationLocation: {
              lat: destination.lat,
              lng: destination.lng,
            },
            maidLocation: {
              lat,
              lng,
            },
            maid: booking.maid
              ? {
                  id: booking.maid._id,
                  name: booking.maid.name,
                  phone: booking.maid.phone,
                }
              : null,
          });

          // Update DB and Cache
          await Booking.findByIdAndUpdate(bookingId, { isNearbyNotificationSent: true });
          destination.isNearbySent = true;
          destinationCache.set(bookingId, destination);
        }

        // 4. Adaptive Tracking (Battery Fix)
        const nextInterval = trackingMetrics.nextInterval;
        const bookingUpdate = {
          lastMaidLocation: { lat, lng },
          lastSeenAt: new Date(),
        };

        const isStraightLineNearby =
          Number.isFinite(trackingMetrics.straightDistanceMeters) &&
          trackingMetrics.straightDistanceMeters <= 200;

        if (booking?.status === 'accepted') {
          bookingUpdate.status = isStraightLineNearby ? 'arrived' : 'in_transit';
        } else if (booking?.status === 'in_transit' && isStraightLineNearby) {
          bookingUpdate.status = 'arrived';
        }

        // 5. Update Last Seen in DB (Background task)
        Booking.findByIdAndUpdate(bookingId, bookingUpdate).catch((e) =>
          console.error('DB update error:', e),
        );

        // 6. Broadcast to Customer
        io.to(bookingId).emit('maid_location_changed', {
          lat,
          lng,
          distance: trackingMetrics.distanceMeters,
          etaMinutes: trackingMetrics.etaMinutes,
          distanceSource: trackingMetrics.source,
          routePolyline: trackingMetrics.routePolyline,
          routeSource: trackingMetrics.routeSource,
          nextUpdateIn: nextInterval,
          timestamp: new Date(),
          destinationLocation: {
            lat: destination.lat,
            lng: destination.lng,
          },
          maidLocation: {
            lat,
            lng,
          },
          maid: booking.maid
            ? {
                id: booking.maid._id,
                name: booking.maid.name,
                phone: booking.maid.phone,
              }
            : null,
        });

        // 7. Acknowledge to Maid (Adaptive Interval)
        socket.emit('update_config', {
          nextInterval,
          distance: trackingMetrics.distanceMeters,
          etaMinutes: trackingMetrics.etaMinutes,
          distanceSource: trackingMetrics.source,
          routePolyline: trackingMetrics.routePolyline,
          routeSource: trackingMetrics.routeSource,
        });
      } catch (err) {
        console.error('Socket location update error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ Disconnected: ${socket.id}`);
      if (socket.user?.role === 'maid') {
        scheduleOfflineCheck(socket.user._id);
      }
    });
  });

  return io;
};

async function attachRedisAdapter(socketServer) {
  if (!isRedisConfigured() || process.env.SOCKET_REDIS_ADAPTER === 'false') return;

  const pubClient = await createNamedRedisClient('socket_pub');
  const subClient = await createNamedRedisClient('socket_sub');
  if (!pubClient || !subClient) return;

  socketServer.adapter(createAdapter(pubClient, subClient));
  console.log('[SOCKET] Redis adapter enabled');
}

async function authenticateSocketUser(socket) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token || '';

  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const user = await User.findById(decoded.id);
    if (!user || user.isBlocked) return null;
    return user;
  } catch (error) {
    console.warn('[SOCKET] Authentication failed:', error.message);
    return null;
  }
}

const getIO = () => {
  if (!io) {
    if (process.env.NODE_ENV === 'test') {
      return {
        to: () => ({
          emit: () => {},
        }),
        emit: () => {},
      };
    }
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

module.exports = { init, getIO };
