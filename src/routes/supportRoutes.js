const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const {
  getHelplines,
  contactUs,
  handleAIChat,
  getAIChatHistory,
} = require('../controllers/supportController');
const { triggerSOS } = require('../controllers/incidentController');

// All support routes are protected
router.use(protect);

router.post('/sos', triggerSOS);
router.get('/helplines', getHelplines);
router.post('/contact', contactUs);
router.get('/ai-chat/:conversationId', getAIChatHistory);
router.post('/ai-chat', handleAIChat);

module.exports = router;
