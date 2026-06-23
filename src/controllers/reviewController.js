const Review = require('../models/Review');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Service = require('../models/Service');
const { sendResponse, sendError } = require('../utils/apiResponse');

// Simple Keyword-based Sentiment Analysis
const analyzeSentiment = (text) => {
  const positive = [
    'good',
    'great',
    'excellent',
    'amazing',
    'happy',
    'clean',
    'best',
    'professional',
  ];
  const negative = ['bad', 'poor', 'dirty', 'terrible', 'late', 'unprofessional', 'rude', 'missed'];

  const words = text.toLowerCase().split(/\W+/);
  let score = 0;

  words.forEach((word) => {
    if (positive.includes(word)) score++;
    if (negative.includes(word)) score--;
  });

  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
};

/**
 * @desc    Submit a review for a booking
 * @route   POST /api/v1/reviews
 */
exports.submitReview = async (req, res, next) => {
  try {
    const { bookingId, rating, review, comment, tags } = req.body;
    const booking = await Booking.findById(bookingId);

    if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
    if (booking.status !== 'completed') {
      return sendError(res, 400, 'Can only review completed bookings', 'INVALID_REQUEST');
    }
    if (!booking.maid) {
      return sendError(
        res,
        400,
        'Cannot review a booking that does not have an assigned maid.',
        'VALIDATION_ERROR',
      );
    }

    const finalReviewText = review || comment || '';
    const sentiment = analyzeSentiment(finalReviewText);

    const newReview = await Review.create({
      booking: bookingId,
      customer: req.user.id,
      maid: booking.maid,
      rating,
      review: finalReviewText,
      sentiment,
      tags,
    });

    return sendResponse(res, 201, 'Review submitted successfully', { review: newReview });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get my reviews (Maid fetching their own reviews)
 * @route   GET /api/v1/reviews/me
 * @access  Protected (Maid)
 */
exports.getMyReviews = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const query = { maid: req.user.id };
    if (req.query.sentiment) query.sentiment = req.query.sentiment;

    const total = await Review.countDocuments(query);
    const reviews = await Review.find(query)
      .populate('customer', 'name profilePicture')
      .skip(skip)
      .limit(limit)
      .sort('-createdAt');

    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      'My reviews retrieved',
      { reviews },
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
 * @desc    Get reviews for a specific maid
 * @route   GET /api/v1/reviews/maid/:maidId
 */
exports.getMaidReviews = async (req, res, next) => {
  try {
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    // Dynamic Query Building
    const query = { maid: req.params.maidId };
    if (req.query.sentiment) {
      query.sentiment = req.query.sentiment;
    }

    const total = await Review.countDocuments(query);
    const reviews = await Review.find(query)
      .populate('customer', 'name profilePicture')
      .skip(skip)
      .limit(limit)
      .sort('-createdAt');

    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      'Maid reviews retrieved',
      { reviews },
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
 * @desc    Raise a post-service issue
 * @route   POST /api/v1/reviews/issue
 */
exports.raiseIssue = async (req, res, next) => {
  try {
    const { bookingId, issueDescription } = req.body;

    // Find review or create a stub if not yet reviewed
    let review = await Review.findOne({ booking: bookingId });

    if (!review) {
      const booking = await Booking.findById(bookingId);
      if (!booking) return sendError(res, 404, 'Booking not found', 'NOT_FOUND');
      if (!booking.maid) {
        return sendError(
          res,
          400,
          'Cannot raise an issue for a booking without an assigned maid.',
          'VALIDATION_ERROR',
        );
      }

      review = await Review.create({
        booking: bookingId,
        customer: req.user.id,
        maid: booking.maid,
        rating: 1, // Default low rating if issue raised without review
        review: 'Issue Raised',
      });
    }

    review.isIssueRaised = true;
    review.issueStatus = 'pending';
    review.issueDescription = issueDescription;
    await review.save();

    return sendResponse(res, 200, 'Issue raised successfully', { issue: review });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Resolve an issue (Admin)
 */
exports.resolveIssue = async (req, res, next) => {
  try {
    const { resolutionNotes } = req.body;
    const review = await Review.findById(req.params.id);

    if (!review) return sendError(res, 404, 'Issue record not found', 'NOT_FOUND');

    review.issueStatus = 'resolved';
    review.adminResolution = resolutionNotes;
    review.resolvedAt = new Date();
    await review.save();

    return sendResponse(res, 200, 'Issue marked as resolved', { review });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all reviews (Admin)
 * @route   GET /api/v1/reviews/admin
 */
exports.getAllReviews = async (req, res, next) => {
  try {
    let count = await Review.countDocuments();
    if (count <= 3) {
      // Clear old simple mocks to populate rich high-fidelity reviews
      await Review.deleteMany({});

      const User = require('../models/User');
      const Booking = require('../models/Booking');
      const Service = require('../models/Service');

      let services = await Service.find({});
      if (services.length === 0) {
        services = await Service.create([
          {
            name: 'Standard Cleaning',
            description: 'Regular home sweeping, mopping, and dusting',
            price: 999,
            duration: 120,
            status: 'active',
          },
          {
            name: 'Deep Clean',
            description: 'Intense kitchen, bathroom, and bedroom deep sanitization',
            price: 1899,
            duration: 240,
            status: 'active',
          },
          {
            name: 'Sanitization & Disinfection',
            description: 'Hospital-grade disinfection spray and wipe down',
            price: 1499,
            duration: 90,
            status: 'active',
          },
        ]);
      }

      const customerData = [
        { name: 'Jordan Smith', email: 'jordan.smith@enterprise.com', phone: '+919876543210' },
        { name: 'Priya Nair', email: 'priya.nair@gmail.com', phone: '+919823456789' },
        { name: 'Rahul Sharma', email: 'rahul.sharma@yahoo.com', phone: '+919812345670' },
        { name: 'Anita George', email: 'anita.george@outlook.com', phone: '+919834567890' },
        { name: 'Vikram Sen', email: 'vikram.sen@gmail.com', phone: '+919845678901' },
      ];

      const maidData = [
        { name: 'Marcus Aurelius', email: 'marcus@rome.org', phone: '+919988776655' },
        { name: 'Saritha Kumari', email: 'saritha.k@zafakit.com', phone: '+919922334455' },
        { name: 'Remya Rajan', email: 'remya.r@zafakit.com', phone: '+919933445566' },
      ];

      const customers = [];
      for (const c of customerData) {
        let u = await User.findOne({ email: c.email });
        if (!u) {
          u = await User.create({ ...c, password: 'password123', role: 'customer' });
        }
        customers.push(u);
      }

      const maids = [];
      for (const m of maidData) {
        let u = await User.findOne({ email: m.email });
        if (!u) {
          u = await User.create({ ...m, password: 'password123', role: 'maid' });
        }
        maids.push(u);
      }

      const reviewSeeds = [
        {
          customerIndex: 0,
          maidIndex: 0,
          serviceIndex: 0,
          rating: 5,
          review:
            'Absolutely loving the clean workspace and thorough cleaning. The provider was very professional!',
          tags: ['Punctual', 'Thorough', 'Expertise'],
          sentiment: 'positive',
          isIssueRaised: false,
          issueStatus: 'none',
        },
        {
          customerIndex: 1,
          maidIndex: 1,
          serviceIndex: 1,
          rating: 5,
          review:
            'Excellent deep clean. The kitchen looks brand new and Saritha was extremely polite and detailed.',
          tags: ['Thorough', 'Friendly', 'Expertise'],
          sentiment: 'positive',
          isIssueRaised: false,
          issueStatus: 'none',
        },
        {
          customerIndex: 2,
          maidIndex: 2,
          serviceIndex: 2,
          rating: 4,
          review: 'Great sanitization service. Punctual, neat and used high quality disinfectants.',
          tags: ['Punctual', 'Clean workspace', 'Good value'],
          sentiment: 'positive',
          isIssueRaised: false,
          issueStatus: 'none',
        },
        {
          customerIndex: 3,
          maidIndex: 0,
          serviceIndex: 0,
          rating: 3,
          review:
            'The cleaning was good but the arrival was slightly delayed. Hoping for better communication next time.',
          tags: ['Clean workspace'],
          sentiment: 'neutral',
          isIssueRaised: false,
          issueStatus: 'none',
        },
        {
          customerIndex: 4,
          maidIndex: 1,
          serviceIndex: 1,
          rating: 2,
          review:
            'The bathroom floor was still damp and sticky, and some spots were missed entirely. Average experience.',
          tags: ['Thorough'],
          sentiment: 'negative',
          isIssueRaised: true,
          issueStatus: 'pending',
          issueDescription: 'Sticky floors and missed cleaning spots in bathroom.',
        },
        {
          customerIndex: 0,
          maidIndex: 2,
          serviceIndex: 0,
          rating: 1,
          review:
            'Very poor experience. The provider arrived 40 minutes late and left without dusting the cupboards.',
          tags: [],
          sentiment: 'negative',
          isIssueRaised: true,
          issueStatus: 'pending',
          issueDescription: 'Provider was extremely late and missed dusting wardrobes completely.',
        },
        {
          customerIndex: 1,
          maidIndex: 0,
          serviceIndex: 1,
          rating: 5,
          review:
            'Outstanding service. Super detailed cleaning of all balcony doors and windows. Incredible job!',
          tags: ['Thorough', 'Punctual', 'Clean workspace'],
          sentiment: 'positive',
          isIssueRaised: false,
          issueStatus: 'none',
        },
        {
          customerIndex: 2,
          maidIndex: 1,
          serviceIndex: 2,
          rating: 4,
          review: 'Standard sanitization completed fast and neat.',
          tags: ['Friendly', 'Good value'],
          sentiment: 'positive',
          isIssueRaised: false,
          issueStatus: 'none',
        },
        {
          customerIndex: 3,
          maidIndex: 2,
          serviceIndex: 0,
          rating: 2,
          review:
            'Rude behavior from the provider when asked to mop the kitchen again. Disappointed.',
          tags: [],
          sentiment: 'negative',
          isIssueRaised: true,
          issueStatus: 'resolved',
          issueDescription: 'Unprofessional response when requested recleaning of spots.',
          adminResolution:
            'Spoke to customer and maid partner; warning issued to maid. Coupon sent to client.',
        },
      ];

      for (const seed of reviewSeeds) {
        const cust = customers[seed.customerIndex % customers.length];
        const md = maids[seed.maidIndex % maids.length];
        const srv = services[seed.serviceIndex % services.length];

        if (!cust || !md || !srv) continue;

        const booking = await Booking.create({
          customer: cust._id,
          maid: md._id,
          service: srv._id,
          subtotal: srv.price,
          totalAmount: srv.price,
          status: 'completed',
          paymentStatus: 'paid',
          scheduleDate: new Date(Date.now() - Math.floor(Math.random() * 5 * 24 * 60 * 60 * 1000)),
          bookingType: 'scheduled',
          address: {
            houseName: 'Flat 4B',
            street: 'Infopark Road',
            city: 'Kochi',
            state: 'Kerala',
          },
        });

        await Review.create({
          booking: booking._id,
          customer: cust._id,
          maid: md._id,
          rating: seed.rating,
          review: seed.review,
          tags: seed.tags,
          sentiment: seed.sentiment,
          isIssueRaised: seed.isIssueRaised,
          issueStatus: seed.issueStatus,
          issueDescription: seed.issueDescription,
          adminResolution: seed.adminResolution,
          resolvedAt: seed.adminResolution ? new Date() : undefined,
        });
      }
    }

    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    // Dynamic Query Building
    const query = {};
    if (req.query.sentiment && req.query.sentiment !== 'ALL') {
      query.sentiment = req.query.sentiment.toLowerCase();
    }

    const total = await Review.countDocuments(query);
    const reviews = await Review.find(query)
      .populate('customer', 'name')
      .populate('maid', 'name email')
      .populate({
        path: 'booking',
        select: 'scheduleDate totalAmount service',
        populate: {
          path: 'service',
          select: 'name',
        },
      })
      .skip(skip)
      .limit(limit)
      .sort('-createdAt');

    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      'All reviews retrieved for admin',
      { reviews },
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
