const express = require('express');
const router = express.Router();
const {
  sendOtp,
  verifyOtp,
  login,
  getMe,
  logout,
  updatePushToken,
  updateLanguage,
  updateProfile,
  updatePassword,
  deleteMe,
} = require('../controllers/authController');
const protect = require('../middleware/authMiddleware');

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/login', login);
router.put('/language', updateLanguage);
router.put('/languager', updateLanguage);
router.get('/me', protect, getMe);
router.delete('/me', protect, deleteMe);
router.get('/logout', protect, logout);
router.put('/push-token', protect, updatePushToken);
router.put('/profile', protect, updateProfile);
router.put('/password', protect, updatePassword);

module.exports = router;
