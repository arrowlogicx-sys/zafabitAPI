const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const { checkServiceability, searchLocations } = require('../controllers/locationController');

// All location routes are protected
router.use(protect);

router.get('/serviceability', checkServiceability);
router.get('/search', searchLocations);

module.exports = router;
