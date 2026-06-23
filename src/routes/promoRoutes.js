const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const { validatePromo } = require('../controllers/promoController');

// Validate promo code during checkout
router.post('/validate', protect, validatePromo);

module.exports = router;
