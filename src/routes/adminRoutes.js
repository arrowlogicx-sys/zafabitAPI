const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/admin/dashboardAdminController');
const { configureZone } = require('../controllers/admin/zoneAdminController');
const {
  getSentimentReport,
  getFinancialReport,
  getCampaignReport,
  getPartnerReports,
  getBookingReports,
} = require('../controllers/admin/reportAdminController');
const {
  getRecentBookings,
  assignMaidToBooking,
  retryScheduledDispatch,
  updateBookingStatus,
  updateAdminBooking,
  deleteAdminBooking,
} = require('../controllers/admin/bookingAdminController');
const { exportDataset } = require('../controllers/admin/exportAdminController');
const {
  clearActivityLogs,
  createAdmin,
  deleteAdminUser,
  getActivityLogs,
  getUsers,
  updateAdminUser,
  updateUserStatus,
} = require('../controllers/admin/userAdminController');
const {
  approveMaidVerification,
  createMaid,
  deleteMaid,
  getPendingVerifications,
  updateMaid,
} = require('../controllers/admin/maidAdminController');
const {
  getAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
} = require('../controllers/admin/notificationAdminController');
const {
  getBookingConfig,
  updateBookingConfig,
} = require('../controllers/admin/bookingConfigAdminController');
const {
  adjustUserWallet,
  createAdminPayment,
  createAdminRefund,
  deleteAdminPayment,
  deleteAdminRefund,
  getAdminPayments,
  getAdminRefunds,
  getAdminWallets,
  getSettlements,
  releaseSettlement,
  toggleUserWalletFreeze,
  updateAdminPayment,
  updateAdminRefund,
} = require('../controllers/admin/financeAdminController');

const protect = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
  createAdminPaymentSchema,
  adjustUserWalletSchema,
} = require('../validations/adminValidation');
const {
  getPromotions,
  createPromotion,
  deletePromotion,
} = require('../controllers/promoController');
const { getReferralsReport } = require('../controllers/referralController');
const {
  getTickets,
  replyToTicket,
  resolveTicket,
} = require('../controllers/supportTicketController');
const { getIncidents, resolveIncident } = require('../controllers/incidentController');
const { getGeoHeatmap } = require('../controllers/geoHeatmapController');

