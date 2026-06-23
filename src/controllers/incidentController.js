const Incident = require('../models/Incident');
const Booking = require('../models/Booking');
const { sendResponse, sendError } = require('../utils/apiResponse');

// Seed data for clean out-of-the-box command layouts
const SEED_INCIDENTS = [
  {
    incidentId: '#INC-4831',
    user: 'Jordan Smith',
    userRole: 'customer',
    type: 'SOS Panic Button Triggered',
    location: 'Financial Dist. Block C, 9.9816, 76.2999',
    lastLocation: 'Financial Dist. Block B, 9.9802, 76.2985',
    priority: 'critical',
    status: 'active',
    reporterPhone: '+91 98765 43210',
    description:
      'Zone 4 Main Entrance. Panic button triggered by user due to suspicious activity reported near clean zone.',
  },
  {
    incidentId: '#INC-4829',
    user: 'Marcus Aurelius',
    userRole: 'maid',
    type: 'Late Provider Alert',
    location: 'Central Park North, 9.9850, 76.3020',
    lastLocation: 'Central Park South, 9.9830, 76.3005',
    priority: 'low',
    status: 'resolved',
    reporterPhone: '+91 99887 76655',
    description:
      'Scheduled shift for booking #B-4921 started 25 minutes past arrival threshold due to localized transit delays.',
    resolvedBy: 'Operations Admin',
  },
  {
    incidentId: '#INC-4827',
    user: 'Marcus Aurelius',
    userRole: 'maid',
    type: 'Late Provider Alert',
    location: 'Central Park North, 9.9850, 76.3020',
    lastLocation: 'Central Park South, 9.9830, 76.3005',
    priority: 'low',
    status: 'resolved',
    reporterPhone: '+91 99887 76655',
    description:
      'Scheduled shift for booking #B-4921 started 25 minutes past arrival threshold due to localized transit delays.',
    resolvedBy: 'Operations Admin',
  },
  {
    incidentId: '#INC-4825',
    user: 'Marcus Aurelius',
    userRole: 'maid',
    type: 'Late Provider Alert',
    location: 'Central Park North, 9.9850, 76.3020',
    lastLocation: 'Central Park South, 9.9830, 76.3005',
    priority: 'low',
    status: 'resolved',
    reporterPhone: '+91 99887 76655',
    description:
      'Scheduled shift for booking #B-4921 started 25 minutes past arrival threshold due to localized transit delays.',
    resolvedBy: 'Operations Admin',
  },
];

/**
 * @desc    Get all active/resolved safety incidents
 * @route   GET /api/v1/admin/incidents
 */
