require('dotenv').config();
const mongoose = require('mongoose');
const { io } = require('socket.io-client');
const User = require('../models/User');
const Service = require('../models/Service');
const Booking = require('../models/Booking');
const MaidProfile = require('../models/MaidProfile');
const { getDirectionsRoute } = require('../utils/location');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cleaningService';
const PORT = process.env.PORT || 5001;
const SOCKET_URL = `http://localhost:${PORT}`;

function decodePolyline(str) {
  let index = 0,
    len = str.length;
  let lat = 0,
    lng = 0;
  const coordinates = [];
  while (index < len) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    coordinates.push({ lat: lat / 100000, lng: lng / 100000 });
  }
  return coordinates;
}

function interpolatePoints(start, end, steps = 10) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    points.push({
      lat: start.lat + (end.lat - start.lat) * fraction,
      lng: start.lng + (end.lng - start.lng) * fraction,
    });
  }
  return points;
}

async function runSimulation() {
  console.log('🚀 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB.');

  // 1. Seed / Fetch Customer
  let customer = await User.findOne({ email: 'simulator-customer@zaffabit.com' });
  if (!customer) {
    customer = await User.create({
      firstName: 'Simulated',
      lastName: 'Customer',
      email: 'simulator-customer@zaffabit.com',
      phone: '9876543210',
      role: 'customer',
      isVerified: true,
    });
    console.log('✅ Created simulator customer.');
  } else {
    console.log('ℹ️ Found existing simulator customer.');
  }

  // 2. Seed / Fetch Maid
  let maid = await User.findOne({ email: 'simulator-maid@zaffabit.com' });
  if (!maid) {
    maid = await User.create({
      firstName: 'Simulated',
      lastName: 'Maid',
      email: 'simulator-maid@zaffabit.com',
      phone: '8765432109',
      role: 'maid',
      isVerified: true,
    });
    console.log('✅ Created simulator maid user.');
  } else {
    console.log('ℹ️ Found existing simulator maid user.');
  }

  // Ensure MaidProfile exists and is active/online
  let maidProfile = await MaidProfile.findOne({ user: maid._id });
  if (!maidProfile) {
    maidProfile = await MaidProfile.create({
      user: maid._id,
      activeStatus: 'active',
      isAvailable: true,
      isOnline: true,
    });
    console.log('✅ Created active MaidProfile.');
  } else {
    maidProfile.activeStatus = 'active';
    maidProfile.isAvailable = true;
    maidProfile.isOnline = true;
    await maidProfile.save();
    console.log('✅ Activated existing MaidProfile.');
  }

  // 3. Seed / Fetch Service
  let service = await Service.findOne({ name: 'Instant Simulation Service' });
  if (!service) {
    service = await Service.create({
      name: 'Instant Simulation Service',
      description: 'Provides live coordinates stream and OTP live updates in simulator.',
      category: 'Deep Cleaning',
      price: 499,
      estimatedTime: 60,
      status: 'active',
    });
    console.log('✅ Created simulation service.');
  } else {
    console.log('ℹ️ Found existing simulation service.');
  }

  // 4. Create Booking (Destination Kakkanad, Maid NGO Quarters area)
  const customerLoc = { lat: 9.9816, lng: 76.3213 };
  const initialMaidLoc = { lat: 9.998, lng: 76.353 };

  const startOtp = Math.floor(1000 + Math.random() * 9000).toString();

  const booking = await Booking.create({
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
    gst: 0,
    totalAmount: service.price + 29,
    address: {
      title: 'Home',
      houseName: 'Zaffabit Kakkanad Apt',
      street: 'Infopark Road',
      city: 'Kochi',
      pincode: '682030',
      state: 'Kerala',
      phone: customer.phone,
    },
    scheduleDate: new Date(),
    bookingType: 'instant',
    status: 'accepted',
    paymentStatus: 'paid',
    startOtp,
    location: customerLoc,
    lastMaidLocation: initialMaidLoc,
    isNearbyNotificationSent: false,
  });

  console.log(`\n🎉 Created Instant Booking!`);
  console.log(`   - ID: ${booking._id}`);
  console.log(`   - Customer: ${customer.firstName} ${customer.lastName} (${customer.email})`);
  console.log(`   - Maid: ${maid.firstName} ${maid.lastName} (${maid.email})`);
  console.log(`   - Start OTP: ${startOtp}`);
  console.log(`   - Customer Destination: Lat ${customerLoc.lat}, Lng ${customerLoc.lng}`);
  console.log(`   - Initial Maid Location: Lat ${initialMaidLoc.lat}, Lng ${initialMaidLoc.lng}`);

  // Fetch Google directions polyline
  console.log('\n🗺️ Fetching Google Directions routing path...');
  let pathPoints = [];
  try {
    const route = await getDirectionsRoute(initialMaidLoc, customerLoc);
    if (route && route.routePolyline) {
      console.log(`✅ Google directions route polyline loaded successfully.`);
      const decoded = decodePolyline(route.routePolyline);
      console.log(`   - Decoded ${decoded.length} path coordinate points.`);

      // Sample 10 points evenly from the decoded polyline
      if (decoded.length > 0) {
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const index = Math.min(
            decoded.length - 1,
            Math.round((i / steps) * (decoded.length - 1)),
          );
          pathPoints.push(decoded[index]);
        }
      }
    } else {
      console.log(
        '⚠️ Google Directions returned no polyline. Falling back to straight-line interpolation.',
      );
      pathPoints = interpolatePoints(initialMaidLoc, customerLoc, 10);
    }
  } catch (err) {
    console.error('❌ Google directions lookup failed:', err.message);
    console.log('ℹ️ Falling back to straight-line interpolation.');
    pathPoints = interpolatePoints(initialMaidLoc, customerLoc, 10);
  }

  // Connect to Socket.io server
  console.log(`\n🔌 Connecting to socket server at ${SOCKET_URL}...`);
  const socket = io(SOCKET_URL, {
    transports: ['websocket'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      console.log('✅ Connected to Socket.io server.');
      resolve();
    });
  });

  // Join room
  socket.emit('join_booking', booking._id.toString());
  console.log(`👤 Client joined booking room: ${booking._id}`);

  // Stream coordinates
  console.log('\n🛰️ Starting live coordinates stream simulation...');
  for (let i = 0; i < pathPoints.length; i++) {
    const pt = pathPoints[i];
    console.log(
      `   [Step ${i + 1}/${pathPoints.length}] Maid Moving to: Lat ${pt.lat.toFixed(5)}, Lng ${pt.lng.toFixed(5)}`,
    );

    socket.emit('update_maid_location', {
      bookingId: booking._id.toString(),
      lat: pt.lat,
      lng: pt.lng,
    });

    // Wait 3 seconds between updates
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('\n🏁 Maid has arrived at customer destination! Closing connection...');
  socket.disconnect();
  await mongoose.disconnect();
  console.log('👋 Simulation complete. Goodbye!');
}

runSimulation().catch((err) => {
  console.error('❌ Simulation script error:', err);
  process.exit(1);
});
