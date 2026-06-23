process.env.NODE_ENV = 'test';
process.env.DISABLE_DEV_AUTH_FALLBACK = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');
const MaidProfile = require('../../models/MaidProfile');
const Service = require('../../models/Service');
const Booking = require('../../models/Booking');
const { startInstantDispatch, acceptCurrentOffer } = require('../../utils/instantDispatch');

const INFO_PARK = { name: 'Infopark', lat: 10.0112, lng: 76.355 };
const VISMAYA = { name: 'Vismaya', lat: 10.0095, lng: 76.353 };
const BASE_ADDRESS = {
  title: 'Home',
  houseName: 'Flat 1',
  street: 'Kakkanad',
  city: 'Kochi',
  state: 'Kerala',
  pincode: '682030',
  phone: '+919900000001',
};

function makeGeoPoint(lat, lng) {
  return {
    type: 'Point',
    coordinates: [lng, lat],
  };
}

function makeBooking({
  customerId,
  serviceId,
  location,
  status = 'pending_payment',
  paymentStatus = 'paid',
}) {
  return {
    customer: customerId,
    service: serviceId,
    items: [
      {
        service: serviceId,
        name: 'Hot Zone Cleaning',
        price: 699,
        duration: 90,
      },
    ],
    subtotal: 699,
    platformFee: 29,
    gst: 63,
    totalAmount: 791,
    estimatedTime: 90,
    totalTime: 90,
    scheduleDate: new Date(),
    bookingType: 'instant',
    address: BASE_ADDRESS,
    location,
    status,
    paymentStatus,
  };
}

async function seedHotZoneScenario({ busyMaidCount = 4 } = {}) {
  await mongoose.connection.dropDatabase();

  const service = await Service.create({
    name: `Concurrency Service ${Date.now()}`,
    description: 'Instant dispatch concurrency simulation',
    category: 'Home Cleaning',
    price: 699,
    estimatedTime: 90,
    whatsIncluded: ['Sweep', 'Mop'],
    status: 'active',
  });

  const customers = await User.insertMany([
    {
      firstName: 'Info',
      lastName: 'Park',
      name: 'Infopark Customer',
      email: 'infopark.customer@zaffabit.test',
      phone: '+917700000001',
      role: 'customer',
      isVerified: true,
      referralCode: 'AR-HOTCUST1',
    },
    {
      firstName: 'Vismaya',
      lastName: 'Park',
      name: 'Vismaya Customer',
      email: 'vismaya.customer@zaffabit.test',
      phone: '+917700000002',
      role: 'customer',
      isVerified: true,
      referralCode: 'AR-HOTCUST2',
    },
  ]);

  const maids = await User.insertMany(
    Array.from({ length: 7 }).map((_, index) => ({
      firstName: `Hot${index}`,
      lastName: 'Zone',
      name: `Hot Zone Maid ${index}`,
      email: `hot.zone.maid.${index}@zaffabit.test`,
      phone: `+9188000000${index}`,
      role: 'maid',
      isVerified: true,
      referralCode: `AR-HOTMAID${index}`,
    })),
  );

  const maidLocations = [
    { lat: 10.0182, lng: 76.3712 },
    { lat: 10.017, lng: 76.3698 },
    { lat: 10.0041, lng: 76.3421 },
    { lat: 10.0018, lng: 76.339 },
    { lat: 10.0116, lng: 76.3547 }, // shared closest free maid
    { lat: 10.0138, lng: 76.3605 }, // free maid for Infopark fallback
    { lat: 10.0073, lng: 76.3496 }, // free maid for Vismaya fallback
  ];

  await MaidProfile.insertMany(
    maids.map((maid, index) => ({
      user: maid._id,
      activeStatus: 'active',
      isAvailable: index >= busyMaidCount,
      isOnline: true,
      isIdentityVerified: true,
      zone: 'Kakkanad',
      rating: 4.5,
      currentLocation: makeGeoPoint(maidLocations[index].lat, maidLocations[index].lng),
      lastLocation: {
        lat: maidLocations[index].lat,
        lng: maidLocations[index].lng,
        lastUpdated: new Date(),
      },
      lastLocationUpdatedAt: new Date(),
    })),
  );
  await MaidProfile.syncIndexes();

  if (busyMaidCount > 0) {
    await Booking.insertMany(
      maids.slice(0, busyMaidCount).map((maid, index) => ({
        ...makeBooking({
          customerId: customers[index % customers.length]._id,
          serviceId: service._id,
          location: INFO_PARK,
          status: 'accepted',
          paymentStatus: 'paid',
        }),
        maid: maid._id,
      })),
    );
  }

  return {
    service,
    customers,
    maids,
  };
}

