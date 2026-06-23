const Notification = require('../../models/Notification');
const { sendResponse, sendError } = require('../../utils/apiResponse');

/**
 * @desc    Get the signed-in admin's in-app notifications
 * @route   GET /api/v1/admin/notifications
 */
exports.getAdminNotifications = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const filter = { recipient: req.user._id };
    if (req.query.unreadOnly === 'true') filter.isRead = false;

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ isRead: 1, createdAt: -1 }).limit(limit),
      Notification.countDocuments({ recipient: req.user._id, isRead: false }),
    ]);

    return sendResponse(res, 200, 'Admin notifications retrieved', {
      notifications,
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark one admin notification as read
 * @route   PATCH /api/v1/admin/notifications/:id/read
 */
exports.markAdminNotificationRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { $set: { isRead: true } },
      { returnDocument: 'after' },
    );
    if (!notification) return sendError(res, 404, 'Notification not found', 'NOT_FOUND');
    return sendResponse(res, 200, 'Admin notification marked as read', { notification });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark every admin notification as read
 * @route   PATCH /api/v1/admin/notifications/read-all
 */
exports.markAllAdminNotificationsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { $set: { isRead: true } },
    );
    return sendResponse(res, 200, 'All admin notifications marked as read', {
      modifiedCount: result.modifiedCount || 0,
    });
  } catch (error) {
    next(error);
  }
};
