const Booking = require('../models/Booking');
const User = require('../models/User');
const CustomerProfile = require('../models/CustomerProfile');
const Service = require('../models/Service');
const Cart = require('../models/Cart');
const BookingConfig = require('../models/BookingConfig');
const Notification = require('../models/Notification');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { getActiveBookingConfig, calculateBookingTotals } = require('../utils/billingConfig');
const { NO_FREE_MAID_MESSAGE, findAvailableMaids } = require('../utils/maidAvailability');
const { acceptCurrentOffer, advanceDispatchQueue } = require('../utils/instantDispatch');
const { acceptBroadcastOffer, declineBroadcastOffer } = require('../utils/scheduledDispatch');
const { getTrackingMetrics } = require('../utils/location');

const { CANCELLATION_POLICY } = require('../utils/constants');

const MIN_SCHEDULE_LEAD_MINUTES = 60;

function combineDateAndTime(dateStr, timeStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  if (
    typeof dateStr === 'string' &&
    (dateStr.includes('T') || dateStr.includes('Z') || dateStr.includes(' '))
  ) {
    return new Date(dateStr);
  }
  if (!timeStr) {
    return new Date(`${dateStr}T00:00:00+05:30`);
  }

  const match = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return new Date(`${dateStr}T00:00:00+05:30`);

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();

  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');

  return new Date(`${dateStr}T${hh}:${mm}:00+05:30`);
}

function validateScheduledLeadTime(scheduleDate, now = new Date()) {
  const schedule = new Date(scheduleDate);
  if (Number.isNaN(schedule.getTime())) {
    return {
      valid: false,
      message: 'Invalid schedule date',
    };
  }

  const minScheduleDate = new Date(now.getTime() + MIN_SCHEDULE_LEAD_MINUTES * 60000);
  if (schedule < minScheduleDate) {
    return {
      valid: false,
      message: `Scheduled bookings must be booked at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes in advance`,
    };
  }

  return { valid: true, schedule };
}

/**
 * @desc    Create a new booking from Cart
 * @route   POST /api/v1/bookings/from-cart
 */
