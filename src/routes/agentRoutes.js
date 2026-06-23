const express = require('express');
const router = express.Router();
const {
  getAgentProfile,
  registerAgent,
  getAgentReferrals,
  getAgents,
} = require('../controllers/agentController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');

router.use(protect);

router.get('/me', getAgentProfile);
router.get('/referrals', getAgentReferrals);

// Admin only routes
router.get('/', restrictTo('admin'), getAgents);
router.post('/register', restrictTo('admin'), registerAgent);

module.exports = router;