exports.getIncidents = async (req, res, next) => {
  try {
    let incidents = await Incident.find().sort({ createdAt: -1 });

    // Auto-seed if database contains fewer than 3 incidents so operations screen is never empty
    if (incidents.length < 3) {
      await Incident.insertMany(SEED_INCIDENTS);
      incidents = await Incident.find().sort({ createdAt: -1 });
    }

    return sendResponse(res, 200, 'Operations incident command logs synced.', { incidents });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Resolve an open incident
 * @route   PATCH /api/v1/admin/incidents/:id/resolve
 */
exports.resolveIncident = async (req, res, next) => {
  try {
    const adminUser = req.user;
    const incident = await Incident.findById(req.params.id);

    if (!incident) {
      return sendError(res, 404, 'Incident ticket not found');
    }

    incident.status = 'resolved';
    incident.resolvedBy = adminUser.name || adminUser.email || 'System Admin';
    await incident.save();

    console.warn(
      `[INCIDENT COMMAND] Incident ${incident.incidentId} marked RESOLVED by admin ${adminUser.email}!`,
    );

    return sendResponse(res, 200, 'Incident status updated to resolved.', { incident });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Trigger active SOS Incident (User/App)
 * @route   POST /api/v1/support/sos
 */
exports.triggerSOS = async (req, res, next) => {
  try {
    const user = req.user;

    // Generate a random unique incident reference number
    const incidentId = `#INC-${Math.floor(1000 + Math.random() * 9000)}`;

    const { bookingId, latitude, longitude, message } = req.body;
    let locationStr = 'Active Mobile GPS Tracker';
    let lastLocationStr = 'Active Mobile GPS Tracker';

    let booking = null;
    if (bookingId) {
      booking = await Booking.findById(bookingId);
    }
    if (!booking) {
      // Find the most recent active booking for this user
      booking = await Booking.findOne({
        $or: [{ customer: user._id }, { maid: user._id }],
        status: { $in: ['accepted', 'in_transit', 'arrived', 'ongoing'] },
      }).sort('-createdAt');
    }
    if (!booking) {
      // Find any most recent booking
      booking = await Booking.findOne({
        $or: [{ customer: user._id }, { maid: user._id }],
      }).sort('-createdAt');
    }

    let bookingAddrStr = '';
    let bookingCoordsStr = '';
    if (booking) {
      const addrParts = [];
      if (booking.address) {
        if (booking.address.houseName) addrParts.push(booking.address.houseName);
        if (booking.address.street) addrParts.push(booking.address.street);
        if (booking.address.landmark) addrParts.push(`Near ${booking.address.landmark}`);
        if (booking.address.city) addrParts.push(booking.address.city);
        if (booking.address.state) addrParts.push(booking.address.state);
        if (booking.address.pincode) addrParts.push(booking.address.pincode);
      }
      bookingAddrStr = addrParts.join(', ');

      if (booking.location && booking.location.lat && booking.location.lng) {
        bookingCoordsStr = `GPS: ${booking.location.lat}, ${booking.location.lng}`;
      }
    }

    if (latitude && longitude) {
      const distressCoordsStr = `${latitude}, ${longitude}`;
      lastLocationStr = `Distress GPS: ${distressCoordsStr}`;

      if (bookingAddrStr) {
        locationStr = `${bookingAddrStr} (Distress GPS: ${distressCoordsStr})`;
      } else if (user.addresses && user.addresses.length > 0) {
        const defaultAddr = user.addresses.find((a) => a.isDefault) || user.addresses[0];
        const userAddrParts = [];
        if (defaultAddr.houseName) userAddrParts.push(defaultAddr.houseName);
        if (defaultAddr.street) userAddrParts.push(defaultAddr.street);
        if (defaultAddr.city) userAddrParts.push(defaultAddr.city);
        const userAddrStr = userAddrParts.join(', ');
        locationStr = `${userAddrStr} (Distress GPS: ${distressCoordsStr})`;
      } else {
        locationStr = `Distress Coordinates (${distressCoordsStr})`;
      }
    } else {
      if (bookingAddrStr) {
        locationStr = bookingAddrStr;
        lastLocationStr = bookingCoordsStr || bookingAddrStr;
      } else if (user.addresses && user.addresses.length > 0) {
        const defaultAddr = user.addresses.find((a) => a.isDefault) || user.addresses[0];
        const userAddrParts = [];
        if (defaultAddr.houseName) userAddrParts.push(defaultAddr.houseName);
        if (defaultAddr.street) userAddrParts.push(defaultAddr.street);
        if (defaultAddr.city) userAddrParts.push(defaultAddr.city);
        const userAddrStr = userAddrParts.join(', ');
        locationStr = userAddrStr;
        if (defaultAddr.latitude && defaultAddr.longitude) {
          lastLocationStr = `Saved GPS: ${defaultAddr.latitude}, ${defaultAddr.longitude}`;
        } else {
          lastLocationStr = userAddrStr;
        }
      } else {
        locationStr = 'Active Mobile GPS Tracker';
        lastLocationStr = 'Active Mobile GPS Tracker';
      }
    }

    const newSos = await Incident.create({
      incidentId,
      user: user.name || user.phone,
      userRole: user.role || 'customer',
      type: 'SOS Panic Button Triggered',
      location: locationStr,
      lastLocation: lastLocationStr,
      priority: 'critical',
      status: 'active',
      reporterPhone: user.phone || 'Unknown Phone',
      description:
        message ||
        `Panic distress alert triggered from mobile application interface by user ${user.phone || user.name || user._id}.`,
    });

    console.warn(
      `[EMERGENCY SOS] Incident ${incidentId} logged inside database for ${user.phone || user.name || user._id}!`,
    );

    return sendResponse(res, 200, 'SOS Alert registered. Operations response is en-route.', {
      incident: newSos,
      emergencyContacts: [
        { name: 'Police Dispatch', number: '100' },
        { name: 'Medical Emergency', number: '102' },
        { name: 'Zafabit Crisis Team', number: '999-888-7777' },
      ],
    });
  } catch (error) {
    next(error);
  }
};
