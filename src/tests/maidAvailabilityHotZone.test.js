process.env.NODE_ENV = 'test';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const MaidProfile = require('../models/MaidProfile');
const Service = require('../models/Service');
const Booking = require('../models/Booking');
const { findAvailableMaids } = require('../utils/maidAvailability');

const INFO_PARK = { lat: 10.0106, lng: 76.3624 };

function makeGeoPoint(lat, lng) {
  return {
    type: 'Point',
    coordinates: [lng, lat],
  };
}

async function seedAvailabilityScenario() {
  await mongoose.connection.dropDatabase();

  const service = await Service.create({
    name: `Availability Service ${Date.now()}`,
    description: 'Availability filtering test',
    category: 'Home Cleaning',
    price: 699,
    estimatedTime: 90,
    whatsIncluded: ['Sweep'],
    status: 'active',
  });

  const customer = await User.create({
    firstName: 'Hot',
    lastName: 'Zone',
    name: 'Hot Zone Customer',
    email: 'hotzone.customer@zaffabit.test',
    phone: '+917700000099',
    role: 'customer',
    isVerified: true,
    referralCode: 'AR-AVAILC1',
  });

  const maids = await User.insertMany(
    Array.from({ length: 7 }).map((_, index) => ({
      firstName: `Avail${index}`,
      lastName: 'Maid',
      name: `Availability Maid ${index}`,
      email: `availability.maid.${index}@zaffabit.test`,
      phone: `+9188111100${index}`,
      role: 'maid',
      isVerified: true,
      referralCode: `AR-AVAILM${index}`,
    })),
  );

  const locations = [
    { lat: 10.011, lng: 76.363 },
    { lat: 10.012, lng: 76.364 },
    { lat: 10.013, lng: 76.365 },
    { lat: 10.014, lng: 76.366 },
    { lat: 10.015, lng: 76.367 },
    { lat: 10.0092, lng: 76.3501 },
    { lat: 10.0075, lng: 76.3488 },
  ];

  await MaidProfile.insertMany(
    maids.map((maid, index) => ({
      user: maid._id,
      activeStatus: 'active',
      isAvailable: index >= 4,
      isOnline: true,
      isIdentityVerified: true,
      currentLocation: makeGeoPoint(locations[index].lat, locations[index].lng),
      lastLocation: {
        lat: locations[index].lat,
        lng: locations[index].lng,
        lastUpdated: new Date(),
      },
      lastLocationUpdatedAt: new Date(),
    })),
  );
  await MaidProfile.syncIndexes();

  await Booking.insertMany(
    maids.slice(0, 4).map((maid, index) => ({
      customer: customer._id,
      maid: maid._id,
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
      location: INFO_PARK,
      status: ['accepted', 'in_transit', 'arrived', 'ongoing'][index],
      paymentStatus: 'paid',
    })),
  );

  return { maids };
}

describe('Maid availability in hot zones', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('returns only the 3 free maids when 4 of 7 maids are already busy', async () => {
    const { maids } = await seedAvailabilityScenario();

    const availability = await findAvailableMaids({
      ...INFO_PARK,
      estimatedDurationMinutes: 90,
    });

    expect(availability.available).toBe(true);
    expect(availability.count).toBe(3);
    expect(availability.maids.map((maid) => maid.maidId.toString())).toEqual([
      maids[4]._id.toString(),
      maids[5]._id.toString(),
      maids[6]._id.toString(),
    ]);
  });
});