describe('Instant dispatch concurrency simulation for Infopark and Vismaya', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('reroutes the second booking when two simultaneous requests race for the same free maid', async () => {
    const { service, customers } = await seedHotZoneScenario({ busyMaidCount: 4 });

    const [infoparkBooking, vismayaBooking] = await Booking.create([
      makeBooking({
        customerId: customers[0]._id,
        serviceId: service._id,
        location: INFO_PARK,
      }),
      makeBooking({
        customerId: customers[1]._id,
        serviceId: service._id,
        location: VISMAYA,
      }),
    ]);

    const [infoparkDispatch, vismayaDispatch] = await Promise.all([
      startInstantDispatch(infoparkBooking._id),
      startInstantDispatch(vismayaBooking._id),
    ]);

    expect(infoparkDispatch.available).toBe(true);
    expect(vismayaDispatch.available).toBe(true);
    expect(infoparkDispatch.booking.matchingQueue).toHaveLength(3);
    expect(vismayaDispatch.booking.matchingQueue).toHaveLength(3);

    const sharedFirstOffer = infoparkDispatch.currentOffer.maidId.toString();
    expect(vismayaDispatch.currentOffer.maidId.toString()).toBe(sharedFirstOffer);

    const [firstAccept, secondAccept] = await Promise.all([
      acceptCurrentOffer(infoparkBooking._id, sharedFirstOffer),
      acceptCurrentOffer(vismayaBooking._id, sharedFirstOffer),
    ]);

    const acceptedResults = [firstAccept, secondAccept].filter((result) => result.accepted);
    const reroutedResult = [firstAccept, secondAccept].find((result) => !result.accepted);

    expect(acceptedResults).toHaveLength(1);
    expect(reroutedResult.statusCode).toBe(409);
    expect(reroutedResult.message).toBe('Maid is not free. Offer moved to next maid.');
    expect(reroutedResult.dispatch.available).toBe(true);

    const searchingBooking = await Booking.findOne({ status: 'searching' });
    expect(searchingBooking).toBeTruthy();
    expect(searchingBooking.currentQueueIndex).toBe(1);
    expect(searchingBooking.matchingQueue[0].response).toBe('unavailable');

    const nextMaidId =
      searchingBooking.matchingQueue[searchingBooking.currentQueueIndex].maidId.toString();
    const fallbackAccept = await acceptCurrentOffer(searchingBooking._id, nextMaidId);
    expect(fallbackAccept.accepted).toBe(true);

    const scenarioAcceptedBookings = await Booking.find({
      _id: { $in: [infoparkBooking._id, vismayaBooking._id] },
      status: 'accepted',
      maid: { $exists: true },
    }).select('maid');
    expect(scenarioAcceptedBookings).toHaveLength(2);

    const scenarioAcceptedMaids = scenarioAcceptedBookings.map((booking) =>
      booking.maid.toString(),
    );
    expect(new Set(scenarioAcceptedMaids).size).toBe(2);
  });

  it('keeps the second paid instant booking pending assignment when only one free maid exists', async () => {
    const { service, customers } = await seedHotZoneScenario({ busyMaidCount: 6 });

    const [infoparkBooking, vismayaBooking] = await Booking.create([
      makeBooking({
        customerId: customers[0]._id,
        serviceId: service._id,
        location: INFO_PARK,
      }),
      makeBooking({
        customerId: customers[1]._id,
        serviceId: service._id,
        location: VISMAYA,
      }),
    ]);

    const [infoparkDispatch, vismayaDispatch] = await Promise.all([
      startInstantDispatch(infoparkBooking._id),
      startInstantDispatch(vismayaBooking._id),
    ]);

    expect(infoparkDispatch.available).toBe(true);
    expect(vismayaDispatch.available).toBe(true);
    expect(infoparkDispatch.currentOffer.maidId.toString()).toBe(
      vismayaDispatch.currentOffer.maidId.toString(),
    );

    const [firstAccept, secondAccept] = await Promise.all([
      acceptCurrentOffer(infoparkBooking._id, infoparkDispatch.currentOffer.maidId.toString()),
      acceptCurrentOffer(vismayaBooking._id, vismayaDispatch.currentOffer.maidId.toString()),
    ]);

    const pendingAssignment = [firstAccept, secondAccept].find((result) => !result.accepted);
    expect(pendingAssignment.statusCode).toBe(200);
    expect(pendingAssignment.message).toBe('No free maid available');
    expect(pendingAssignment.dispatch.available).toBe(false);
    expect(pendingAssignment.dispatch.assignmentState).toBe('pending_assignment');
    expect(pendingAssignment.dispatch.booking.status).toBe('searching');
  });
});
