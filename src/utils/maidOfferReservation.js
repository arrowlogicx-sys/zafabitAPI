const { createNamedRedisClient, isRedisConfigured } = require('./redisClient');

const OFFER_RESERVATION_PREFIX = 'dispatch:maid_offer';
const DEFAULT_RESERVATION_TTL_MS = Number(process.env.MAID_OFFER_RESERVATION_TTL_MS) || 120000;

function reservationKey(maidId) {
  return `${OFFER_RESERVATION_PREFIX}:${maidId}`;
}

async function getReservationClient() {
  if (!isRedisConfigured() || process.env.MAID_OFFER_RESERVATION_ENABLED === 'false') {
    return null;
  }

  try {
    return await createNamedRedisClient('maid_offer_reservation');
  } catch (error) {
    console.error('[RESERVATION] Redis reservation disabled:', error.message);
    return null;
  }
}

async function reserveMaidOffer(maidId, bookingId, ttlMs = DEFAULT_RESERVATION_TTL_MS) {
  const client = await getReservationClient();
  if (!client) return { reserved: true, source: 'disabled' };

  const key = reservationKey(maidId);
  const value = bookingId.toString();

  const existing = await client.get(key);
  if (existing === value) {
    await client.pExpire(key, ttlMs);
    return { reserved: true, source: 'redis' };
  }

  const result = await client.set(key, value, {
    NX: true,
    PX: ttlMs,
  });

  return {
    reserved: result === 'OK',
    source: 'redis',
  };
}

async function releaseMaidOfferReservation(maidId, bookingId) {
  const client = await getReservationClient();
  if (!client) return false;

  const key = reservationKey(maidId);
  const current = await client.get(key);
  if (current !== bookingId.toString()) {
    return false;
  }

  await client.del(key);
  return true;
}

async function filterReservedMaidIds(maidIds = [], bookingId) {
  const client = await getReservationClient();
  if (!client || !maidIds.length) return new Set();

  const keys = maidIds.map((id) => reservationKey(id));
  const values = await client.mGet(keys);
  const blocked = new Set();

  values.forEach((value, index) => {
    if (!value) return;
    if (bookingId && value === bookingId.toString()) return;
    blocked.add(maidIds[index].toString());
  });

  return blocked;
}

module.exports = {
  DEFAULT_RESERVATION_TTL_MS,
  filterReservedMaidIds,
  releaseMaidOfferReservation,
  reserveMaidOffer,
};