// Middleware to restrict access to admins only
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`,
      });
    }
    next();
  };
};

const ADMIN_ROLES = {
  SUPER: 'super_admin',
  OPERATIONS: 'operations_admin',
  FINANCE: 'finance_admin',
  SUPPORT: 'support_admin',
  MARKETING: 'marketing_admin',
};

const getAdminRole = (user) =>
  user && user.role === 'admin' ? user.adminRole || ADMIN_ROLES.SUPER : null;

const authorizeAdminRoles = (...allowedAdminRoles) => {
  return (req, res, next) => {
    const adminRole = getAdminRole(req.user);
    if (!adminRole || !allowedAdminRoles.includes(adminRole)) {
      return res.status(403).json({
        success: false,
        message: 'Your administrator role is not authorized to access this route',
      });
    }
    next();
  };
};

const ALL_ADMINS = Object.values(ADMIN_ROLES);

router.use(protect);
router.use(authorize('admin'));

router.get('/dashboard', authorizeAdminRoles(...ALL_ADMINS), getDashboardStats);
router.get(
  '/users',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS, ADMIN_ROLES.SUPPORT),
  getUsers,
);
router.put(
  '/users/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  updateAdminUser,
);
router.delete(
  '/users/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  deleteAdminUser,
);
router.patch(
  '/users/:id/status',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  updateUserStatus,
);
router.post(
  '/zones/config',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  configureZone,
);
router.get('/reports/sentiment', authorizeAdminRoles(...ALL_ADMINS), getSentimentReport);
router.get('/reports/financial', authorizeAdminRoles(...ALL_ADMINS), getFinancialReport);
router.post('/maids', authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS), createMaid);
router.put(
  '/maids/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  updateMaid,
);
router.delete(
  '/maids/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  deleteMaid,
);

// Verifications
router.get(
  '/verifications/pending',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  getPendingVerifications,
);
router.patch(
  '/verifications/:id/approve',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  approveMaidVerification,
);

// Finance & Reports
router.get(
  '/finance/settlements',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  getSettlements,
);
router.post(
  '/finance/settlements/:maidId/release',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  releaseSettlement,
);
router.get('/reports/campaigns', authorizeAdminRoles(...ALL_ADMINS), getCampaignReport);
router.get('/reports/partners', authorizeAdminRoles(...ALL_ADMINS), getPartnerReports);
router.get('/reports/bookings', authorizeAdminRoles(...ALL_ADMINS), getBookingReports);

// Admin Refunds Management
router.get(
  '/finance/refunds',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  getAdminRefunds,
);
router.post(
  '/finance/refunds',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  createAdminRefund,
);
router.put(
  '/finance/refunds/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  updateAdminRefund,
);
router.delete(
  '/finance/refunds/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  deleteAdminRefund,
);

// Bookings
router.get(
  '/bookings/recent',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS, ADMIN_ROLES.SUPPORT),
  getRecentBookings,
);
router.patch(
  '/bookings/:id/assign',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  assignMaidToBooking,
);
router.patch(
  '/bookings/:id/retry-dispatch',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  retryScheduledDispatch,
);
router.patch(
  '/bookings/:id/status',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  updateBookingStatus,
);
router.put(
  '/bookings/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  updateAdminBooking,
);
router.delete(
  '/bookings/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  deleteAdminBooking,
);

// Admin notification inbox
router.get('/notifications', authorizeAdminRoles(...ALL_ADMINS), getAdminNotifications);
router.patch(
  '/notifications/read-all',
  authorizeAdminRoles(...ALL_ADMINS),
  markAllAdminNotificationsRead,
);
router.patch(
  '/notifications/:id/read',
  authorizeAdminRoles(...ALL_ADMINS),
  markAdminNotificationRead,
);

// Booking Slots Configuration
router.get(
  '/config/booking',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  getBookingConfig,
);
router.put(
  '/config/booking',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  updateBookingConfig,
);

// Admin Payments Management
router.get(
  '/payments',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  getAdminPayments,
);
router.post(
  '/payments',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  validate(createAdminPaymentSchema),
  createAdminPayment,
);
router.put(
  '/payments/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  updateAdminPayment,
);
router.delete(
  '/payments/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  deleteAdminPayment,
);

// Admin Wallets Management
router.get(
  '/wallets',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  getAdminWallets,
);
router.post(
  '/wallets/:userId/adjust',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  validate(adjustUserWalletSchema),
  adjustUserWallet,
);
router.post(
  '/wallets/:userId/freeze',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.FINANCE),
  toggleUserWalletFreeze,
);

// Admin Promotions Management
router.get(
  '/promotions',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.MARKETING),
  getPromotions,
);
router.post(
  '/promotions',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.MARKETING),
  createPromotion,
);
router.delete(
  '/promotions/:id',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.MARKETING),
  deletePromotion,
);

// Admin Referrals Management
router.get(
  '/referrals',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.MARKETING),
  getReferralsReport,
);

// Admin Support Tickets Management
router.get(
  '/support/tickets',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS, ADMIN_ROLES.SUPPORT),
  getTickets,
);
router.post(
  '/support/tickets/:id/reply',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS, ADMIN_ROLES.SUPPORT),
  replyToTicket,
);
router.patch(
  '/support/tickets/:id/resolve',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS, ADMIN_ROLES.SUPPORT),
  resolveTicket,
);

// Admin Incident Command Management
router.get(
  '/incidents',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS, ADMIN_ROLES.SUPPORT),
  getIncidents,
);
router.patch(
  '/incidents/:id/resolve',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS, ADMIN_ROLES.SUPPORT),
  resolveIncident,
);

// Admin Data Exports
router.get('/export/:dataset', authorizeAdminRoles(...ALL_ADMINS), exportDataset);

// Admin Account Registration
router.post('/users/create-admin', authorizeAdminRoles(ADMIN_ROLES.SUPER), createAdmin);

// Admin Activity Logs
router.get('/activity-logs', authorizeAdminRoles(...ALL_ADMINS), getActivityLogs);
router.delete('/activity-logs', authorizeAdminRoles(ADMIN_ROLES.SUPER), clearActivityLogs);

// ─── Geo Heatmap (H3 Spatial Analytics) ─────────────────────────────────────
router.get(
  '/geo-heatmap',
  authorizeAdminRoles(ADMIN_ROLES.SUPER, ADMIN_ROLES.OPERATIONS),
  getGeoHeatmap,
);

module.exports = router;