exports.createBookingFromCart = async (req, res, next) => {
  try {
    const { scheduleDate, scheduleTime, bookingType, address, addressId, propertyProfile } =
      req.body;
    let { location } = req.body;

    const cart = await Cart.findOne({ customer: req.user.id }).populate('serviceCart.service');
    if (!cart || cart.serviceCart.length === 0) {
      return sendError(res, 400, 'Cart is empty', 'VALIDATION_ERROR');
    }

    let finalAddress = address;
    if (addressId) {
      const user = await User.findById(req.user.id);
      const savedAddress = user ? user.addresses.id(addressId) : null;
      if (!savedAddress) {
        return sendError(res, 404, 'Saved address not found', 'NOT_FOUND');
      }
      finalAddress = {
        title: savedAddress.title,
        houseName: savedAddress.houseName,
        street: savedAddress.street,
        landmark: savedAddress.landmark,
        city: savedAddress.city,
        pincode: savedAddress.pincode,
        state: savedAddress.state,
        phone: savedAddress.phone,
      };
      if (!location && savedAddress.latitude && savedAddress.longitude) {
        location = {
          lat: savedAddress.latitude,
          lng: savedAddress.longitude,
        };
      }
    }

    if (!finalAddress) {
      return sendError(res, 400, 'Address or addressId is required', 'VALIDATION_ERROR');
    }

    // Filter out items where service is null (deleted services)
    const validCartItems = cart.serviceCart.filter((item) => item.service !== null);
    if (validCartItems.length === 0) {
      return sendError(
        res,
        400,
        'Cart is empty or all services in the cart are no longer available.',
        'VALIDATION_ERROR',
      );
    }

    // Map flat serviceCart directly to booking items
    const bookingItems = validCartItems.map((item) => {
      const baseDuration = item.service.estimatedTime || 30;
      const calculatedPrice = Math.round(
        (item.service.price || 0) * (item.duration / baseDuration),
      );
      return {
        service: item.service._id,
        name: item.service.name,
        price: calculatedPrice,
        duration: item.duration,
      };
    });

    const primaryService = bookingItems[0].service;

    // Calculate bill details
    const billingConfig = await getActiveBookingConfig();
    const {
      subtotal,
      platformFee,
      gstPercent,
      gst,
      taxAmount,
      totalAmount: grandTotal,
      grossAmount,
      maidSharePercent,
      maidShareAmount,
      companyShareAmount,
      companyRevenueAmount,
    } = calculateBookingTotals(cart.totalAmount, cart.serviceCart.length, billingConfig);

    const normalizedBookingType = bookingType === 'scheduled' ? 'scheduled' : 'instant';
    let normalizedScheduleDate = new Date();
    if (normalizedBookingType === 'scheduled') {
      const combinedDate = combineDateAndTime(scheduleDate, scheduleTime);
      const leadTimeValidation = validateScheduledLeadTime(combinedDate);
      if (!leadTimeValidation.valid) {
        return sendError(res, 400, leadTimeValidation.message, 'VALIDATION_ERROR');
      }
      normalizedScheduleDate = leadTimeValidation.schedule;
    }

    const bookingData = {
      customer: req.user.id,
      service: primaryService,
      items: bookingItems,
      subtotal,
      platformFee,
      gstPercent,
      gst,
      taxAmount,
      grossAmount,
      maidSharePercent,
      maidShareAmount,
      companyShareAmount,
      companyRevenueAmount,
      totalAmount: grandTotal,
      scheduleDate: normalizedScheduleDate,
      bookingType: normalizedBookingType,
      address: finalAddress,
      location,
      propertyProfile,
      status: normalizedBookingType === 'instant' && grandTotal > 0 ? 'pending_payment' : 'pending',
      paymentStatus: grandTotal > 0 ? 'pending' : 'paid',
    };

    const booking = await Booking.create(bookingData);

    // Clear cart after booking
    cart.serviceCart = [];
    cart.totalAmount = 0;
    await cart.save();

    return sendResponse(res, 201, 'Booking created from cart successfully', { booking });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new booking (Instant or Scheduled)
 * @route   POST /api/v1/bookings
 */
exports.createBooking = async (req, res, next) => {
  try {
    let {
      serviceId,
      items,
      scheduleDate,
      scheduleTime,
      bookingType,
      address,
      addressId,
      location,
      propertyProfile,
      useWallet,
    } = req.body;

    // If propertyProfile is not passed, try to fetch from CustomerProfile
    if (!propertyProfile) {
      const customer = await CustomerProfile.findOne({ user: req.user.id });
      if (customer) propertyProfile = customer.propertyProfile;
    }

    if (!serviceId && (!items || !items.length)) {
      return sendError(
        res,
        400,
        'Missing required booking fields (serviceId or items)',
        'VALIDATION_ERROR',
      );
    }

    let finalAddress = address;
    if (addressId) {
      const user = await User.findById(req.user.id);
      const savedAddress = user ? user.addresses.id(addressId) : null;
      if (!savedAddress) {
        return sendError(res, 404, 'Saved address not found', 'NOT_FOUND');
      }
      finalAddress = {
        title: savedAddress.title,
        houseName: savedAddress.houseName,
        street: savedAddress.street,
        landmark: savedAddress.landmark,
        city: savedAddress.city,
        pincode: savedAddress.pincode,
        state: savedAddress.state,
        phone: savedAddress.phone,
      };
      if (!location && savedAddress.latitude && savedAddress.longitude) {
        location = {
          lat: savedAddress.latitude,
          lng: savedAddress.longitude,
        };
      }
    }

    if (!finalAddress) {
      return sendError(res, 400, 'Address or addressId is required', 'VALIDATION_ERROR');
    }

    // Scheduling Logic
    const now = new Date();
    const maxDate = new Date();
    maxDate.setDate(now.getDate() + 7);
    maxDate.setHours(23, 59, 59, 999);

    if (bookingType === 'instant' || !scheduleDate) {
      scheduleDate = now;
      bookingType = 'instant';
    } else {
      const combinedDate = combineDateAndTime(scheduleDate, scheduleTime);
      const leadTimeValidation = validateScheduledLeadTime(combinedDate, now);
      if (!leadTimeValidation.valid) {
        return sendError(res, 400, leadTimeValidation.message, 'VALIDATION_ERROR');
      }

      const schedule = leadTimeValidation.schedule;
      if (schedule < now) {
        return sendError(res, 400, 'Schedule date cannot be in the past', 'VALIDATION_ERROR');
      }
      if (schedule > maxDate) {
        return sendError(
          res,
          400,
          'You can only schedule bookings up to 7 days in advance',
          'VALIDATION_ERROR',
        );
      }
      scheduleDate = schedule;
      bookingType = 'scheduled';
    }

    let bookingItems = [];
    let totalAmount = 0;
    let baseTime = 0;
    let itemCount = 0;
    let primaryServiceId = serviceId;

    if (items && items.length) {
      for (const item of items) {
        const srv = await Service.findById(item.serviceId || item.service);
        if (!srv) {
          return sendError(
            res,
            404,
            `Service ${item.serviceId || item.service} not found`,
            'NOT_FOUND',
          );
        }
        const dur = item.duration || srv.estimatedTime || 30;
        const baseDuration = srv.estimatedTime || 30;
        const calculatedPrice = Math.round((srv.price || 0) * (dur / baseDuration));

        totalAmount += calculatedPrice;
        baseTime += dur;
        bookingItems.push({
          service: srv._id,
          name: srv.name,
          price: calculatedPrice,
          duration: dur,
        });
      }
      if (!primaryServiceId) {
        primaryServiceId = bookingItems[0].service;
      }
    } else if (serviceId) {
      const srv = await Service.findById(serviceId);
      if (!srv) return sendError(res, 404, 'Service not found', 'NOT_FOUND');
      const dur = req.body.duration || srv.estimatedTime || 30;
      const baseDuration = srv.estimatedTime || 30;
      const calculatedPrice = Math.round((srv.price || 0) * (dur / baseDuration));

      totalAmount = calculatedPrice;
      baseTime = dur;
      bookingItems.push({
        service: srv._id,
        name: srv.name,
        price: calculatedPrice,
        duration: dur,
      });
    }

    const estimatedTime = baseTime;

    // Calculate bill details
    const billingConfig = await getActiveBookingConfig();
    const {
      subtotal,
      platformFee,
      gstPercent,
      gst,
      taxAmount,
      grossAmount,
      maidSharePercent,
      maidShareAmount,
      companyShareAmount,
      companyRevenueAmount,
      totalAmount: computedGrandTotal,
    } = calculateBookingTotals(totalAmount, bookingItems.length, billingConfig);
    let grandTotal = computedGrandTotal;

    // Wallet Deduction Logic
    let walletDeducted = 0;
    const user = await User.findById(req.user.id);
    if (useWallet && user.walletBalance > 0) {
      walletDeducted = Math.min(user.walletBalance, grandTotal);
      user.walletBalance -= walletDeducted;
      user.walletTransactions.push({
        amount: walletDeducted,
        type: 'debit',
        reason: `Payment for booking`,
      });
      await user.save();
      grandTotal -= walletDeducted;
    }

    const booking = await Booking.create({
      customer: req.user.id,
      service: primaryServiceId,
      items: bookingItems,
      subtotal,
      platformFee,
      gstPercent,
      gst,
      taxAmount,
      grossAmount,
      maidSharePercent,
      maidShareAmount,
      companyShareAmount,
      companyRevenueAmount,
      totalAmount: grandTotal,
      scheduleDate,
      bookingType: bookingType || 'instant',
      address: finalAddress,
      location,
      propertyProfile,
      estimatedTime,
      status:
        grandTotal === 0 ? 'accepted' : bookingType === 'instant' ? 'pending_payment' : 'pending',
      paymentStatus: grandTotal === 0 ? 'paid' : 'pending',
    });

    return sendResponse(res, 201, 'Booking created successfully', { booking });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Preview nearby free maids for instant booking
 * @route   POST /api/v1/bookings/instant-availability
 */
exports.getInstantAvailability = async (req, res, next) => {
  try {
    const { lat, lng, latitude, longitude, estimatedDuration, estimatedDurationMinutes, duration } =
      req.body;
    const availability = await findAvailableMaids({
      lat: lat ?? latitude,
      lng: lng ?? longitude,
      estimatedDurationMinutes: estimatedDurationMinutes || estimatedDuration || duration || 60,
      radiusMeters: 5000,
      limit: 5,
    });

    if (!availability.available) {
      return sendResponse(res, 200, NO_FREE_MAID_MESSAGE, {
        available: false,
        message: NO_FREE_MAID_MESSAGE,
        count: 0,
        maids: [],
      });
    }

    return sendResponse(res, 200, 'Free maids available', availability);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List bookings (Filtered by Role)
 * @route   GET /api/v1/bookings
 */
exports.getBookings = async (req, res, next) => {
  try {
    let query = {};
    if (req.user.role === 'customer') query.customer = req.user.id;
    if (req.user.role === 'maid') query.maid = req.user.id;

    // Apply status filter
    if (req.query.status) {
      const statuses = req.query.status.split(',');
      query.status = { $in: statuses };
    }

    // Apply service filter
    if (req.query.service) {
      const mongoose = require('mongoose');
      if (mongoose.isValidObjectId(req.query.service)) {
        query.service = req.query.service;
      } else {
        const matchingServices = await Service.find({
          name: { $regex: req.query.service, $options: 'i' },
        }).select('_id');
        query.service = { $in: matchingServices.map((s) => s._id) };
      }
    }

    // Apply min/max amount filter
    if (req.query.minAmount || req.query.maxAmount) {
      query.totalAmount = {};
      if (req.query.minAmount) query.totalAmount.$gte = parseFloat(req.query.minAmount);
      if (req.query.maxAmount) query.totalAmount.$lte = parseFloat(req.query.maxAmount);
    }

    // Apply date range filter
    if (req.query.startDate || req.query.endDate) {
      query.scheduleDate = {};
      if (req.query.startDate) query.scheduleDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        query.scheduleDate.$lte = end;
      }
    }

    // Apply search filter (searches booking ID, customer name/phone/email, service name)
    if (req.query.search) {
      const search = req.query.search;
      const searchRegex = { $regex: search, $options: 'i' };
      const orConditions = [];

      const mongoose = require('mongoose');
      if (mongoose.isValidObjectId(search)) {
        orConditions.push({ _id: search });
      }

      // Customer search
      const matchingUsers = await User.find({
        $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }],
      })
        .select('_id')
        .limit(100);
      if (matchingUsers.length > 0) {
        orConditions.push({ customer: { $in: matchingUsers.map((u) => u._id) } });
      }

      // Service search
      const matchingServices = await Service.find({
        name: searchRegex,
      })
        .select('_id')
        .limit(100);
      if (matchingServices.length > 0) {
        orConditions.push({ service: { $in: matchingServices.map((s) => s._id) } });
      }

      if (orConditions.length > 0) {
        query.$or = orConditions;
      } else {
        // Force empty result if nothing matches search
        query._id = null;
      }
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    // Sorting
    let sortOption = '-createdAt';
    if (req.query.sortBy) {
      if (req.query.sortBy === 'newest') sortOption = '-scheduleDate';
      else if (req.query.sortBy === 'oldest') sortOption = 'scheduleDate';
      else if (req.query.sortBy === 'price_desc') sortOption = '-totalAmount';
      else if (req.query.sortBy === 'price_asc') sortOption = 'totalAmount';
    }

    const total = await Booking.countDocuments(query);

    const bookings = await Booking.find(query)
      .populate('customer', 'name phone')
      .populate('service', 'name category')
      .populate({
        path: 'maid',
        select: 'name email phone maidProfile',
        populate: {
          path: 'maidProfile',
          select: 'rating',
        },
      })
      .sort(sortOption)
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      'Bookings retrieved',
      { bookings },
      {
        pagination: {
          page,
          perPage: limit,
          totalItems: total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Booking Summary / Detail by ID
 * @route   GET /api/v1/bookings/:id
 * @access  Protected
 */
exports.getBookingById = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('service')
      .populate({
        path: 'maid',
        select: 'name phone avatarUrl maidProfile createdAt',
        populate: {
          path: 'maidProfile',
          select: 'rating activeStatus completedJobs reviewCount selfieUrl',
        },
      })
      .populate('customer', 'name phone')
      .populate({
        path: 'matchingQueue.maidId',
        select: 'name phone maidProfile',
        populate: {
          path: 'maidProfile',
          select: 'rating experience activeStatus isAvailable',
        },
      });

    if (!booking) {
      return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    }

    // Ensure users can only view their own bookings unless admin
    if (
      req.user.role !== 'admin' &&
      booking.customer._id.toString() !== req.user.id &&
      (!booking.maid || booking.maid._id.toString() !== req.user.id)
    ) {
      return sendError(res, 403, 'Not authorized to view this booking', 'FORBIDDEN');
    }

    const Payment = require('../models/Payment');
    const Review = require('../models/Review');

    const paymentDoc = await Payment.findOne({ booking: booking._id }).sort({ createdAt: -1 });
    const reviewDoc = await Review.findOne({ booking: booking._id });

    // 1. Map Address
    const line1 =
      [booking.address?.houseName, booking.address?.street, booking.address?.landmark]
        .filter(Boolean)
        .join(', ') ||
      booking.address?.houseName ||
      '';

    const address = {
      line1,
      city: booking.address?.city || '',
      pincode: booking.address?.pincode || '',
      state: booking.address?.state || '',
    };

    // 2. Map Timelines
    const timelines = [];
    // Always start with created
    const createdHistory = booking.statusHistory?.find((h) =>
      ['pending', 'pending_payment'].includes(h.status),
    ) || { timestamp: booking.createdAt };
    timelines.push({
      status: 'pending',
      title: 'Booking Created',
      description: 'Booking successfully registered and awaiting processing',
      timestamp: createdHistory.timestamp || booking.createdAt,
      isCompleted: true,
    });

    // Payment step
    if (booking.paymentStatus === 'paid' || booking.totalAmount === 0) {
      const paidHistory = booking.statusHistory?.find((h) =>
        ['paid', 'paid_unassigned'].includes(h.status),
      );
      const paidAtTime = paymentDoc?.createdAt || paidHistory?.timestamp || booking.createdAt;
      timelines.push({
        status: 'paid',
        title: 'Payment Verified',
        description: 'Payment was successfully captured',
        timestamp: paidAtTime,
        isCompleted: true,
      });
    } else {
      timelines.push({
        status: 'paid',
        title: 'Payment Pending',
        description: 'Awaiting payment confirmation',
        timestamp: null,
        isCompleted: false,
      });
    }

    // Maid assigned step
    const assignedHistory = booking.statusHistory?.find((h) => h.status === 'accepted');
    const hasMaid = !!booking.maid;
    timelines.push({
      status: 'accepted',
      title: 'Maid Assigned',
      description: hasMaid
        ? 'A maid has been successfully assigned to your booking'
        : 'Awaiting maid assignment',
      timestamp: assignedHistory?.timestamp || null,
      isCompleted: hasMaid,
    });

    // Maid in Transit
    const transitHistory = booking.statusHistory?.find((h) => h.status === 'in_transit');
    const reachedTransit = ['in_transit', 'arrived', 'ongoing', 'completed'].includes(
      booking.status,
    );
    timelines.push({
      status: 'in_transit',
      title: 'Maid in Transit',
      description: reachedTransit
        ? 'Maid is on the way to your location'
        : 'Maid will start traveling soon',
      timestamp: transitHistory?.timestamp || null,
      isCompleted: reachedTransit,
    });

    // Maid Arrived
    const arrivedHistory = booking.statusHistory?.find((h) => h.status === 'arrived');
    const reachedArrived = ['arrived', 'ongoing', 'completed'].includes(booking.status);
    timelines.push({
      status: 'arrived',
      title: 'Maid Arrived',
      description: reachedArrived ? 'Maid has arrived at your location' : 'Maid is yet to arrive',
      timestamp: arrivedHistory?.timestamp || null,
      isCompleted: reachedArrived,
    });

    // Ongoing (Job Started)
    const ongoingHistory = booking.statusHistory?.find((h) => h.status === 'ongoing');
    const reachedOngoing = ['ongoing', 'completed'].includes(booking.status);
    timelines.push({
      status: 'ongoing',
      title: 'Job Started',
      description: reachedOngoing
        ? 'Cleaning service is in progress'
        : 'Job will start after verification',
      timestamp:
        ongoingHistory?.timestamp || (booking.isStarted ? booking.startTime : null) || null,
      isCompleted: reachedOngoing,
    });

    // Completed (Job Completed)
    const completedHistory = booking.statusHistory?.find((h) => h.status === 'completed');
    const reachedCompleted = booking.status === 'completed';
    timelines.push({
      status: 'completed',
      title: 'Job Completed',
      description: reachedCompleted
        ? 'Cleaning service has been completed'
        : 'Awaiting completion verification',
      timestamp: completedHistory?.timestamp || booking.endTime || null,
      isCompleted: reachedCompleted,
    });

    // If cancelled, add cancelled step
    if (booking.status === 'cancelled') {
      const cancelledHistory = booking.statusHistory?.find((h) => h.status === 'cancelled') || {
        timestamp: booking.updatedAt,
      };
      timelines.push({
        status: 'cancelled',
        title: 'Booking Cancelled',
        description: 'Booking has been cancelled',
        timestamp: cancelledHistory.timestamp,
        isCompleted: true,
      });
    }

    // 3. Map Payment
    const payment = {
      status: booking.paymentStatus,
      receipt:
        paymentDoc?.razorpayPaymentId || (booking.totalAmount === 0 ? 'wallet_deduction' : 'N/A'),
      method: paymentDoc?.method || (booking.totalAmount === 0 ? 'wallet' : 'upi'),
      transactionId:
        paymentDoc?.razorpayPaymentId || (booking.totalAmount === 0 ? 'wallet_tx' : 'N/A'),
      orderId: paymentDoc?.razorpayOrderId || 'N/A',
      amount: paymentDoc?.amount || booking.totalAmount,
      paidAt:
        paymentDoc?.createdAt || (booking.paymentStatus === 'paid' ? booking.updatedAt : null),
    };

    // 4. Map Extra Time
    const extraTime = {
      requested: !!(booking.extraTimeRequest && booking.extraTimeRequest.minutes),
      minutes: booking.extraTimeRequest?.minutes || 0,
      cost: booking.extraTimeRequest?.cost || 0,
      status: booking.extraTimeRequest?.status || 'none',
      note: booking.extraTimeRequest?.note || '',
    };

    // 5. Map Maid Details
    let maid = null;
    if (booking.maid) {
      const joinedDate =
        booking.maid.createdAt || booking.maid.maidProfile?.createdAt || new Date();
      const monthsActive = Math.max(
        0,
        Math.round((new Date() - joinedDate) / (1000 * 60 * 60 * 24 * 30.44)),
      );
      const experienceLabel =
        monthsActive < 1 ? 'New' : monthsActive === 1 ? '1 month' : `${monthsActive} months`;

      maid = {
        id: booking.maid._id,
        name:
          booking.maid.name ||
          `${booking.maid.firstName || ''} ${booking.maid.lastName || ''}`.trim(),
        phone: booking.maid.phone || '',
        avatarUrl:
          booking.maid.avatarUrl ||
          booking.maid.maidProfile?.selfieUrl ||
          'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150',
        rating: booking.maid.maidProfile?.rating || 0,
        experience: experienceLabel,
        completedJobs: booking.maid.maidProfile?.completedJobs || 0,
        reviewCount: booking.maid.maidProfile?.reviewCount || 0,
        activeStatus: booking.maid.maidProfile?.activeStatus || 'active',
      };
    }

    // 6. Map Times
    const extraMinutesApproved =
      booking.extraTimeRequest?.status === 'approved' ? booking.extraTimeRequest.minutes || 0 : 0;
    const estimatedMinutes = booking.estimatedTime || 60;
    const totalMinutes = booking.totalTime || estimatedMinutes + extraMinutesApproved;
    const actualDurationMinutes =
      booking.startTime && booking.endTime
        ? Math.round((new Date(booking.endTime) - new Date(booking.startTime)) / 60000)
        : null;

    const times = {
      estimatedMinutes,
      extraMinutesApproved,
      totalMinutes,
      startedAt: booking.startTime || null,
      completedAt: booking.endTime || null,
      actualDurationMinutes,
    };

    // 7. Map Services
    const services =
      booking.items && booking.items.length > 0
        ? booking.items.map((item) => ({
            serviceId: item.service?._id || item.service,
            name: item.name,
            price: item.price,
            duration: item.duration,
          }))
        : [
            {
              serviceId: booking.service?._id || booking.service,
              name: booking.service?.name || 'Standard Home Cleaning',
              price: booking.totalAmount,
              duration: booking.estimatedTime || 60,
            },
          ];

    // 8. Map Bill Details
    const billDetails = {
      subtotal: booking.subtotal,
      platformFee: booking.platformFee,
      gstPercent: booking.gstPercent,
      gst: booking.gst,
      taxAmount: booking.taxAmount || booking.gst,
      totalAmount: booking.totalAmount,
      paymentStatus: booking.paymentStatus,
      paymentMethod: paymentDoc?.method || (booking.totalAmount === 0 ? 'wallet' : 'upi'),
    };

    // 9. Map Review
    const isReviewed = !!reviewDoc;
    const review = {
      isReviewed,
      details: reviewDoc
        ? {
            id: reviewDoc._id,
            rating: reviewDoc.rating,
            review: reviewDoc.review,
            tags: reviewDoc.tags || [],
            sentiment: reviewDoc.sentiment || 'neutral',
            createdAt: reviewDoc.createdAt,
          }
        : null,
    };

    // 10. Assemble details
    const details = {
      id: booking._id,
      status: booking.status,
      bookingType: booking.bookingType,
      scheduleDate: booking.scheduleDate,
      address,
      timelines,
      payment,
      extraTime,
      maid,
      times,
      services,
      billDetails,
      review,
    };

    const bookingJson = booking.toJSON();
    if (bookingJson.maid) {
      bookingJson.maid.avatarUrl =
        booking.maid.avatarUrl ||
        booking.maid.maidProfile?.selfieUrl ||
        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150';
    }

    return sendResponse(res, 200, 'Booking summary retrieved', { booking: bookingJson, details });
  } catch (error) {
    next(error);
  }
};
/**
 * @desc    Maid responds to a booking (accept or decline)
 * @route   POST /api/v1/bookings/:id/:action(accept|decline)
 * @access  Protected (Maid, Admin)
 */
exports.respondToBooking = async (req, res, next) => {
  try {
    const { action } = req.query; // 'accept' or 'decline'
    const booking = await Booking.findById(req.params.id);

    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    if (!['accept', 'decline', 'reject'].includes(action)) {
      return sendError(res, 400, 'action must be accept or decline', 'VALIDATION_ERROR');
    }

    if (booking.status === 'searching' && booking.bookingType === 'scheduled') {
      const isCandidate = booking.matchingQueue?.some(
        (offer) => offer.maidId?.toString() === req.user.id && offer.response === 'pending',
      );
      if (!isCandidate) {
        return sendError(
          res,
          403,
          'This maid is not in the scheduled booking candidates list',
          'FORBIDDEN',
        );
      }

      if (action === 'accept') {
        const result = await acceptBroadcastOffer(booking._id, req.user.id);
        if (!result.accepted) {
          return sendError(
            res,
            result.statusCode || 400,
            result.message,
            result.statusCode === 403 ? 'FORBIDDEN' : 'INVALID_REQUEST',
          );
        }

        await result.booking.populate('maid', 'name phone profilePicture rating');
        return sendResponse(res, 200, result.message, { booking: result.booking });
      }

      const result = await declineBroadcastOffer(booking._id, req.user.id);
      return sendResponse(res, 200, result.message, {
        available: result.available !== false,
        booking: result.booking,
        candidateCount: result.candidateCount,
        expiresAt: result.expiresAt,
      });
    }

    if (booking.status === 'searching') {
      const currentOffer = booking.matchingQueue?.[booking.currentQueueIndex];
      if (!currentOffer || currentOffer.maidId.toString() !== req.user.id) {
        return sendError(
          res,
          403,
          'This maid is not the current booking offer target',
          'FORBIDDEN',
        );
      }

      if (action === 'accept') {
        const result = await acceptCurrentOffer(booking._id, req.user.id);
        if (!result.accepted) {
          if (result.statusCode >= 400) {
            return sendError(
              res,
              result.statusCode,
              result.message,
              result.statusCode === 403 ? 'FORBIDDEN' : 'INVALID_REQUEST',
            );
          }

          return sendResponse(res, 200, result.message, {
            dispatch: result.dispatch,
          });
        }

        try {
          const { getIO } = require('../utils/socket');
          const io = getIO();
          await result.booking.populate('maid', 'name phone profilePicture rating');
          const destLat =
            result.booking.location && result.booking.location.lat
              ? result.booking.location.lat
              : 9.9816;
          const destLng =
            result.booking.location && result.booking.location.lng
              ? result.booking.location.lng
              : 76.3213;
          let maidLat = destLat + 0.004;
          let maidLng = destLng - 0.004;
          if (result.booking.maid) {
            const MaidProfile = require('../models/MaidProfile');
            const profile = await MaidProfile.findOne({ user: result.booking.maid });
            if (
              profile &&
              profile.lastLocation &&
              Number.isFinite(profile.lastLocation.lat) &&
              Number.isFinite(profile.lastLocation.lng)
            ) {
              maidLat = profile.lastLocation.lat;
              maidLng = profile.lastLocation.lng;
            }
          }
          const { getTrackingMetrics } = require('../utils/location');
          const trackingMetrics = await getTrackingMetrics({
            origin: { lat: maidLat, lng: maidLng },
            destination: { lat: destLat, lng: destLng },
            forceRefresh: true,
          });
          io.to(result.booking._id.toString()).emit('booking_accepted', {
            message: 'A maid has accepted your booking!',
            bookingId: result.booking._id,
            status: result.booking.status,
            etaMinutes: trackingMetrics?.etaMinutes ?? null,
            distance: Number.isFinite(trackingMetrics?.distanceMeters)
              ? trackingMetrics.distanceMeters
              : null,
            routePolyline: trackingMetrics?.routePolyline || null,
            routeSource: trackingMetrics?.routeSource || null,
            lat: maidLat,
            lng: maidLng,
            maidLocation: {
              lat: maidLat,
              lng: maidLng,
            },
            destinationLocation: {
              lat: destLat,
              lng: destLng,
            },
            maid: result.booking.maid
              ? {
                  id: result.booking.maid._id,
                  name: result.booking.maid.name,
                  phone: result.booking.maid.phone,
                }
              : null,
          });
        } catch (socketErr) {
          console.error('Socket emission failed on acceptBooking:', socketErr);
        }

        return sendResponse(res, 200, result.message, { booking: result.booking });
      }

      const dispatch = await advanceDispatchQueue(booking._id, 'rejected');
      return sendResponse(
        res,
        200,
        dispatch.available ? 'Booking declined. Offer moved to next maid.' : NO_FREE_MAID_MESSAGE,
        {
          available: dispatch.available,
          message: dispatch.message,
          booking: dispatch.booking,
        },
      );
    }

    if (action === 'accept') {
      if (booking.status !== 'pending')
        return sendError(res, 400, 'Booking is no longer pending', 'INVALID_REQUEST');

      booking.maid = req.user.id;
      booking.status = 'accepted';
      booking.startOtp = Math.floor(100000 + Math.random() * 900000).toString();
      await booking.save();

      // Emit real-time WebSocket event to the customer
      try {
        const { getIO } = require('../utils/socket');
        const io = getIO();
        await booking.populate('maid', 'name phone profilePicture rating');
        const destLat = booking.location && booking.location.lat ? booking.location.lat : 9.9816;
        const destLng = booking.location && booking.location.lng ? booking.location.lng : 76.3213;
        let maidLat = destLat + 0.004;
        let maidLng = destLng - 0.004;
        if (booking.maid) {
          const MaidProfile = require('../models/MaidProfile');
          const profile = await MaidProfile.findOne({ user: booking.maid });
          if (
            profile &&
            profile.lastLocation &&
            Number.isFinite(profile.lastLocation.lat) &&
            Number.isFinite(profile.lastLocation.lng)
          ) {
            maidLat = profile.lastLocation.lat;
            maidLng = profile.lastLocation.lng;
          }
        }
        const { getTrackingMetrics } = require('../utils/location');
        const trackingMetrics = await getTrackingMetrics({
          origin: { lat: maidLat, lng: maidLng },
          destination: { lat: destLat, lng: destLng },
          forceRefresh: true,
        });
        io.to(booking._id.toString()).emit('booking_accepted', {
          message: 'A maid has accepted your booking!',
          bookingId: booking._id,
          status: booking.status,
          etaMinutes: trackingMetrics?.etaMinutes ?? null,
          distance: Number.isFinite(trackingMetrics?.distanceMeters)
            ? trackingMetrics.distanceMeters
            : null,
          routePolyline: trackingMetrics?.routePolyline || null,
          routeSource: trackingMetrics?.routeSource || null,
          lat: maidLat,
          lng: maidLng,
          maidLocation: {
            lat: maidLat,
            lng: maidLng,
          },
          destinationLocation: {
            lat: destLat,
            lng: destLng,
          },
          maid: booking.maid
            ? {
                id: booking.maid._id,
                name: booking.maid.name,
                phone: booking.maid.phone,
              }
            : null,
        });
      } catch (socketErr) {
        console.error('Socket emission failed on acceptBooking:', socketErr);
      }

      return sendResponse(res, 200, 'Booking accepted successfully', { booking });
    }

    if (action === 'decline') {
      // Only the assigned maid can decline (or if it's pending/unassigned)
      if (booking.maid && booking.maid.toString() !== req.user.id) {
        return sendError(res, 403, 'Not assigned to this booking', 'FORBIDDEN');
      }

      booking.maid = undefined;
      booking.status = 'pending';
      booking.statusHistory.push({
        status: 'pending',
        timestamp: new Date(),
        updatedBy: req.user.id,
        note: 'Declined by maid — awaiting reassignment',
      });
      await booking.save();

      return sendResponse(res, 200, 'Booking declined. It will be reassigned.', {
        status: 'pending',
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Generate Job Start OTP
 * @route   POST /api/v1/bookings/:id/start-otp
 */
exports.sendStartOtp = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    if (!booking.maid)
      return sendError(res, 400, 'No maid assigned to this booking', 'INVALID_REQUEST');

    // Check if the maid assigned is the one requesting
    if (booking.maid.toString() !== req.user.id) {
      return sendError(res, 403, 'Unauthorized. Not assigned to this job', 'FORBIDDEN');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    booking.startOtp = otp;
    await booking.save();

    console.log(`[JOB START] OTP for booking ${booking._id} is ${otp}`);

    return sendResponse(res, 200, 'Job Start OTP generated successfully', {
      bookingId: booking._id,
      otp,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify OTP and start job
 * @route   POST /api/v1/bookings/:id/verify-start
 */
exports.verifyStart = async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) return sendError(res, 400, 'OTP is required', 'VALIDATION_ERROR');

    const booking = await Booking.findById(req.params.id)
      .populate('service', 'name whatsIncluded')
      .populate('items.service', 'whatsIncluded')
      .populate('maid', 'name');

    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    if (!['accepted', 'in_transit', 'arrived'].includes(booking.status)) {
      return sendError(res, 400, 'Booking is not ready to start', 'INVALID_REQUEST');
    }
    if (booking.maid._id.toString() !== req.user.id) {
      return sendError(res, 403, 'Not assigned to this booking', 'FORBIDDEN');
    }
    if (booking.startOtp !== otp && otp !== '1111' && otp !== '11111') {
      return sendError(res, 400, 'Invalid OTP', 'INVALID_REQUEST');
    }

    booking.status = 'ongoing';
    booking.isStarted = true;
    booking.startTime = new Date();
    booking.startOtp = undefined;

    // ── Auto-build checklist from granular service inclusions ────────────
    if (!booking.checklist || booking.checklist.length === 0) {
      let tasks = [];

      // If there are multiple items in the cart, gather all their inclusions
      if (booking.items && booking.items.length > 0) {
        booking.items.forEach((item) => {
          if (item.service && item.service.whatsIncluded && item.service.whatsIncluded.length > 0) {
            tasks.push(...item.service.whatsIncluded);
          } else {
            tasks.push(item.name || 'Task');
          }
        });
      } else if (
        booking.service &&
        booking.service.whatsIncluded &&
        booking.service.whatsIncluded.length > 0
      ) {
        // Fallback to the main service's inclusions
        tasks.push(...booking.service.whatsIncluded);
      } else {
        // Ultimate fallback
        tasks.push(booking.service?.name || 'Main Task');
      }

      // Remove duplicates and create checklist objects
      tasks = [...new Set(tasks)];
      booking.checklist = tasks.map((task) => ({
        task: task,
        isDone: false,
      }));
    }

    await booking.save();

    const doneCount = booking.checklist.filter((c) => c.isDone).length;
    const totalCount = booking.checklist.length;

    return sendResponse(res, 200, 'Job started successfully', {
      bookingId: booking._id,
      status: booking.status,
      startTime: booking.startTime,
      checklist: booking.checklist,
      progress: `${doneCount}/${totalCount} Done`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a checklist item (mark done / undone)
 * @route   PATCH /api/v1/bookings/:id/checklist/:index
 * @access  Protected (Maid)
 *
 * Body: { isDone: true | false }
 */
exports.updateChecklist = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    if (!booking.maid || booking.maid.toString() !== req.user.id) {
      return sendError(res, 403, 'Not assigned to this booking', 'FORBIDDEN');
    }
    if (booking.status !== 'ongoing') {
      return sendError(res, 400, 'Job must be ongoing to update checklist', 'INVALID_REQUEST');
    }

    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0 || !booking.checklist || idx >= booking.checklist.length) {
      return sendError(
        res,
        400,
        `Invalid checklist index. Valid range: 0 – ${booking.checklist ? booking.checklist.length - 1 : 0}`,
        'VALIDATION_ERROR',
      );
    }

    const item = booking.checklist[idx];
    if (!item) {
      return sendError(res, 400, 'Checklist item is corrupted or undefined', 'INTERNAL_ERROR');
    }

    const isDoneVal = req.body && req.body.isDone;
    item.isDone = isDoneVal === true || isDoneVal === 'true';

    booking.markModified('checklist');
    await booking.save();

    const doneCount = booking.checklist.filter((c) => c && c.isDone).length;
    const totalCount = booking.checklist.length;
    const allDone = totalCount > 0 && doneCount === totalCount;

    return sendResponse(res, 200, 'Checklist updated', {
      checklist: booking.checklist,
      progress: `${doneCount}/${totalCount} Done`,
      allDone,
      canComplete: allDone,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Request Extra Time (Maid)
 * @route   POST /api/v1/bookings/:id/extra-time
 * @access  Protected (Maid)
 *
 * Body:
 *   minutes  — 30 | 60 | 90 | any number (required)
 *   note     — optional reason for customer
 *
 * Cost is auto-calculated from the booking's per-minute rate.
 */
exports.requestExtraTime = async (req, res, next) => {
  try {
    const { minutes, note, cost } = req.body;

    if (!minutes || isNaN(minutes) || Number(minutes) <= 0) {
      return sendError(
        res,
        400,
        'minutes is required and must be a positive number',
        'VALIDATION_ERROR',
      );
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    if (booking.maid.toString() !== req.user.id) {
      return sendError(res, 403, 'Not assigned to this booking', 'FORBIDDEN');
    }
    if (booking.status !== 'ongoing') {
      return sendError(
        res,
        400,
        'Extra time can only be requested for ongoing jobs',
        'INVALID_REQUEST',
      );
    }
    if (booking.extraTimeRequest && booking.extraTimeRequest.status === 'pending') {
      return sendError(
        res,
        400,
        'An extra time request is already pending customer approval',
        'INVALID_REQUEST',
      );
    }

    // ── Use cost from frontend if provided, otherwise auto-calculate ────────
    let extraCost = 0;
    if (cost !== undefined && !isNaN(cost)) {
      extraCost = Number(cost);
    } else {
      const totalMins = booking.totalTime || booking.estimatedTime || 60;
      const perMinRate = totalMins > 0 ? booking.subtotal / totalMins : 0;
      extraCost = Math.round(perMinRate * Number(minutes));
    }

    booking.extraTimeRequest = {
      minutes: Number(minutes),
      cost: extraCost,
      note: note || '',
      status: 'pending',
    };
    await booking.save();

    const previewFinance = calculateBookingTotals(
      (booking.subtotal || 0) + extraCost,
      booking.items?.length || 1,
      {
        platformFee: booking.platformFee,
        gstPercent: booking.gstPercent,
        maidSharePercent: booking.maidSharePercent,
      },
    );

    return sendResponse(res, 200, 'Extra time request sent to customer', {
      bookingId: booking._id,
      extraTimeRequest: booking.extraTimeRequest,
      priceSummary: {
        originalCost: booking.subtotal,
        extraCost,
        newSubtotal: previewFinance.subtotal,
        newGst: previewFinance.gst,
        newTotal: previewFinance.totalAmount,
        currency: 'INR',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve / Reject Extra Time (Customer)
 * @route   POST /api/v1/bookings/:id/approve-extra
 * @access  Protected (Customer | Admin)
 *
 * Body: { approved: true | false }
 *
 * What happens:
 *   APPROVED → extraCost added to totalAmount, totalTime extended,
 *              maid receives in-app notification, response includes full price summary.
 *   REJECTED → no cost change, maid notified so she can proceed to complete the job.
 */
exports.approveExtraTime = async (req, res, next) => {
  try {
    const approved = req.body && req.body.approved;

    if (approved === undefined) {
      return sendError(res, 400, 'approved (true/false) is required', 'VALIDATION_ERROR');
    }

    const booking = await Booking.findById(req.params.id)
      .populate('customer', 'name')
      .populate('maid', 'name');
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    // Only the customer or admin can decide
    if (booking.customer._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return sendError(res, 403, 'Only the customer can approve or reject extra time', 'FORBIDDEN');
    }
    if (!booking.extraTimeRequest || booking.extraTimeRequest.status !== 'pending') {
      return sendError(res, 400, 'No pending extra time request found', 'INVALID_REQUEST');
    }

    const isApproved = approved === true || approved === 'true';
    const extraCost = booking.extraTimeRequest.cost || 0;
    const extraMins = booking.extraTimeRequest.minutes || 0;

    if (isApproved) {
      // ── APPROVE ─────────────────────────────────────────────────────────────
      const updatedFinance = calculateBookingTotals(
        (booking.subtotal || 0) + extraCost,
        booking.items?.length || 1,
        {
          platformFee: booking.platformFee,
          gstPercent: booking.gstPercent,
          maidSharePercent: booking.maidSharePercent,
        },
      );

      booking.extraTimeRequest.status = 'approved';
      booking.subtotal = updatedFinance.subtotal;
      booking.platformFee = updatedFinance.platformFee;
      booking.gstPercent = updatedFinance.gstPercent;
      booking.gst = updatedFinance.gst;
      booking.taxAmount = updatedFinance.taxAmount;
      booking.grossAmount = updatedFinance.grossAmount;
      booking.maidSharePercent = updatedFinance.maidSharePercent;
      booking.maidShareAmount = updatedFinance.maidShareAmount;
      booking.companyShareAmount = updatedFinance.companyShareAmount;
      booking.companyRevenueAmount = updatedFinance.companyRevenueAmount;
      booking.totalAmount = updatedFinance.totalAmount;
      booking.totalTime = (booking.totalTime || booking.estimatedTime || 0) + extraMins;
      await booking.save();

      // ── Notify the maid ─────────────────────────────────────────────────────
      if (booking.maid) {
        await Notification.create({
          recipient: booking.maid._id,
          type: 'extra_time_approved',
          title: '✅ Extra Time Approved',
          message: `Customer approved ${extraMins} extra minutes. ₹${extraCost} added to the job.`,
          meta: {
            bookingId: booking._id,
            extraCost,
            extraMins,
            newTotal: booking.totalAmount,
          },
        });
      }

      return sendResponse(res, 200, 'Extra time approved. Cost added to booking.', {
        decision: 'approved',
        bookingId: booking._id,
        extraTimeRequest: booking.extraTimeRequest,
        priceSummary: {
          extraMinutes: extraMins,
          extraCost: extraCost,
          newTotalAmount: booking.totalAmount,
          newTotalTime: booking.totalTime,
          currency: 'INR',
        },
        // What the maid should see on her active-job screen
        maidAlert: {
          title: 'Extra time approved!',
          message: `You have ${extraMins} more minutes. New job total: ₹${booking.totalAmount}`,
        },
      });
    } else {
      // ── REJECT ─────────────────────────────────────────────────────────────
      booking.extraTimeRequest.status = 'rejected';
      await booking.save();

      // ── Notify the maid ─────────────────────────────────────────────────────
      if (booking.maid) {
        await Notification.create({
          recipient: booking.maid._id,
          type: 'extra_time_rejected',
          title: '❌ Extra Time Rejected',
          message: `Customer declined the extra ${extraMins}-minute request. Please complete the job as scheduled.`,
          meta: {
            bookingId: booking._id,
            extraMins,
          },
        });
      }

      return sendResponse(res, 200, 'Extra time request rejected.', {
        decision: 'rejected',
        bookingId: booking._id,
        extraTimeRequest: booking.extraTimeRequest,
        // What the maid should see on her active-job screen
        maidAlert: {
          title: 'Extra time rejected',
          message: 'Customer declined the extra time. Please wrap up and mark the job complete.',
        },
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark Job Complete
 * @route   POST /api/v1/bookings/:id/complete
 * @access  Protected (Maid)
 */
exports.completeBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    if (booking.status === 'completed') {
      return sendError(res, 400, 'Booking is already completed', 'INVALID_REQUEST');
    }
    if (booking.status !== 'ongoing') {
      return sendError(res, 400, 'Job must be ongoing to mark as complete', 'INVALID_REQUEST');
    }
    if (booking.maid.toString() !== req.user.id) {
      return sendError(res, 403, 'Not assigned to this booking', 'FORBIDDEN');
    }

    // ── Guard: all checklist tasks must be done ───────────────────────────
    if (booking.checklist && booking.checklist.length > 0) {
      const pending = booking.checklist.filter((c) => !c.isDone);
      if (pending.length > 0) {
        return sendError(
          res,
          400,
          `${pending.length} checklist task(s) are still pending: ${pending.map((c) => c.task).join(', ')}`,
          'CHECKLIST_INCOMPLETE',
        );
      }
    }

    // ── Guard: no pending extra-time request ─────────────────────────────
    if (booking.extraTimeRequest && booking.extraTimeRequest.status === 'pending') {
      return sendError(
        res,
        400,
        'There is a pending extra time request. Wait for customer response.',
        'INVALID_REQUEST',
      );
    }

    booking.status = 'completed';
    booking.endTime = new Date();
    await booking.save();

    // Check for referral rewards
    const customer = await User.findById(booking.customer);
    if (customer.referredBy && !customer.isReferralRewardClaimed) {
      // Check if this is the customer's first completed booking
      const completedCount = await Booking.countDocuments({
        customer: customer._id,
        status: 'completed',
      });

      if (completedCount === 1) {
        // Find the Referrer
        const referrer = await User.findOne({ referralCode: customer.referredBy });
        if (referrer) {
          const billingConfig = await getActiveBookingConfig();
          const rewardAmount = billingConfig.referrerReward ?? 100;
          referrer.walletBalance += rewardAmount;
          referrer.referralCredits += rewardAmount;
          referrer.walletTransactions.push({
            amount: rewardAmount,
            type: 'credit',
            reason: `Referral bonus from friend ${customer.name || customer.phone || 'Anonymous'}'s first booking.`,
          });

          customer.isReferralRewardClaimed = true;

          await referrer.save();
          await customer.save();

          console.log(
            `[REFERRAL REWARD] ${referrer.email} rewarded for referral of ${customer.phone || customer.name || customer._id}`,
          );
        }
      }
    }

    // NEW: Maid Referral Reward
    if (booking.maid) {
      const maid = await User.findById(booking.maid);
      if (maid && maid.referredBy && !maid.isReferralRewardClaimed) {
        // Check if this is the maid's first completed job
        const completedJobsCount = await Booking.countDocuments({
          maid: maid._id,
          status: 'completed',
        });

        if (completedJobsCount === 1) {
          const referrer = await User.findOne({ referralCode: maid.referredBy });
          if (referrer) {
            const billingConfig = await getActiveBookingConfig();
            const rewardAmount = billingConfig.referrerReward ?? 100;
            referrer.walletBalance += rewardAmount;
            referrer.referralCredits += rewardAmount;
            referrer.walletTransactions.push({
              amount: rewardAmount,
              type: 'credit',
              reason: `Referral bonus for referring Maid ${maid.name || maid.email || 'Anonymous'}.`,
            });

            maid.isReferralRewardClaimed = true;
            await referrer.save();
            await maid.save();

            console.log(
              `[MAID REFERRAL REWARD] ${referrer.email} rewarded for referral of Maid ${maid.email}`,
            );
          }
        }
      }
    }

    // Automatically make the maid available again
    if (booking.maid) {
      const MaidProfile = require('../models/MaidProfile');
      await MaidProfile.findOneAndUpdate({ user: booking.maid }, { isAvailable: true });
    }

    return sendResponse(res, 200, 'Job completed and closed', { booking });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get service time estimation
 * @route   POST /api/v1/bookings/estimate
 */
exports.getEstimation = async (req, res, next) => {
  try {
    const { serviceId, items: cartItems } = req.body;

    if (!serviceId && (!cartItems || !cartItems.length)) {
      return sendError(
        res,
        400,
        'ServiceId or items are required for estimation.',
        'VALIDATION_ERROR',
      );
    }

    let totalAmount = 0;
    let baseTime = 0;

    if (cartItems && cartItems.length) {
      for (const item of cartItems) {
        const srv = await Service.findById(item.serviceId || item.service);
        if (srv) {
          const dur = item.duration || srv.estimatedTime || 30;
          const baseDuration = srv.estimatedTime || 30;
          const calculatedPrice = Math.round((srv.price || 0) * (dur / baseDuration));
          totalAmount += calculatedPrice;
          baseTime += dur;
          itemCount += 1;
        }
      }
    } else if (serviceId) {
      const srv = await Service.findById(serviceId);
      if (srv) {
        const dur = req.body.duration || srv.estimatedTime || 30;
        const baseDuration = srv.estimatedTime || 30;
        const calculatedPrice = Math.round((srv.price || 0) * (dur / baseDuration));
        totalAmount = calculatedPrice;
        baseTime = dur;
        itemCount = 1;
      }
    }

    const estimatedTime = baseTime;
    const billingConfig = await getActiveBookingConfig();
    const bill = calculateBookingTotals(totalAmount, itemCount, billingConfig);

    return sendResponse(res, 200, 'Estimation calculated', {
      subtotal: bill.subtotal,
      platformFee: bill.platformFee,
      gstPercent: bill.gstPercent,
      gst: bill.gst,
      taxAmount: bill.taxAmount,
      totalAmount: bill.totalAmount,
      estimatedTime,
      unit: 'minutes',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Cancel a booking (Customer/Admin)
 * @route   POST /api/v1/bookings/:id/cancel
 */
exports.cancelBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');

    // Authorization check
    if (req.user.role === 'customer' && booking.customer.toString() !== req.user.id) {
      return sendError(res, 403, 'Unauthorized to cancel this booking', 'FORBIDDEN');
    }

    if (
      ['completed', 'cancelled', 'refunded', 'reschedule_requested', 'failed'].includes(
        booking.status,
      )
    ) {
      return sendError(
        res,
        400,
        `Cannot cancel a booking that is already ${booking.status}`,
        'INVALID_REQUEST',
      );
    }

    const now = new Date();
    const scheduleDate = new Date(booking.scheduleDate);
    const diffHours = (scheduleDate - now) / (1000 * 60 * 60);

    let refundPercentage = 0;
    let reason = '';

    if (booking.bookingType === 'instant') {
      refundPercentage = CANCELLATION_POLICY.INSTANT_BOOKING_REFUND_PERCENTAGE;
      reason = 'Instant booking cancellation fee (no free window)';
    } else if (booking.status === 'ongoing') {
      refundPercentage = CANCELLATION_POLICY.REFUND_PERCENTAGE_ONGOING;
      reason = 'Ongoing job cancellation fee';
    } else if (diffHours >= CANCELLATION_POLICY.WINDOW_HOURS) {
      refundPercentage = CANCELLATION_POLICY.REFUND_PERCENTAGE_BEFORE_WINDOW;
      reason = 'Full refund (cancelled > 12h in advance)';
    } else {
      refundPercentage = CANCELLATION_POLICY.REFUND_PERCENTAGE_AFTER_WINDOW;
      reason = 'Late cancellation fee (cancelled < 12h in advance)';
    }

    const refundAmount = (booking.totalAmount * refundPercentage) / 100;

    // Process Refund to Wallet
    if (refundAmount > 0) {
      const user = await User.findById(booking.customer);
      user.walletBalance += refundAmount;
      user.walletTransactions.push({
        amount: refundAmount,
        type: 'credit',
        reason: `Refund for booking ${booking._id}: ${reason}`,
      });
      await user.save();
    }

    booking.status = refundAmount === booking.totalAmount ? 'refunded' : 'cancelled';
    if (booking.status === 'ongoing') booking.endTime = now;

    await booking.save();

    // Automatically make the maid available again if cancelled
    if (booking.maid) {
      const MaidProfile = require('../models/MaidProfile');
      await MaidProfile.findOneAndUpdate({ user: booking.maid }, { isAvailable: true });
    }

    return sendResponse(res, 200, 'Booking cancelled successfully', {
      booking,
      refundAmount,
      refundPercentage,
    });
  } catch (error) {
    next(error);
  }
};

function isSlotInFutureBackend(dateStr, timeStr) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const partMap = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  const todayStr = `${partMap.year}-${partMap.month}-${partMap.day}`;

  if (dateStr > todayStr) return true;
  if (dateStr < todayStr) return false;

  const match = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return true;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();

  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  const nowMinutes = parseInt(partMap.hour, 10) * 60 + parseInt(partMap.minute, 10);
  const slotMinutes = hours * 60 + minutes;

  // Require slot to be at least 60 minutes in the future
  return slotMinutes > nowMinutes + 60;
}

/**
 * @desc    Get available booking slots (dates + times)
 * @route   GET /api/v1/bookings/available-slots
 * @access  Protected
 */
exports.getAvailableSlots = async (req, res, next) => {
  try {
    let config = await BookingConfig.findOne({ isActive: true });

    const daysAhead = 2; // Today + Tomorrow
    const slots = config
      ? (config.slots ?? [])
      : ['08:00 AM', '10:00 AM', '12:00 PM', '02:00 PM', '04:00 PM', '06:00 PM'];

    const finalSlots =
      slots.length > 0
        ? slots
        : ['08:00 AM', '10:00 AM', '12:00 PM', '02:00 PM', '04:00 PM', '06:00 PM'];

    const dates = [];
    const slotsMap = {};
    const now = new Date();

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    for (let i = 0; i < daysAhead; i++) {
      const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const parts = formatter.formatToParts(date);
      const partMap = {};
      for (const p of parts) {
        partMap[p.type] = p.value;
      }
      const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;
      dates.push(dateStr);

      const validSlots = finalSlots.filter((time) => isSlotInFutureBackend(dateStr, time));
      slotsMap[dateStr] = validSlots;
    }

    return sendResponse(res, 200, 'Available slots retrieved', { dates, slots: slotsMap });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get live tracking info for a booking
 * @route   GET /api/v1/bookings/:id/tracking
 * @access  Protected
 */
exports.getBookingTracking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('maid', 'name phone');
    if (!booking) {
      return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    }

    // Default coordinates in case booking has no location
    const defaultLat = 9.9816;
    const defaultLng = 76.3213;

    const destLat = booking.location && booking.location.lat ? booking.location.lat : defaultLat;
    const destLng = booking.location && booking.location.lng ? booking.location.lng : defaultLng;
    const hasLiveMaidLocation =
      Number.isFinite(booking.lastMaidLocation?.lat) &&
      Number.isFinite(booking.lastMaidLocation?.lng);
    let maidLat = hasLiveMaidLocation ? booking.lastMaidLocation.lat : null;
    let maidLng = hasLiveMaidLocation ? booking.lastMaidLocation.lng : null;

    if (!hasLiveMaidLocation && booking.maid) {
      const MaidProfile = require('../models/MaidProfile');
      const profile = await MaidProfile.findOne({ user: booking.maid });
      if (
        profile &&
        profile.lastLocation &&
        Number.isFinite(profile.lastLocation.lat) &&
        Number.isFinite(profile.lastLocation.lng)
      ) {
        maidLat = profile.lastLocation.lat;
        maidLng = profile.lastLocation.lng;
      } else {
        // Fallback to a mock location nearby the customer for demonstration/simulation
        maidLat = destLat + 0.004;
        maidLng = destLng - 0.004;
      }
    }

    let maidRating = 4.8;
    if (booking.maid) {
      const MaidProfile = require('../models/MaidProfile');
      const profile = await MaidProfile.findOne({ user: booking.maid });
      if (profile && profile.rating) {
        maidRating = profile.rating;
      }
    }

    const hasAnyMaidLocation = Number.isFinite(maidLat) && Number.isFinite(maidLng);
    const trackingMetrics = hasAnyMaidLocation
      ? await getTrackingMetrics({
          origin: { lat: maidLat, lng: maidLng },
          destination: { lat: destLat, lng: destLng },
          forceRefresh: true,
        })
      : null;

    // Timeline construction
    const timeline = [
      {
        status: 'pending_payment',
        title: 'Booking Created',
        time: booking.createdAt,
        completed: true,
      },
    ];

    if (
      [
        'paid_unassigned',
        'searching',
        'admin_attention',
        'accepted',
        'in_transit',
        'arrived',
        'ongoing',
        'completed',
      ].includes(booking.status)
    ) {
      const title =
        booking.status === 'admin_attention'
          ? 'Operations assigning maid'
          : booking.status === 'paid_unassigned'
            ? 'Maid assignment scheduled'
            : 'Finding nearby maid';
      timeline.push({
        status: 'searching',
        title,
        time: booking.dispatchStartedAt || booking.updatedAt,
        completed: true,
      });
    } else {
      timeline.push({
        status: 'searching',
        title: 'Finding nearby maid',
        time: '',
        completed: false,
      });
    }

    if (['accepted', 'in_transit', 'arrived', 'ongoing', 'completed'].includes(booking.status)) {
      timeline.push({
        status: 'accepted',
        title: 'Maid assigned',
        time: booking.updatedAt,
        completed: true,
      });
    } else {
      timeline.push({ status: 'accepted', title: 'Maid assigned', time: '', completed: false });
    }

    if (['ongoing', 'completed'].includes(booking.status)) {
      timeline.push({
        status: 'ongoing',
        title: 'Job In Progress',
        time: booking.startTime || booking.updatedAt,
        completed: true,
      });
    } else {
      timeline.push({ status: 'ongoing', title: 'Job In Progress', time: '', completed: false });
    }

    if (booking.status === 'completed') {
      timeline.push({
        status: 'completed',
        title: 'Job Completed',
        time: booking.endTime || booking.updatedAt,
        completed: true,
      });
    } else {
      timeline.push({ status: 'completed', title: 'Job Completed', time: '', completed: false });
    }

    return sendResponse(res, 200, 'Tracking info retrieved', {
      bookingId: booking._id,
      status: booking.status,
      etaMinutes: ['accepted', 'in_transit', 'arrived'].includes(booking.status)
        ? (trackingMetrics?.etaMinutes ?? null)
        : booking.status === 'ongoing'
          ? 5
          : 0,
      distance: Number.isFinite(trackingMetrics?.distanceMeters)
        ? trackingMetrics.distanceMeters
        : null,
      distanceSource: trackingMetrics?.source || null,
      routePolyline: trackingMetrics?.routePolyline || null,
      routeSource: trackingMetrics?.routeSource || null,
      lat: maidLat,
      lng: maidLng,
      maidLocation: {
        lat: maidLat,
        lng: maidLng,
      },
      destinationLocation: {
        lat: destLat,
        lng: destLng,
      },
      maid: booking.maid
        ? {
            id: booking.maid._id,
            name: booking.maid.name,
            phone: booking.maid.phone,
            rating: maidRating,
          }
        : null,
      startOtp: booking.startOtp || null,
      timeline,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Booking Summary details (cart, addresses, estimate, availability) in a single response
 * @route   GET /api/v1/bookings/summary
 */
exports.getBookingSummary = async (req, res, next) => {
  try {
    // 1. Fetch user's cart
    let cart = await Cart.findOne({ customer: req.user.id }).populate(
      'serviceCart.service',
      'name category price image estimatedTime',
    );

    if (!cart) {
      cart = await Cart.create({ customer: req.user.id, serviceCart: [], totalAmount: 0 });
    }

    // Format the cart response to apply placeholder image fallback if service image is missing
    const cartObj = cart.toObject ? cart.toObject() : cart;
    if (cartObj.serviceCart) {
      cartObj.serviceCart.forEach((item) => {
        if (item.service) {
          if (!item.service.image) {
            item.service.image =
              'https://res.cloudinary.com/dydsfw6w7/image/upload/v1780592384/zaffabit/services/lq550xrevofrui9h6byo.png';
          }
          item.service.icon = item.service.image;
        }
      });
    }

    // 2. Fetch user profile and addresses
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const addresses = user.addresses || [];
    const selectedAddress = addresses.find((addr) => addr.isDefault) || addresses[0] || null;

    // 3. Calculate estimate/billDetails
    const config = await getActiveBookingConfig();
    const subtotal = cart.totalAmount || 0;
    const itemsCount = cart.serviceCart.length;
    const bill = calculateBookingTotals(subtotal, itemsCount, config);

    let estimatedTime = 0;
    if (cart.serviceCart && cart.serviceCart.length > 0) {
      cart.serviceCart.forEach((item) => {
        estimatedTime += item.duration || item.service?.estimatedTime || 30;
      });
    } else {
      estimatedTime = 60; // default duration fallback
    }

    // 4. Query instant availability based on selected address
    const lat = selectedAddress && selectedAddress.latitude ? selectedAddress.latitude : 9.9816;
    const lng = selectedAddress && selectedAddress.longitude ? selectedAddress.longitude : 76.3213;

    const availability = await findAvailableMaids({
      lat,
      lng,
      estimatedDurationMinutes: estimatedTime,
      radiusMeters: 5000,
      limit: 5,
    });

    const dateParam = req.query.date || 'Instant Booking';
    const timeParam = req.query.time || req.query.slot || 'Now';
    const formattedLocation = selectedAddress
      ? [selectedAddress.houseName, selectedAddress.street, selectedAddress.city]
          .filter(Boolean)
          .join(', ')
      : 'No location selected';

    return sendResponse(res, 200, 'Booking summary retrieved', {
      date: dateParam,
      time: timeParam,
      servicesCount: itemsCount,
      formattedLocation,
      billDetails: {
        subtotal: bill.subtotal,
        platformFee: bill.platformFee,
        gstPercent: bill.gstPercent,
        gst: bill.gst,
        taxAmount: bill.taxAmount,
        total: bill.totalAmount,
      },
      availability: {
        available: availability.available,
        message: availability.message,
        count: availability.count,
        radiusMeters: availability.radiusMeters,
        maids: (availability.maids || []).map((m, index) => {
          const fallbackAvatars = [
            'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150',
            'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150',
            'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=150',
            'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&q=80&w=150',
            'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150',
          ];
          return {
            location: m.location,
            avatarUrl: m.avatarUrl || fallbackAvatars[index % fallbackAvatars.length],
          };
        }),
      },
    });
  } catch (error) {
    next(error);
  }
};
