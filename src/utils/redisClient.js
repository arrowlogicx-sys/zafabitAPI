const { createClient } = require('redis');

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const clients = new Map();

function getRedisUrl() {
  return process.env.REDIS_URL_INTERNAL || process.env.REDIS_URL || process.env.REDIS_CONNECTION_STRING || '';
}

function isRedisConfigured() {
  return process.env.REDIS_ENABLED !== 'false' && Boolean(getRedisUrl());
}

async function createNamedRedisClient(name) {
  if (!isRedisConfigured()) return null;
  if (clients.has(name)) return clients.get(name);

  const client = createClient({
    url: getRedisUrl() || DEFAULT_REDIS_URL,
  });

  client.on('error', (error) => {
    console.error(`[REDIS:${name}] ${error.message}`);
  });

  await client.connect();
  clients.set(name, client);
  return client;
}

function getBullMQConnectionOptions() {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;

  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

async function closeRedisClients() {
  const activeClients = Array.from(clients.values());
  clients.clear();
  await Promise.allSettled(activeClients.map((client) => client.quit()));
}

module.exports = {
  closeRedisClients,
  createNamedRedisClient,
  getBullMQConnectionOptions,
  getRedisUrl,
  isRedisConfigured,
};

