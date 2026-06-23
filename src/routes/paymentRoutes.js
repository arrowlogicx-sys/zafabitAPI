const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const {
  initiatePayment,
  verifyPayment,
  refundPayment,
  sendPaymentReminder,
} = require('../controllers/paymentController');
const { restrictTo } = require('../middleware/roleMiddleware');

// All payment routes are protected
router.use(protect);

router.post('/initiate', initiatePayment);
router.post('/verify', verifyPayment);
router.post('/reminder/:id', restrictTo('admin'), sendPaymentReminder);
router.post('/refund/:id', restrictTo('admin'), refundPayment);

module.exports = router;
