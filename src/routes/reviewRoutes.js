const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  submitReview,
  getMaidReviews,
  getMyReviews,
  raiseIssue,
  resolveIssue,
  getAllReviews,
} = require('../controllers/reviewController');

// Review and Issue routes
router.use(protect);

router.post('/', restrictTo('customer', 'admin'), submitReview);
router.get('/me', restrictTo('maid'), getMyReviews);
router.get('/maid/:maidId', getMaidReviews);
router.post('/issue', restrictTo('customer', 'admin'), raiseIssue);

// Admin only
router.patch('/issue/:id/resolve', restrictTo('admin'), resolveIssue);
router.get('/admin', restrictTo('admin'), getAllReviews);

module.exports = router;
