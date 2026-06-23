const mongoose = require('mongoose');

const getEffectiveAdminRole = (user) =>
  user && user.role === 'admin' ? user.adminRole || 'super_admin' : null;

const maidMatchValue = (maidId) =>
  mongoose.Types.ObjectId.isValid(maidId) ? new mongoose.Types.ObjectId(maidId) : maidId;

const financeTotalsGroup = {
  _id: null,
  grossRevenue: { $sum: '$financeGrossAmount' },
  serviceSubtotal: { $sum: '$financeSubtotal' },
  maidShareAmount: { $sum: '$financeMaidShareAmount' },
  companyShareAmount: { $sum: '$financeCompanyShareAmount' },
  companyRevenueAmount: { $sum: '$financeCompanyRevenueAmount' },
  platformFee: { $sum: '$financePlatformFee' },
  taxAmount: { $sum: '$financeTaxAmount' },
  bookingCount: { $sum: 1 },
};

const normalizeFinanceTotals = (row = {}) => ({
  grossRevenue: row.grossRevenue ?? row.totalRevenue ?? row.revenue ?? row.total ?? 0,
  serviceSubtotal: row.serviceSubtotal ?? 0,
  maidShareAmount: row.maidShareAmount ?? 0,
  companyShareAmount: row.companyShareAmount ?? 0,
  companyRevenueAmount: row.companyRevenueAmount ?? 0,
  platformFee: row.platformFee ?? 0,
  taxAmount: row.taxAmount ?? 0,
  bookingCount: row.bookingCount ?? row.count ?? 0,
});

const parsePagination = (req, { defaultLimit = 10, maxLimit = 100 } = {}) => {
  const requestedPage = Number.parseInt(req.query.page, 10);
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Math.min(
    Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit,
    maxLimit,
  );
  return { page, limit, skip: (page - 1) * limit };
};

const paginationMeta = (page, limit, totalItems) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  return {
    page,
    perPage: limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

module.exports = {
  financeTotalsGroup,
  getEffectiveAdminRole,
  maidMatchValue,
  normalizeFinanceTotals,
  paginationMeta,
  parsePagination,
};
