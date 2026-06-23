const MaidProfile = require('../models/MaidProfile');
const { createNamedRedisClient, isRedisConfigured } = require('./redisClient');

const PRESENCE_TTL_SECONDS = Number(process.env.MAID_PRESENCE_TTL_SECONDS) || 90;
const localPresence = new Map();

let redisPresenceClientPromise = null;

function presenceKey(maidId) {
  return `presence:maid:${maidId}`;
}

async function getPresenceClient() {
  if (!isRedisConfigured()) return null;
  if (!redisPresenceClientPromise) {
    redisPresenceClientPromise = createNamedRedisClient('presence').catch((error) => {
      console.error('[PRESENCE] Redis unavailable, falling back to local presence:', error.message);
      redisPresenceClientPromise = null;
      return null;
    });
  }
  return redisPresenceClientPromise;
}

async function writePresence(maidId, payload) {
  const value = {
    maidId: maidId.toString(),
    lastSeenAt: new Date().toISOString(),
    ...payload,
  };
  const client = await getPresenceClient();

  if (client) {
    await client.setEx(presenceKey(maidId), PRESENCE_TTL_SECONDS, JSON.stringify(value));
    return value;
  }

  localPresence.set(maidId.toString(), {
    value,
    expiresAt: Date.now() + PRESENCE_TTL_SECONDS * 1000,
  });
  return value;
}

async function readPresence(maidId) {
  const client = await getPresenceClient();
  if (client) {
    const raw = await client.get(presenceKey(maidId));
    return raw ? JSON.parse(raw) : null;
  }

  const entry = localPresence.get(maidId.toString());
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    localPresence.delete(maidId.toString());
    return null;
  }
  return entry.value;
}

async function markMaidOnline(maidId, meta = {}) {
  const presence = await writePresence(maidId, {
    status: 'online',
    socketId: meta.socketId,
    source: meta.source || 'socket',
  });

  MaidProfile.updateOne(
    { user: maidId },
    {
      $set: {
        isOnline: true,
      },
    },
  ).catch((error) => console.error('[PRESENCE] Failed to mark maid online:', error.message));

  return presence;
}

async function refreshMaidPresence(maidId, meta = {}) {
  return writePresence(maidId, {
    status: 'online',
    socketId: meta.socketId,
    source: meta.source || 'heartbeat',
  });
}

async function markMaidOfflineIfStale(maidId) {
  const presence = await readPresence(maidId);
  if (presence) return false;

  await MaidProfile.updateOne({ user: maidId }, { $set: { isOnline: false } });
  return true;
}

function scheduleOfflineCheck(maidId) {
  const timer = setTimeout(
    () => {
      markMaidOfflineIfStale(maidId).catch((error) => {
        console.error('[PRESENCE] Offline check failed:', error.message);
      });
    },
    (PRESENCE_TTL_SECONDS + 5) * 1000,
  );

  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
  PRESENCE_TTL_SECONDS,
  markMaidOfflineIfStale,
  markMaidOnline,
  readPresence,
  refreshMaidPresence,
  scheduleOfflineCheck,
};
