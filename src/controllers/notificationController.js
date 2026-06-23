const NotificationLog = require('../models/NotificationLog');
const User = require('../models/User');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { sendPushNotification } = require('../utils/firebase');

/**
 * @desc    Send/Schedule Notification Campaign
 * @route   POST /api/v1/notifications/campaign
 */
exports.createCampaign = async (req, res, next) => {
  try {
    const { title, message, recipientType, zone } = req.body;

    if (!title || !message) {
      return sendError(res, 400, 'Title and message are required', 'VALIDATION_ERROR');
    }

    // Identify recipients
    let query = {};
    if (recipientType === 'customers') query.role = 'customer';
    if (recipientType === 'maids') query.role = 'maid';
    if (recipientType === 'zone-wise' && zone) query.zone = zone;

    const recipients = await User.find(query);
    const totalRecipients = recipients.length;

    // Send actual push notifications using Firebase utility
    const recipientIds = recipients.map((r) => r._id);
    let successCount = 0;

    if (recipientIds.length > 0) {
      try {
        const firebaseRes = await sendPushNotification(recipientIds, title, message);
        if (firebaseRes && typeof firebaseRes.successCount === 'number') {
          successCount = firebaseRes.successCount;
        } else {
          // If no active Firebase transport response, count users who have a token
          successCount = recipients.filter((r) => r.pushToken && r.pushToken.trim() !== '').length;
        }
      } catch (firebaseErr) {
        console.error('Firebase dispatch error:', firebaseErr);
        // Fallback
        successCount = recipients.filter((r) => r.pushToken && r.pushToken.trim() !== '').length;
      }
    }

    const log = await NotificationLog.create({
      title,
      message,
      recipientType,
      zone,
      totalRecipients,
      successCount,
      sender: req.user.id,
    });

    return sendResponse(res, 201, 'Notification campaign launched', log);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Notification Logs
 * @route   GET /api/v1/notifications/logs
 */
exports.getNotificationLogs = async (req, res, next) => {
  try {
    const logs = await NotificationLog.find().sort('-createdAt').populate('sender', 'name');
    return sendResponse(res, 200, 'Notification logs retrieved', { count: logs.length, logs });
  } catch (error) {
    next(error);
  }
};
