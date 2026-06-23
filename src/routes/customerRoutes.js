const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const {
  getProfile,
  updateProfile,
  uploadAvatar,
  listAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  savePropertyProfile,
  getPropertyProfile,
  getWallet,
  getReferral,
  applyReferral,
  addMoneyToWallet,
  redeemWalletRewards,
  listPaymentMethods,
  savePaymentMethod,
  deletePaymentMethod,
  initiateWalletTopUp,
  verifyWalletTopUp,
  getSupportInfo,
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = require('../controllers/customerController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All routes are protected
router.use(protect);

// Profile
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.put('/profile/avatar', upload.single('avatar'), uploadAvatar);

// Addresses
router.get('/addresses', listAddresses);
router.post('/addresses', addAddress);
router.put('/addresses/:id', updateAddress);
router.delete('/addresses/:id', deleteAddress);

// Property Profile
router.get('/property-profile', getPropertyProfile);
router.post('/property-profile', savePropertyProfile);

// Wallet & Referral
//not correctly done check ?
router.get('/wallet', getWallet);
router.post('/wallet/add-money', addMoneyToWallet);
router.post('/wallet/redeem', redeemWalletRewards);
router.post('/wallet/top-up/initiate', initiateWalletTopUp);
router.post('/wallet/top-up/verify', verifyWalletTopUp);
router.get('/payment-methods', listPaymentMethods);
router.post('/payment-methods', savePaymentMethod);
router.delete('/payment-methods/:id', deletePaymentMethod);
router.get('/referral', getReferral);
router.post('/referral/apply', applyReferral);

// Support & SOS
router.get('/support', getSupportInfo);

// Notifications
router.get('/notifications', getMyNotifications);
router.patch('/notifications/read-all', markAllNotificationsRead);
router.patch('/notifications/:id/read', markNotificationRead);

module.exports = router;
