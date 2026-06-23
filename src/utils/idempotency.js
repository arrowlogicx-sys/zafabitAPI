const crypto = require('crypto');
const IdempotencyRecord = require('../models/IdempotencyRecord');

function getRequestIdempotencyKey(req) {
  return (
    req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body?.idempotencyKey
  );
}

function hashRequestPayload(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload || {}))
    .digest('hex');
}

async function beginIdempotentRequest(scope, key, payload = {}) {
  if (!key) {
    return { enabled: false };
  }

  const requestHash = hashRequestPayload(payload);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    const record = await IdempotencyRecord.create({
      scope,
      key,
      requestHash,
      expiresAt,
    });
    return { enabled: true, owner: true, record };
  } catch (error) {
    if (error.code !== 11000) throw error;

    const existing = await IdempotencyRecord.findOne({ scope, key });
    if (!existing) throw error;
    if (existing.requestHash && existing.requestHash !== requestHash) {
      return {
        enabled: true,
        conflict: true,
        statusCode: 409,
        body: {
          success: false,
          message: 'Idempotency key was already used with a different request',
          data: null,
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency key was already used with a different request',
            details: [],
          },
        },
      };
    }

    if (existing.status === 'completed' && existing.response) {
      return {
        enabled: true,
        replay: true,
        statusCode: existing.response.statusCode,
        body: existing.response.body,
      };
    }

    return {
      enabled: true,
      inProgress: true,
      statusCode: 409,
      body: {
        success: false,
        message: 'Request is already being processed',
        data: null,
        error: {
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'Request is already being processed',
          details: [],
        },
      },
    };
  }
}

async function completeIdempotentRequest(record, statusCode, body) {
  if (!record) return;

  await IdempotencyRecord.updateOne(
    { _id: record._id },
    {
      $set: {
        status: 'completed',
        response: { statusCode, body },
      },
    },
  );
}

module.exports = {
  beginIdempotentRequest,
  completeIdempotentRequest,
  getRequestIdempotencyKey,
};
