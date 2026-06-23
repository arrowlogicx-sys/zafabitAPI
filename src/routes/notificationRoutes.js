const express = require('express');
const router = express.Router();
const { createCampaign, getNotificationLogs } = require('../controllers/notificationController');
const protect = require('../middleware/authMiddleware');

router.use(protect);

router.post('/campaign', createCampaign);
router.get('/logs', getNotificationLogs);

module.exports = router;
