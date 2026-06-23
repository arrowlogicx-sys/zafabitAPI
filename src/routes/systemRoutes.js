const express = require('express');
const mongoose = require('mongoose');
const { getDispatchRuntimeStats } = require('../utils/dispatchQueue');
const { createNamedRedisClient, isRedisConfigured } = require('../utils/redisClient');
const { TERMS_AND_CONDITIONS, PRIVACY_POLICY } = require('../utils/constants');

const router = express.Router();

router.get('/terms', (_req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Terms & Conditions retrieved',
    data: TERMS_AND_CONDITIONS,
  });
});

router.get('/privacy', (_req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Privacy Policy retrieved',
    data: PRIVACY_POLICY,
  });
});

router.get('/health', async (_req, res) => {
  let redis = { configured: isRedisConfigured(), ok: false };

  if (redis.configured) {
    try {
      const client = await createNamedRedisClient('system_health');
      await client.ping();
      redis.ok = true;
    } catch (error) {
      redis = {
        configured: true,
        ok: false,
        error: error.message,
      };
    }
  }

  const mongoStateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  const mongoState = mongoose.connection.readyState;
  const queue = await getDispatchRuntimeStats();
  const healthy = mongoState === 1 && (!redis.configured || redis.ok);

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    message: healthy ? 'System healthy' : 'System degraded',
    data: {
      mongo: {
        state: mongoStateMap[mongoState] || 'unknown',
      },
      redis,
      queue,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
});

router.get('/dispatch-metrics', async (_req, res) => {
  const queue = await getDispatchRuntimeStats();
  return res.status(200).json({
    success: true,
    message: 'Dispatch runtime metrics',
    data: queue,
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
