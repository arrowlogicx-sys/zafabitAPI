 
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const { artifactsDir, assertSafePerformanceDatabase, profile } = require('./config');

const DAY_MS = 24 * 60 * 60 * 1000;
const statuses = [
  'completed',
  'completed',
  'completed',
  'ongoing',
  'accepted',
  'pending',
  'cancelled',
  'refunded',
];
const cities = ['Kochi', 'Thrissur', 'Kozhikode', 'Thiruvananthapuram'];
const serviceIds = Array.from({ length: 12 }, () => new mongoose.Types.ObjectId());

const insertBatches = async (collection, total, makeDocument, batchSize) => {
  const startedAt = Date.now();
  for (let start = 0; start < total; start += batchSize) {
    const size = Math.min(batchSize, total - start);
    const documents = Array.from({ length: size }, (_, offset) => makeDocument(start + offset));
    await collection.insertMany(documents, { ordered: false });
    if ((start + size) % Math.max(batchSize, 50_000) === 0 || start + size === total) {
      console.log(`${collection.collectionName}: ${start + size}/${total}`);
    }
  }
  return Date.now() - startedAt;
};

const main = async () => {
  const uri = process.env.PERF_MONGODB_URI;
  const databaseName = assertSafePerformanceDatabase(uri, 'seed synthetic data');
  await mongoose.connect(uri, { maxPoolSize: Number(process.env.PERF_SEED_POOL_SIZE) || 20 });

  const db = mongoose.connection.db;
  const existingCollections = await db.listCollections({}, { nameOnly: true }).toArray();
  if (existingCollections.length && process.env.PERF_ALLOW_NONEMPTY !== 'true') {
    throw new Error(
      `Performance database ${databaseName} is not empty. Use a new database or set PERF_ALLOW_NONEMPTY=true explicitly.`,
    );
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  const startedAt = new Date();
  const timings = {};
  const customerIds = Array.from(
    { length: profile.customers },
    () => new mongoose.Types.ObjectId(),
  );
  const maidIds = Array.from({ length: profile.maids }, () => new mongoose.Types.ObjectId());
  const bookingIds = Array.from({ length: profile.bookings }, () => new mongoose.Types.ObjectId());
  const adminId = new mongoose.Types.ObjectId();

  timings.services = await insertBatches(
    db.collection('services'),
    serviceIds.length,
    (index) => ({
      _id: serviceIds[index],
      name: `Performance Service ${index + 1}`,
      category: index % 2 ? 'HOME' : 'DEEP CLEAN',
      price: 399 + index * 25,
      estimatedTime: 60 + index * 5,
      status: 'active',
      createdAt: startedAt,
      updatedAt: startedAt,
    }),
    profile.batchSize,
  );

  timings.customers = await insertBatches(
    db.collection('users'),
    profile.customers,
    (index) => ({
      _id: customerIds[index],
      name: `Performance Customer ${index}`,
      firstName: 'Performance',
      lastName: `Customer ${index}`,
      email: `perf.customer.${index}@example.invalid`,
      phone: `+91${String(6000000000 + index).padStart(10, '0')}`,
      role: 'customer',
      isVerified: true,
      isBlocked: index % 500 === 0,
      walletBalance: index % 5000,
      rewardPoints: index % 1000,
      referralCode: `PERFC${index}`,
      language: 'en',
      createdAt: new Date(startedAt.getTime() - (index % 730) * DAY_MS),
      updatedAt: startedAt,
    }),
    profile.batchSize,
  );

  timings.maids = await insertBatches(
    db.collection('users'),
    profile.maids,
    (index) => ({
      _id: maidIds[index],
      name: `Performance Maid ${index}`,
      firstName: 'Performance',
      lastName: `Maid ${index}`,
      email: `perf.maid.${index}@example.invalid`,
      phone: `+91${String(8000000000 + index).padStart(10, '0')}`,
      employeeId: `PERF-M-${String(index).padStart(6, '0')}`,
      role: 'maid',
      isVerified: true,
      isBlocked: false,
      referralCode: `PERFM${index}`,
      language: 'en',
      createdAt: new Date(startedAt.getTime() - (index % 365) * DAY_MS),
      updatedAt: startedAt,
    }),
    profile.batchSize,
  );

  timings.maidProfiles = await insertBatches(
    db.collection('maidprofiles'),
    profile.maids,
    (index) => ({
      _id: new mongoose.Types.ObjectId(),
      user: maidIds[index],
      activeStatus: index % 5 ? 'active' : 'inactive',
      isIdentityVerified: index % 20 !== 0,
      onboardingStep: 4,
      averageRating: 3.5 + (index % 15) / 10,
      totalJobs: index % 500,
      currentLocation: {
        type: 'Point',
        coordinates: [76.2673 + (index % 100) / 1000, 9.9312 + (index % 100) / 1000],
      },
      createdAt: startedAt,
      updatedAt: startedAt,
    }),
    profile.batchSize,
  );

  timings.bookings = await insertBatches(
    db.collection('bookings'),
    profile.bookings,
    (index) => {
      const customer = customerIds[index % customerIds.length];
      const maid = maidIds[index % maidIds.length];
      const service = serviceIds[index % serviceIds.length];
      const status = statuses[index % statuses.length];
      const createdAt = new Date(
        startedAt.getTime() - (index % 730) * DAY_MS - (index % 86_400) * 1000,
      );
      const subtotal = 399 + (index % 12) * 25;
      const gst = Math.round(subtotal * 0.09 * 100) / 100;
      const totalAmount = subtotal + 29 + gst;
      return {
        _id: bookingIds[index],
        customer,
        maid: status === 'pending' ? null : maid,
        service,
        items: [
          {
            service,
            name: `Performance Service ${(index % 12) + 1}`,
            price: subtotal,
            duration: 60,
          },
        ],
        subtotal,
        platformFee: 29,
        gstPercent: 9,
        gst,
        grossAmount: totalAmount,
        maidSharePercent: 70,
        maidShareAmount: Math.round(subtotal * 0.7 * 100) / 100,
        companyShareAmount: Math.round(subtotal * 0.3 * 100) / 100,
        companyRevenueAmount: Math.round((subtotal * 0.3 + 29) * 100) / 100,
        taxAmount: gst,
        totalAmount,
        address: {
          title: 'Home',
          city: cities[index % cities.length],
          pincode: `68${String(index % 10000).padStart(4, '0')}`,
        },
        scheduleDate: new Date(createdAt.getTime() + DAY_MS),
        bookingType: index % 4 ? 'instant' : 'scheduled',
        status,
        paymentStatus: ['cancelled', 'pending'].includes(status)
          ? 'pending'
          : status === 'refunded'
            ? 'refunded'
            : 'paid',
        isPaidOut: status === 'completed' && index % 3 === 0,
        payoutStatus: status === 'completed' && index % 3 === 0 ? 'released' : 'pending',
        estimatedTime: 60,
        totalTime: 60,
        statusHistory: [{ status, timestamp: createdAt }],
        createdAt,
        updatedAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
      };
    },
    profile.batchSize,
  );

  timings.payments = await insertBatches(
    db.collection('payments'),
    profile.payments,
    (index) => {
      const bookingIndex = index % bookingIds.length;
      const subtotal = 399 + (bookingIndex % 12) * 25;
      const amount = subtotal + 29 + Math.round(subtotal * 0.09 * 100) / 100;
      const createdAt = new Date(
        startedAt.getTime() - (bookingIndex % 730) * DAY_MS - (bookingIndex % 86_400) * 1000,
      );
      const refunded = index % 40 === 0;
      return {
        _id: new mongoose.Types.ObjectId(),
        booking: bookingIds[bookingIndex],
        customer: customerIds[bookingIndex % customerIds.length],
        amount,
        currency: 'INR',
        status: refunded ? 'refunded' : 'captured',
        method: ['upi', 'card', 'netbanking', 'wallet'][index % 4],
        isRefunded: refunded,
        refundId: refunded ? `PERF-REF-${index}` : undefined,
        refundReason: refunded ? 'Synthetic performance refund' : undefined,
        refundAmount: refunded ? amount : undefined,
        createdAt,
        updatedAt: createdAt,
      };
    },
    profile.batchSize,
  );

  timings.reviews = await insertBatches(
    db.collection('reviews'),
    profile.reviews,
    (index) => {
      const bookingIndex = index % bookingIds.length;
      const createdAt = new Date(startedAt.getTime() - (bookingIndex % 730) * DAY_MS);
      return {
        _id: new mongoose.Types.ObjectId(),
        booking: bookingIds[bookingIndex],
        customer: customerIds[bookingIndex % customerIds.length],
        maid: maidIds[bookingIndex % maidIds.length],
        rating: (index % 5) + 1,
        review: 'Synthetic performance review',
        sentiment: index % 5 === 0 ? 'negative' : 'positive',
        isIssueRaised: index % 50 === 0,
        issueStatus: index % 50 === 0 ? 'pending' : 'none',
        createdAt,
        updatedAt: createdAt,
      };
    },
    profile.batchSize,
  );

  timings.notifications = await insertBatches(
    db.collection('notifications'),
    profile.notifications,
    (index) => {
      const bookingIndex = index % bookingIds.length;
      const createdAt = new Date(startedAt.getTime() - (bookingIndex % 730) * DAY_MS);
      return {
        _id: new mongoose.Types.ObjectId(),
        recipient: customerIds[bookingIndex % customerIds.length],
        type: 'general',
        title: 'Synthetic performance notification',
        message: 'Generated for admin performance testing.',
        isRead: index % 3 !== 0,
        meta: { bookingId: bookingIds[bookingIndex] },
        createdAt,
        updatedAt: createdAt,
      };
    },
    profile.batchSize,
  );

  timings.activityLogs = await insertBatches(
    db.collection('activitylogs'),
    profile.activityLogs,
    (index) => ({
      _id: new mongoose.Types.ObjectId(),
      admin: adminId,
      action: `PERF_READ_${index % 20}`,
      details: 'Synthetic performance audit entry',
      status: index % 100 === 0 ? 'Warning' : 'Success',
      ipAddress: '127.0.0.1',
      createdAt: new Date(startedAt.getTime() - (index % 365) * DAY_MS),
      updatedAt: startedAt,
    }),
    profile.batchSize,
  );

  const indexes = {
    users: await db.collection('users').indexes(),
    bookings: await db.collection('bookings').indexes(),
    payments: await db.collection('payments').indexes(),
  };
  const manifest = {
    databaseName,
    synthetic: true,
    startedAt,
    completedAt: new Date(),
    profile,
    timings,
    indexes,
  };
  fs.writeFileSync(`${artifactsDir}/seed-manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`Synthetic performance dataset complete in ${databaseName}.`);
};

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
