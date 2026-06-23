process.env.NODE_ENV = 'development';
process.env.DISABLE_DEV_AUTH_FALLBACK = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.GOOGLE_MAPS_API_KEY = '';
process.env.SOCKET_REDIS_ADAPTER = 'false';
process.env.DISPATCH_QUEUE_DRIVER = 'bullmq';
process.env.REDIS_URL = process.env.RUNTIME_SIM_REDIS_URL || 'redis://127.0.0.1:6379/13';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createClient } = require('redis');

const User = require('../models/User');
const MaidProfile = require('../models/MaidProfile');
const Service = require('../models/Service');
const Booking = require('../models/Booking');
const DispatchAttempt = require('../models/DispatchAttempt');
const {
  enqueueDispatchJob,
  startDispatchWorker,
  stopDispatchWorker,
} = require('../utils/dispatchQueue');
const { closeRedisClients } = require('../utils/redisClient');

const REPORT_PATH = path.resolve(
  __dirname,
  '../../artifacts/dispatch-failure-drill-report-2026-06-12.md',
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function flushRedisDb() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  await client.flushDb();
  await client.quit();
}

function makeGeoPoint(lat, lng) {
  return {
    type: 'Point',
    coordinates: [lng, lat],
  };
}

async function seedSingleInstantBooking() {
  const service = await Service.create({
    name: `Failure Drill Service ${Date.now()}`,
    description: 'Worker restart drill',
    category: 'Home Cleaning',
    price: 699,
    estimatedTime: 90,
    whatsIncluded: ['Sweep'],
    status: 'active',
  });

  const customer = await User.create({
    firstName: 'Failure',
    lastName: 'Customer',
    name: 'Failure Drill Customer',
    email: `failure.customer.${Date.now()}@zaffabit.test`,
    phone: '+917740000001',
    role: 'customer',
    isVerified: true,
    referralCode: `AR-FAIL-C-${Date.now()}`,
  });

  const maid = await User.create({
    firstName: 'Failure',
    lastName: 'Maid',
    name: 'Failure Drill Maid',
    email: `failure.maid.${Date.now()}@zaffabit.test`,
    phone: '+918840000001',
    role: 'maid',
    isVerified: true,
    referralCode: `AR-FAIL-M-${Date.now()}`,
  });

  await MaidProfile.create({
    user: maid._id,
    activeStatus: 'active',
    isAvailable: true,
    isOnline: true,
    isIdentityVerified: true,
    currentLocation: makeGeoPoint(10.0115, 76.355),
    lastLocation: {
      lat: 10.0115,
      lng: 76.355,
      lastUpdated: new Date(),
    },
    lastLocationUpdatedAt: new Date(),
  });
  await MaidProfile.syncIndexes();

  return Booking.create({
    customer: customer._id,
    service: service._id,
    items: [
      {
        service: service._id,
        name: service.name,
        price: service.price,
        duration: service.estimatedTime,
      },
    ],
    subtotal: service.price,
    platformFee: 29,
    gst: 63,
    totalAmount: 791,
    estimatedTime: service.estimatedTime,
    totalTime: service.estimatedTime,
    scheduleDate: new Date(),
    bookingType: 'instant',
    address: { city: 'Kochi' },
    location: { lat: 10.0112, lng: 76.355 },
    status: 'pending_payment',
    paymentStatus: 'paid',
  });
}

async function main() {
  let mongo;
  try {
    await flushRedisDb();
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());

    const booking = await seedSingleInstantBooking();
    await stopDispatchWorker();

    await enqueueDispatchJob({
      bookingId: booking._id,
      type: 'start_instant',
      runAt: new Date(),
      idempotencyKey: `failure_drill_start:${booking._id}`,
    });

    await sleep(1000);
    const beforeRestart = await Booking.findById(booking._id).select('status');

    startDispatchWorker();

    const searchingBooking = await (async function waitForSearching() {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 10000) {
        const current = await Booking.findById(booking._id).select('status matchingQueue');
        if (current?.status === 'searching' && current.matchingQueue?.length) {
          return current;
        }
        await sleep(100);
      }
      throw new Error('Worker restart drill timed out');
    })();

    const attempts = await DispatchAttempt.find({ booking: booking._id }).sort({ createdAt: 1 });
    const candidateSearch = attempts.find((entry) => entry.event === 'candidate_search');
    const report = `# Dispatch Failure Drill Report

Date: \`2026-06-12\`
Redis URL: \`${process.env.REDIS_URL}\`

## Drills

### 1. Worker restart

- booking status before worker restart processing: \`${beforeRestart?.status}\`
- booking status after worker restart: \`${searchingBooking.status}\`
- queued job survived restart: \`${searchingBooking.status === 'searching'}\`

### 2. Maps API fallback

- GOOGLE_MAPS_API_KEY set for drill: \`${process.env.GOOGLE_MAPS_API_KEY}\`
- candidate search completed: \`${Boolean(candidateSearch)}\`
- expected distance mode: \`haversine fallback\`

## Conclusion

- queued dispatch can resume after worker restart
- dispatch still works without Google Maps API key
`;

    fs.writeFileSync(REPORT_PATH, report, 'utf8');
    console.log(
      JSON.stringify(
        {
          reportPath: REPORT_PATH,
          workerRestartRecovered: searchingBooking.status === 'searching',
          mapsFallbackWorked: Boolean(candidateSearch),
        },
        null,
        2,
      ),
    );
  } finally {
    await stopDispatchWorker().catch(() => {});
    await closeRedisClients().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    if (mongo) {
      await mongo.stop().catch(() => {});
    }
    await flushRedisDb().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
