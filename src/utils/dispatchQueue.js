const crypto = require('crypto');
const DispatchJob = require('../models/DispatchJob');
const DispatchAttempt = require('../models/DispatchAttempt');
const { getBullMQConnectionOptions, isRedisConfigured } = require('./redisClient');

const DEFAULT_POLL_INTERVAL_MS = Number(process.env.DISPATCH_JOB_POLL_MS) || 5000;
const STALE_LOCK_MS = Number(process.env.DISPATCH_JOB_STALE_LOCK_MS) || 2 * 60 * 1000;
const BULL_QUEUE_NAME = process.env.DISPATCH_BULL_QUEUE_NAME || 'zafabit-dispatch';
let workerTimer = null;
let bullQueue = null;
let bullWorker = null;
let bullMQLoadErrorLogged = false;

function getJobDispatchType(type) {
  return type.includes('scheduled') ? 'scheduled' : 'instant';
}

async function logDispatchAttempt(payload) {
  return DispatchAttempt.create(payload);
}

async function enqueueDispatchJob({
  bookingId,
  type,
  runAt = new Date(),
  payload = {},
  idempotencyKey,
  maxAttempts = 3,
}) {
  const jobKey = idempotencyKey || `${type}:${bookingId}:${new Date(runAt).getTime()}`;

  const job = await DispatchJob.findOneAndUpdate(
    { idempotencyKey: jobKey },
    {
      $setOnInsert: {
        booking: bookingId,
        type,
        status: 'queued',
        runAt,
        payload,
        idempotencyKey: jobKey,
        maxAttempts,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  await logDispatchAttempt({
    booking: bookingId,
    job: job._id,
    dispatchType: getJobDispatchType(type),
    event: 'queued',
    message: `Dispatch job queued: ${type}`,
    metadata: { runAt, payload },
  });

  await enqueueBullDispatchJob(job, jobKey, runAt, maxAttempts);
  return job;
}

async function cancelDispatchJobs(bookingId, types = []) {
  const query = {
    booking: bookingId,
    status: { $in: ['queued', 'processing'] },
  };
  if (types.length) query.type = { $in: types };

  const jobs = await DispatchJob.find(query).select('idempotencyKey');
  const result = await DispatchJob.updateMany(query, { $set: { status: 'cancelled' } });
  await removeBullDispatchJobs(jobs.map((job) => job.idempotencyKey).filter(Boolean));
  return result;
}

async function claimNextDispatchJob() {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const lockToken = crypto.randomUUID();

  return DispatchJob.findOneAndUpdate(
    {
      runAt: { $lte: now },
      $or: [{ status: 'queued' }, { status: 'processing', lockedAt: { $lte: staleBefore } }],
      $expr: { $lt: ['$attempts', '$maxAttempts'] },
    },
    {
      $set: {
        status: 'processing',
        lockedAt: now,
        lockToken,
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { runAt: 1, createdAt: 1 },
      returnDocument: 'after',
    },
  );
}

function shouldUseBullMQ() {
  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.DISPATCH_QUEUE_DRIVER === 'mongo') return false;
  if (process.env.DISPATCH_QUEUE_DRIVER === 'bullmq') return true;
  return isRedisConfigured();
}

function loadBullMQ() {
  try {
    return require('bullmq');
  } catch (error) {
    if (!bullMQLoadErrorLogged && shouldUseBullMQ()) {
      console.warn(
        '[DISPATCH] BullMQ requested but not installed. Install bullmq and ioredis to enable Redis dispatch queues.',
      );
      bullMQLoadErrorLogged = true;
    }
    return null;
  }
}

function getBullQueue() {
  if (!shouldUseBullMQ()) return null;
  if (bullQueue) return bullQueue;

  const bull = loadBullMQ();
  const connection = getBullMQConnectionOptions();
  if (!bull || !connection) return null;

  bullQueue = new bull.Queue(BULL_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });

  bullQueue.on('error', (error) => {
    console.error('[DISPATCH] BullMQ queue error:', error.message);
  });

  return bullQueue;
}

async function enqueueBullDispatchJob(job, jobKey, runAt, maxAttempts) {
  const queue = getBullQueue();
  if (!queue) return false;

  const delay = Math.max(0, new Date(runAt).getTime() - Date.now());
  try {
    await queue.add(
      job.type,
      {
        dispatchJobId: job._id.toString(),
      },
      {
        jobId: jobKey,
        delay,
        attempts: maxAttempts,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    );
    return true;
  } catch (error) {
    console.error('[DISPATCH] Failed to enqueue BullMQ dispatch job:', error.message);
    return false;
  }
}

async function removeBullDispatchJobs(jobKeys) {
  if (!jobKeys.length) return;
  const queue = getBullQueue();
  if (!queue) return;

  await Promise.allSettled(jobKeys.map((jobKey) => queue.remove(jobKey)));
}

async function claimBullDispatchJob(dispatchJobId, bullJobId) {
  const now = new Date();
  const lockToken = `bull:${bullJobId}:${crypto.randomUUID()}`;
  const job = await DispatchJob.findOneAndUpdate(
    {
      _id: dispatchJobId,
      status: { $in: ['queued', 'processing'] },
      $expr: { $lt: ['$attempts', '$maxAttempts'] },
    },
    {
      $set: {
        status: 'processing',
        lockedAt: now,
        lockToken,
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after' },
  );

  if (job) return job;
  return DispatchJob.findById(dispatchJobId);
}

async function processDispatchJob(job) {
  if (['completed', 'cancelled'].includes(job.status)) {
    const Booking = require('../models/Booking');
    const booking = await Booking.findById(job.booking);
    return {
      success: true,
      available: job.status === 'completed',
      message: `Dispatch job already ${job.status}`,
      booking,
      assignmentState: job.status === 'completed' ? 'already_completed' : 'cancelled',
    };
  }

  const { startInstantDispatch, expireCurrentOffer } = require('./instantDispatch');
  const {
    startBroadcastDispatch,
    expireScheduledBroadcast,
    expireUnassignedScheduled,
  } = require('./scheduledDispatch');

  await logDispatchAttempt({
    booking: job.booking,
    job: job._id,
    dispatchType: getJobDispatchType(job.type),
    event: 'started',
    message: `Dispatch job started: ${job.type}`,
  });

  let result;
  if (job.type === 'start_instant') {
    result = await startInstantDispatch(job.booking, { jobId: job._id });
  } else if (job.type === 'start_scheduled') {
    result = await startBroadcastDispatch(job.booking, { ...(job.payload || {}), jobId: job._id });
  } else if (job.type === 'expire_instant_offer') {
    result = await expireCurrentOffer(job.booking, { jobId: job._id });
  } else if (job.type === 'expire_scheduled_broadcast') {
    result = await expireScheduledBroadcast(job.booking, { jobId: job._id });
  } else if (job.type === 'expire_unassigned_scheduled') {
    result = await expireUnassignedScheduled(job.booking, { jobId: job._id });
  } else if (job.type === 'expire_unassigned_instant') {
    const { expireUnassignedInstant } = require('./instantDispatch');
    result = await expireUnassignedInstant(job.booking, { jobId: job._id });
  } else {
    throw new Error(`Unknown dispatch job type: ${job.type}`);
  }

  const completionQuery = { _id: job._id };
  if (job.lockToken) completionQuery.lockToken = job.lockToken;

  await DispatchJob.updateOne(completionQuery, {
    $set: {
      status: 'completed',
      lastError: undefined,
    },
    $unset: {
      lockedAt: '',
      lockToken: '',
    },
  });

  await logDispatchAttempt({
    booking: job.booking,
    job: job._id,
    dispatchType: getJobDispatchType(job.type),
    event: 'completed',
    message: result?.message || `Dispatch job completed: ${job.type}`,
    metadata: { result },
  });

  return result;
}

async function processDueDispatchJobs(limit = 10) {
  if (shouldUseBullMQ() && getBullQueue()) return [];

  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextDispatchJob();
    if (!job) break;

    try {
      const result = await processDispatchJob(job);
      results.push({ job, result });
    } catch (error) {
      const nextStatus = job.attempts >= job.maxAttempts ? 'failed' : 'queued';
      const nextRunAt = new Date(Date.now() + Math.min(60000, 1000 * Math.pow(2, job.attempts)));
      await DispatchJob.updateOne(
        { _id: job._id, lockToken: job.lockToken },
        {
          $set: {
            status: nextStatus,
            runAt: nextRunAt,
            lastError: error.message,
          },
          $unset: {
            lockedAt: '',
            lockToken: '',
          },
        },
      );

      await logDispatchAttempt({
        booking: job.booking,
        job: job._id,
        dispatchType: getJobDispatchType(job.type),
        event: 'failed',
        message: error.message,
      });
    }
  }

  return results;
}

function startDispatchWorker() {
  if (workerTimer || process.env.DISPATCH_WORKER_ENABLED === 'false') return;
  if (startBullDispatchWorker()) return;

  const tick = async () => {
    try {
      await processDueDispatchJobs();
    } catch (error) {
      console.error('[DISPATCH WORKER] Failed to process jobs:', error);
    } finally {
      workerTimer = setTimeout(tick, DEFAULT_POLL_INTERVAL_MS);
      if (typeof workerTimer.unref === 'function') workerTimer.unref();
    }
  };

  workerTimer = setTimeout(tick, DEFAULT_POLL_INTERVAL_MS);
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
}

function startBullDispatchWorker() {
  if (!shouldUseBullMQ() || bullWorker) return false;

  const bull = loadBullMQ();
  const connection = getBullMQConnectionOptions();
  if (!bull || !connection) return false;

  bullWorker = new bull.Worker(
    BULL_QUEUE_NAME,
    async (bullJob) => {
      const dispatchJobId = bullJob.data?.dispatchJobId;
      if (!dispatchJobId) {
        throw new Error('BullMQ dispatch job missing dispatchJobId');
      }

      const dispatchJob = await claimBullDispatchJob(dispatchJobId, bullJob.id);
      if (!dispatchJob) {
        return { success: false, message: 'Dispatch job not found' };
      }
      return processDispatchJob(dispatchJob);
    },
    {
      connection,
      concurrency: Number(process.env.DISPATCH_BULL_CONCURRENCY) || 5,
    },
  );

  bullWorker.on('completed', (job) => {
    console.log(`[DISPATCH] BullMQ job completed: ${job.id}`);
  });
  bullWorker.on('failed', (job, error) => {
    console.error(`[DISPATCH] BullMQ job failed: ${job?.id}`, error.message);
  });
  bullWorker.on('error', (error) => {
    console.error('[DISPATCH] BullMQ worker error:', error.message);
  });

  console.log(`[DISPATCH] BullMQ worker started on queue ${BULL_QUEUE_NAME}`);
  return true;
}

async function stopDispatchWorker() {
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  if (bullWorker) {
    await bullWorker.close();
    bullWorker = null;
  }
  if (bullQueue) {
    await bullQueue.close();
    bullQueue = null;
  }
}

async function getDispatchRuntimeStats() {
  const driver = shouldUseBullMQ() ? 'bullmq' : 'mongo';
  const stats = {
    driver,
    bullWorkerActive: Boolean(bullWorker),
    pollWorkerActive: Boolean(workerTimer),
  };

  if (driver === 'bullmq') {
    const queue = getBullQueue();
    if (queue) {
      const counts = await queue.getJobCounts(
        'active',
        'completed',
        'delayed',
        'failed',
        'paused',
        'prioritized',
        'waiting',
        'waiting-children',
      );
      stats.queueName = BULL_QUEUE_NAME;
      stats.jobCounts = counts;
    }
  } else {
    stats.mongoJobs = {
      queued: await DispatchJob.countDocuments({ status: 'queued' }),
      processing: await DispatchJob.countDocuments({ status: 'processing' }),
      failed: await DispatchJob.countDocuments({ status: 'failed' }),
    };
  }

  return stats;
}

module.exports = {
  cancelDispatchJobs,
  enqueueDispatchJob,
  getDispatchRuntimeStats,
  logDispatchAttempt,
  processDispatchJob,
  processDueDispatchJobs,
  startDispatchWorker,
  stopDispatchWorker,
};
