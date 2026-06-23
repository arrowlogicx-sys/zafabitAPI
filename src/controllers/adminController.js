module.exports = {
  ...require('./admin/dashboardAdminController'),
  ...require('./admin/zoneAdminController'),
  ...require('./admin/reportAdminController'),
  ...require('./admin/bookingAdminController'),
  ...require('./admin/exportAdminController'),
  ...require('./admin/userAdminController'),
  ...require('./admin/maidAdminController'),
  ...require('./admin/notificationAdminController'),
  ...require('./admin/bookingConfigAdminController'),
  ...require('./admin/financeAdminController'),
};
