const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  createBooking,
  createBookingFromCart,
  getBookings,
  getBookingById,
  respondToBooking,
  sendStartOtp,
  verifyStart,
  updateChecklist,
  requestExtraTime,
  approveExtraTime,
  completeBooking,
  getEstimation,
  cancelBooking,
  getAvailableSlots,
  getInstantAvailability,
  getBookingTracking,
  getBookingSummary,
} = require('../controllers/bookingController');

// All booking routes are protected
router.use(protect);

// Shared or Role-specific routes
router.post('/', restrictTo('customer', 'admin'), createBooking);
router.post('/from-cart', restrictTo('customer', 'admin'), createBookingFromCart);
router.post('/estimate', getEstimation);
router.post('/instant-availability', restrictTo('customer', 'admin'), getInstantAvailability);
router.get('/available-slots', getAvailableSlots);
router.get('/summary', restrictTo('customer', 'admin'), getBookingSummary);
router.get('/', getBookings);
router.get('/:id', getBookingById); // Booking Summary API
router.get('/:id/tracking', getBookingTracking);

// Maid specific actions
router.post('/:id/respond', restrictTo('maid', 'admin'), respondToBooking);
router.post('/:id/start-otp', restrictTo('maid'), sendStartOtp);
router.post('/:id/verify-start', restrictTo('maid'), verifyStart);
router.patch('/:id/checklist/:index', restrictTo('maid'), updateChecklist); // Mark task done/undone
router.post('/:id/extra-time', restrictTo('maid'), requestExtraTime);
router.post('/:id/complete', restrictTo('maid'), completeBooking);

// Customer specific actions
router.post('/:id/approve-extra', restrictTo('customer', 'admin'), approveExtraTime);
router.post('/:id/cancel', restrictTo('customer', 'admin'), cancelBooking);

module.exports = router;
