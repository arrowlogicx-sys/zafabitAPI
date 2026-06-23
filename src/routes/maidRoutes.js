const express = require('express');
const router = express.Router();
const {
  toggleAvailability,
  updateMaidLocation,
  uploadVerifyDocs,
  uploadSelfie,
  getEarnings,
  getSupportInfo,
  updateOwnProfile,
  getMaidJobs,
  // Dashboard, Jobs & Active Job
  getMaidDashboard,
  getMyJobs,
  getActiveJob,
  getExtraTimeStatus,
  // Notifications
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  // Referral & Profile pages
  getMaidReferral,
  getMaidProfile,
  updateMaidPersonalInfo,
  // Onboarding
  onboardingSelfie,
  onboardingJobType,
  onboardingWorkAreas,
  onboardingConfirm,
  getOnboardingStatus,
} = require('../controllers/maidController');

const { getWallet, getReferral, applyReferral } = require('../controllers/customerController');

const protect = require('../middleware/authMiddleware');
const upload = require('../utils/storage');

router.use(protect);

// ── Dashboard, Jobs & Active Job ────────────────────────────────────────────────
router.get('/dashboard', getMaidDashboard); // Home screen stats + today's schedule
router.get('/my-jobs', getMyJobs); // ?tab=new|upcoming|completed
router.get('/active-job', getActiveJob); // Current ongoing job + checklist + timer
router.get('/active-job/extra-time-status', getExtraTimeStatus); // Poll for customer's extra-time decision
// ────────────────────────────────────────────────────────────────────────────────

// ── Notification Inbox ────────────────────────────────────────────────────────
router.get('/notifications', getMyNotifications); // ?unreadOnly=true&limit=20
router.patch('/notifications/read-all', markAllNotificationsRead); // mark all read (must be before /:id)
router.patch('/notifications/:id/read', markNotificationRead); // mark one read
// ────────────────────────────────────────────────────────────────────────────────

// ── Onboarding Flow ──────────────────────────────────────────────────────────
router.get('/onboarding/status', getOnboardingStatus); // Resume flow
router.post('/onboarding/selfie', upload.single('selfie'), onboardingSelfie); // Step 1
router.post('/onboarding/job-type', onboardingJobType); // Step 2
router.post('/onboarding/work-areas', onboardingWorkAreas); // Step 3
router.post('/onboarding/confirm', onboardingConfirm); // Step 4
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/availability', toggleAvailability);
router.patch('/location', updateMaidLocation);
router.post('/documents', upload.array('document', 5), uploadVerifyDocs);
router.post('/selfie', upload.single('selfie'), uploadSelfie);
router.get('/earnings', getEarnings);
router.get('/jobs', getMaidJobs);
router.get('/support', getSupportInfo);
router.get('/wallet', getWallet);

// ── Referral Page ──────────────────────────────────────────────────────────
router.get('/referral-info', getMaidReferral); // Full referral page (code + stats + howItWorks)
router.post('/referral/apply', applyReferral); // Apply someone else's code

// ── Profile Page ──────────────────────────────────────────────────────────
router.get('/profile-info', getMaidProfile); // Profile page (name, rating, exp, menu)
router.put('/profile-info', updateMaidPersonalInfo); // Update personal information
router.put('/profile', updateOwnProfile); // Legacy profile update (zone etc.)

module.exports = router;
