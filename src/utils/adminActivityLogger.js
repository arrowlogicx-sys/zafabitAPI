const ActivityLog = require('../models/ActivityLog');

const logAdminActivity = async (
  adminId,
  action,
  details,
  status = 'Success',
  ipAddress = 'Internal',
) => {
  try {
    await ActivityLog.create({
      admin: adminId,
      action,
      details,
      status,
      ipAddress,
    });
  } catch (err) {
    console.error('Failed to log admin action:', err);
  }
};

module.exports = {
  logAdminActivity,
};
