process.env.NODE_ENV = 'test';
process.env.DISABLE_DEV_AUTH_FALLBACK = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');
const MaidProfile = require('../../models/MaidProfile');
const Service = require('../../models/Service');
const Booking = require('../../models/Booking');
const Payment = require('../../models/Payment');
const Notification = require('../../models/Notification');
const DispatchAttempt = require('../../models/DispatchAttempt');
const { startInstantDispatch, acceptCurrentOffer } = require('../../utils/instantDispatch');
const { startBroadcastDispatch, acceptBroadcastOffer } = require('../../utils/scheduledDispatch');
const { getDistanceMeters } = require('../../utils/maidAvailability');

const KOCHI_ZONES = [
  { name: 'Kakkanad', lat: 10.0159, lng: 76.3419 },
  { name: 'Vyttila', lat: 9.9672, lng: 76.3182 },
  { name: 'Edappally', lat: 10.0261, lng: 76.3084 },
  { name: 'Palarivattom', lat: 10.0031, lng: 76.3067 },
  { name: 'Kaloor', lat: 9.9986, lng: 76.2917 },
  { name: 'Fort Kochi', lat: 9.9653, lng: 76.242 },
  { name: 'Tripunithura', lat: 9.9497, lng: 76.3472 },
  { name: 'Aluva', lat: 10.1083, lng: 76.3516 },
];

const CUSTOMER_COUNT = 50;
const MAID_COUNT = 100;

function makeGeoPoint(lat, lng) {
  return {
    type: 'Point',
    coordinates: [lng, lat],
  };
}

function jitter(value, step) {
  return Number((value + step).toFixed(6));
}

function makeAddress(zone, index) {
  return {
    title: 'Home',
    houseName: `Flat ${index + 1}`,
    street: `${zone.name} Main Road`,
    city: 'Kochi',
    state: 'Kerala',
    pincode: `6820${String(index % 10).padStart(2, '0')}`,
    phone: `+9199000${String(index).padStart(5, '0')}`,
  };
}

async function seedScenario() {
  await mongoose.connection.dropDatabase();

  const service = await Service.create({
    name: `Scale Dispatch Service ${Date.now()}`,
    description: 'Scale simulation service',
    category: 'Home Cleaning',
    price: 699,
    estimatedTime: 90,
    whatsIncluded: ['Sweep', 'Mop', 'Dusting'],
    status: 'active',
  });

  const maids = [];
  const maidProfiles = [];
  for (let index = 0; index < MAID_COUNT; index += 1) {
    const zone = KOCHI_ZONES[index % KOCHI_ZONES.length];
    const lat = jitter(zone.lat, ((index % 5) - 2) * 0.0025);
    const lng = jitter(zone.lng, ((Math.floor(index / 5) % 5) - 2) * 0.0025);

    maids.push({
      firstName: `Maid${index}`,
      lastName: 'Scale',
      name: `Maid ${index}`,
      email: `maid-scale-${index}@zaffabit.test`,
      phone: `+9188000${String(index).padStart(5, '0')}`,
      role: 'maid',
      isVerified: true,
      referralCode: `M-SCALE-${index}`,
    });

    maidProfiles.push({
      userIndex: index,
      zone,
      lat,
      lng,
    });
  }

  const customers = [];
  const customerZoneLocations = [];
  for (let index = 0; index < CUSTOMER_COUNT; index += 1) {
    const zone = KOCHI_ZONES[index % KOCHI_ZONES.length];
    const lat = jitter(zone.lat, ((index % 4) - 1.5) * 0.0018);
    const lng = jitter(zone.lng, ((Math.floor(index / 4) % 4) - 1.5) * 0.0018);

    customers.push({
      firstName: `Customer${index}`,
      lastName: 'Scale',
      name: `Customer ${index}`,
      email: `customer-scale-${index}@zaffabit.test`,
      phone: `+9177000${String(index).padStart(5, '0')}`,
      role: 'customer',
      isVerified: true,
      referralCode: `C-SCALE-${index}`,
      addresses: [
        {
          ...makeAddress(zone, index),
          latitude: lat,
          longitude: lng,
          isDefault: true,
        },
      ],
    });
    customerZoneLocations.push({ lat, lng, zone: zone.name });
  }

  const createdMaids = await User.insertMany(maids);
  const createdCustomers = await User.insertMany(customers);

  await MaidProfile.insertMany(
    maidProfiles.map(({ userIndex, zone, lat, lng }) => ({
      user: createdMaids[userIndex]._id,
      activeStatus: 'active',
      isAvailable: true,
      isOnline: true,
      isIdentityVerified: true,
      zone: zone.name,
      rating: 4.6,
      currentLocation: makeGeoPoint(lat, lng),
      lastLocation: {
        lat,
        lng,
        lastUpdated: new Date(),
      },
      lastLocationUpdatedAt: new Date(),
    })),
  );
  await MaidProfile.syncIndexes();

  return {
    customers: createdCustomers.map((customer, index) => ({
      ...customer.toObject(),
      zoneLocation: customerZoneLocations[index],
    })),
    service,
    maids: createdMaids,
  };
}

function buildBooking({ customer, service, bookingType, scheduleDate, paid = true }) {
  return {
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
    gst: Math.round(service.price * 0.09),
    totalAmount: service.price + 29 + Math.round(service.price * 0.09),
    estimatedTime: service.estimatedTime,
    totalTime: service.estimatedTime,
    scheduleDate: scheduleDate || new Date(),
    bookingType,
    address: makeAddress(
      KOCHI_ZONES.find((zone) => zone.name === customer.zoneLocation.zone),
      0,
    ),
    location: {
      lat: customer.zoneLocation.lat,
      lng: customer.zoneLocation.lng,
    },
    status: bookingType === 'instant' ? 'pending_payment' : 'pending',
    paymentStatus: paid ? 'paid' : 'pending',
  };
}

describe('Dispatch scale simulation for Kochi zones', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('simulates 50 instant bookings across Kochi with 100 maids and assigns unique nearby maids', async () => {
    const { customers, service } = await seedScenario();

    const bookings = await Booking.insertMany(
      customers.map((customer) =>
        buildBooking({
          customer,
          service,
          bookingType: 'instant',
        }),
      ),
    );

    const assignedMaidIds = new Set();
    const assignmentDistances = [];

    for (const booking of bookings) {
      const dispatch = await startInstantDispatch(booking._id);
      expect(dispatch.available).toBe(true);
      expect(dispatch.currentOffer).toBeDefined();

      const accepted = await acceptCurrentOffer(
        booking._id,
        dispatch.currentOffer.maidId.toString(),
      );

      expect(accepted.accepted).toBe(true);
      assignedMaidIds.add(accepted.booking.maid.toString());

      const maidProfile = await MaidProfile.findOne({ user: accepted.booking.maid });
      assignmentDistances.push(
        getDistanceMeters(accepted.booking.location, maidProfile.lastLocation),
      );
    }

    const acceptedBookings = await Booking.countDocuments({
      status: 'accepted',
      bookingType: 'instant',
    });
    const unavailableMaids = await MaidProfile.countDocuments({ isAvailable: false });

    expect(acceptedBookings).toBe(CUSTOMER_COUNT);
    expect(assignedMaidIds.size).toBe(CUSTOMER_COUNT);
    expect(unavailableMaids).toBe(CUSTOMER_COUNT);
    expect(Math.max(...assignmentDistances)).toBeLessThan(10000);
  });

  it('simulates 50 scheduled bookings across Kochi and assigns unique maids through broadcast acceptance', async () => {
    const { customers, service } = await seedScenario();
    const scheduleDate = new Date(Date.now() + 3 * 60 * 60 * 1000);

    const bookings = await Booking.insertMany(
      customers.map((customer) =>
        buildBooking({
          customer,
          service,
          bookingType: 'scheduled',
          scheduleDate,
        }),
      ),
    );

    const payments = bookings.map((booking) => ({
      booking: booking._id,
      customer: booking.customer,
      amount: booking.totalAmount,
      status: 'captured',
      method: 'upi',
      razorpayOrderId: `scheduled-${booking._id}`,
    }));
    await Payment.insertMany(payments);

    const assignedMaidIds = new Set();

    for (const booking of bookings) {
      const dispatch = await startBroadcastDispatch(booking._id);
      expect(dispatch.success).toBe(true);
      expect(dispatch.candidateCount).toBeGreaterThan(0);

      const firstCandidate = dispatch.booking.matchingQueue[0];
      const accepted = await acceptBroadcastOffer(booking._id, firstCandidate.maidId.toString());
      expect(accepted.accepted).toBe(true);
      assignedMaidIds.add(accepted.booking.maid.toString());
    }

    const acceptedBookings = await Booking.countDocuments({
      status: 'accepted',
      bookingType: 'scheduled',
    });
    expect(acceptedBookings).toBe(CUSTOMER_COUNT);
    expect(assignedMaidIds.size).toBe(CUSTOMER_COUNT);
  });

  it('covers edge cases: no free local maids, busy-maid exclusion, and scheduled hold when no candidates exist', async () => {
    const { customers, service } = await seedScenario();
    const localCustomer = customers[0];

    const firstInstant = await Booking.create(
      buildBooking({
        customer: localCustomer,
        service,
        bookingType: 'instant',
      }),
    );
    const firstDispatch = await startInstantDispatch(firstInstant._id);
    const firstAccepted = await acceptCurrentOffer(
      firstInstant._id,
      firstDispatch.currentOffer.maidId.toString(),
    );
    expect(firstAccepted.accepted).toBe(true);

    const secondInstant = await Booking.create(
      buildBooking({
        customer: localCustomer,
        service,
        bookingType: 'instant',
      }),
    );
    const secondDispatch = await startInstantDispatch(secondInstant._id);
    expect(secondDispatch.available).toBe(true);
    expect(secondDispatch.currentOffer.maidId.toString()).not.toBe(
      firstAccepted.booking.maid.toString(),
    );

    const remoteCustomer = customers[1];
    const remoteInstant = await Booking.create({
      ...buildBooking({
        customer: remoteCustomer,
        service,
        bookingType: 'instant',
      }),
      location: { lat: 8.5, lng: 77.2 },
    });
    const noMaidDispatch = await startInstantDispatch(remoteInstant._id);
    expect(noMaidDispatch.available).toBe(false);
    expect(noMaidDispatch.message).toBe('No free maid available');

    const remoteScheduled = await Booking.create({
      ...buildBooking({
        customer: remoteCustomer,
        service,
        bookingType: 'scheduled',
        scheduleDate: new Date(Date.now() + 4 * 60 * 60 * 1000),
      }),
      location: { lat: 8.5, lng: 77.2 },
    });
    await Payment.create({
      booking: remoteScheduled._id,
      customer: remoteScheduled.customer,
      amount: remoteScheduled.totalAmount,
      status: 'captured',
      method: 'upi',
      razorpayOrderId: `refund-${remoteScheduled._id}`,
    });

    const scheduledDispatch = await startBroadcastDispatch(remoteScheduled._id);
    expect(scheduledDispatch.success).toBe(true);
    expect(scheduledDispatch.available).toBe(false);
    expect(scheduledDispatch.assignmentState).toBe('paid_unassigned');

    const refreshedBooking = await Booking.findById(remoteScheduled._id);
    const capturedPayment = await Payment.findOne({ booking: remoteScheduled._id });
    expect(refreshedBooking.status).toBe('paid_unassigned');
    expect(capturedPayment.status).toBe('captured');

    const failedAttempts = await DispatchAttempt.countDocuments({
      booking: remoteInstant._id,
      dispatchType: 'instant',
      event: 'failed',
    });
    expect(failedAttempts).toBeGreaterThan(0);

    const notificationsCreated = await Notification.countDocuments();
    expect(notificationsCreated).toBeGreaterThan(0);
  });
});
