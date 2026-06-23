const User = require('../../models/User');
const MaidProfile = require('../../models/MaidProfile');
const CustomerProfile = require('../../models/CustomerProfile');
const Booking = require('../../models/Booking');
const ActivityLog = require('../../models/ActivityLog');
const { sendResponse, sendError } = require('../../utils/apiResponse');
const {
  getEffectiveAdminRole,
  paginationMeta,
  parsePagination,
} = require('./adminControllerUtils');

const usersKpisCache = {};
const usersKpisCacheExpiry = {};

/**
 * @desc    Get Users (Maids/Customers) with Profiles
 * @route   GET /api/v1/admin/users
 */
exports.getUsers = async (req, res, next) => {
  try {
    const { role, status, filterType, location, propertyType, memberCount, search } = req.query;

    if (role === 'admin' && getEffectiveAdminRole(req.user) !== 'super_admin') {
      return sendError(
        res,
        403,
        'Only super admins can access administrator accounts',
        'FORBIDDEN',
      );
    }

    const query = {};
    if (role) query.role = role;

    // Apply status filter
    if (status) {
      if (status === 'active') {
        query.isBlocked = false;
        query.isVerified = true;
      } else if (status === 'inactive') {
        query.isVerified = false;
        query.isBlocked = false;
      } else if (status === 'blocked') {
        query.isBlocked = true;
      }
    }

    // Apply filterType
    if (filterType) {
      if (filterType === 'new') {
        // Users created in the last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        query.createdAt = { $gte: sevenDaysAgo };
      } else if (filterType === 'active') {
        query.isBlocked = false;
        query.isVerified = true;
      } else if (filterType === 'inactive') {
        query.isVerified = false;
        query.isBlocked = false;
      } else if (filterType === 'blocked') {
        query.isBlocked = true;
      }
    }

    // Apply location filter (search in addresses.city or addresses.street)
    if (location) {
      query.$or = [
        { 'addresses.city': { $regex: location, $options: 'i' } },
        { 'addresses.street': { $regex: location, $options: 'i' } },
      ];
    }

    // Apply property type and member count filters (by querying CustomerProfile first)
    if (propertyType || memberCount) {
      const profileQuery = {};
      if (propertyType) {
        profileQuery['propertyProfile.homeType'] = { $regex: propertyType, $options: 'i' };
      }
      if (memberCount) {
        profileQuery['propertyProfile.memberCount'] = parseInt(memberCount, 10);
      }

      const matchingProfiles = await CustomerProfile.find(profileQuery).select('user').limit(5000);
      const userIds = matchingProfiles.map((p) => p.user);

      if (query._id) {
        query._id = { $and: [query._id, { $in: userIds }] };
      } else {
        query._id = { $in: userIds };
      }
    }

    // Search query
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      const searchQuery = {
        $or: [
          { name: searchRegex },
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
        ],
      };
      // Combine with existing query
      if (query.$or) {
        query.$and = [{ $or: query.$or }, searchQuery];
        delete query.$or;
      } else {
        query.$or = searchQuery.$or;
      }
    }

    // Pagination
    const { page, limit, skip } = parsePagination(req);

    let userQuery = User.find(query)
      .select('-password')
      .populate('maidProfile')
      .populate('customerProfile')
      .populate('agentProfile');

    const total = await User.countDocuments(query);
    const users = await userQuery.skip(skip).limit(limit).sort('-createdAt');
    const totalPages = Math.ceil(total / limit);

    // ==================== USER MANAGEMENT KPI METRICS ====================
    const cacheKey = role || 'all';
    let kpis = null;

    if (usersKpisCache[cacheKey] && Date.now() < usersKpisCacheExpiry[cacheKey]) {
      kpis = usersKpisCache[cacheKey];
    } else {
      // 1. Total Users
      const kpiRoleQuery = role ? { role } : {};
      const totalUsers = await User.countDocuments(kpiRoleQuery);

      // 2. Daily Active Users (DAU)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const activeBookingUserIds = await Booking.distinct('customer', {
        updatedAt: { $gte: todayStart },
      });
      const activeMaidUserIds = await Booking.distinct('maid', { updatedAt: { $gte: todayStart } });
      const uniqueBookingUsers = [
        ...new Set([...activeBookingUserIds, ...activeMaidUserIds]),
      ].filter(Boolean);

      const dauQuery = {
        $and: [
          kpiRoleQuery,
          {
            $or: [{ updatedAt: { $gte: todayStart } }, { _id: { $in: uniqueBookingUsers } }],
          },
        ],
      };
      const dau = await User.countDocuments(dauQuery);

      // 3. New Users / New Signups (Registered in last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const newUsers = await User.countDocuments({
        ...kpiRoleQuery,
        createdAt: { $gte: sevenDaysAgo },
      });

      // 4. Returning Users
      // Customers with more than 1 completed booking
      const returningUsersAggregation = await Booking.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: '$customer', bookingCount: { $sum: 1 } } },
        { $match: { bookingCount: { $gt: 1 } } },
        { $count: 'count' },
      ]);
      const returningUsersVal =
        returningUsersAggregation.length > 0 ? returningUsersAggregation[0].count : 0;

      // 5. User Retention
      // Percentage of customers with completed bookings who are returning users
      const totalWithBookingsAgg = await Booking.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: '$customer' } },
        { $count: 'count' },
      ]);
      const totalWithBookings = totalWithBookingsAgg.length > 0 ? totalWithBookingsAgg[0].count : 0;
      const retentionRate =
        totalWithBookings > 0 ? Math.round((returningUsersVal / totalWithBookings) * 100) : 0;

      // Active, Inactive and Blocked for general context
      const activeUsersCount = await User.countDocuments({
        ...kpiRoleQuery,
        isBlocked: false,
        isVerified: true,
      });
      const inactiveUsersCount = await User.countDocuments({
        ...kpiRoleQuery,
        isBlocked: false,
        isVerified: false,
      });
      const blockedUsersCount = await User.countDocuments({ ...kpiRoleQuery, isBlocked: true });

      kpis = {
        totalUsers,
        dau,
        newUsers,
        retention: retentionRate,
        returningUsers: returningUsersVal,
        activeUsers: activeUsersCount,
        inactiveUsers: inactiveUsersCount,
        blockedUsers: blockedUsersCount,
      };

      usersKpisCache[cacheKey] = kpis;
      usersKpisCacheExpiry[cacheKey] = Date.now() + 300 * 1000; // 5 minutes TTL
    }

    return sendResponse(
      res,
      200,
      'Users retrieved',
      { users },
      {
        pagination: {
          page,
          perPage: limit,
          totalItems: total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        kpis,
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Manage User Status (Maid Profile)
 * @route   PATCH /api/v1/admin/users/:id/status
 */
exports.updateUserStatus = async (req, res, next) => {
  try {
    const { activeStatus, isIdentityVerified, isBlocked } = req.body;

    // First find the user to know their role
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    if (user.role === 'admin' && getEffectiveAdminRole(req.user) !== 'super_admin') {
      return sendError(res, 403, 'Only super admins can change administrator status', 'FORBIDDEN');
    }

    if (activeStatus === 'suspended' || isBlocked === true) {
      user.isBlocked = true;
    } else if (activeStatus === 'active' || isBlocked === false) {
      user.isBlocked = false;
    }

    await user.save();

    let updatedProfile = null;

    if (user.role === 'maid') {
      const profile = await MaidProfile.findOne({ user: user._id });
      if (profile) {
        updatedProfile = await MaidProfile.findOneAndUpdate(
          { user: user._id },
          { activeStatus, isIdentityVerified },
          { returnDocument: 'after' },
        );
      }
    }

    return sendResponse(res, 200, 'User status updated', { user, profile: updatedProfile });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update User basic details
 * @route   PUT /api/v1/admin/users/:id
 */
exports.updateAdminUser = async (req, res, next) => {
  try {
    const { name, firstName, lastName, email, phone, location, adminRole } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    const requestAdminRole = getEffectiveAdminRole(req.user);
    if (user.role === 'admin' && requestAdminRole !== 'super_admin') {
      return sendError(res, 403, 'Only super admins can edit administrator accounts', 'FORBIDDEN');
    }

    if (name !== undefined) {
      user.name = name;
      const nameParts = name.trim().split(/\s+/);
      if (nameParts.length > 0) {
        user.firstName = nameParts[0];
        user.lastName = nameParts.slice(1).join(' ');
      }
    } else if (firstName !== undefined || lastName !== undefined) {
      user.firstName = firstName !== undefined ? firstName : user.firstName;
      user.lastName = lastName !== undefined ? lastName : user.lastName;
      user.name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }
    if (email) user.email = email.toLowerCase();
    if (phone !== undefined) user.phone = phone;
    if (user.role === 'admin' && adminRole && requestAdminRole === 'super_admin') {
      user.adminRole = adminRole;
    }

    // Update primary address title/city/state if location is provided
    if (location && location.trim()) {
      if (user.addresses && user.addresses.length > 0) {
        user.addresses[0].city = location;
      } else {
        user.addresses.push({
          title: 'Primary',
          houseName: 'Not Specified',
          city: location,
          pincode: '000000',
          isDefault: true,
        });
      }
    }

    await user.save();
    return sendResponse(res, 200, 'User updated successfully', { user });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete User
 * @route   DELETE /api/v1/admin/users/:id
 */
exports.deleteAdminUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'User not found', 'NOT_FOUND');

    if (user.role === 'admin' && getEffectiveAdminRole(req.user) !== 'super_admin') {
      return sendError(
        res,
        403,
        'Only super admins can delete administrator accounts',
        'FORBIDDEN',
      );
    }

    // Also remove associated profiles to prevent dangling records
    if (user.role === 'maid') {
      await MaidProfile.deleteOne({ user: user._id });
    } else if (user.role === 'customer') {
      await CustomerProfile.deleteOne({ user: user._id });
    }

    await User.deleteOne({ _id: user._id });
    return sendResponse(res, 200, 'User deleted successfully', { id: req.params.id });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create New Admin Account
 * @route   POST /api/v1/admin/users/create-admin
 */
exports.createAdmin = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone, adminRole } = req.body;
    if (!email || !password || !firstName) {
      return res
        .status(400)
        .json({ success: false, message: 'First name, email, and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const allowedAdminRoles = [
      'super_admin',
      'operations_admin',
      'finance_admin',
      'support_admin',
      'marketing_admin',
    ];
    const resolvedAdminRole = allowedAdminRoles.includes(adminRole)
      ? adminRole
      : 'operations_admin';

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email address already registered' });
    }

    const name = `${firstName} ${lastName || ''}`.trim();
    const admin = await User.create({
      firstName,
      lastName,
      name,
      email: normalizedEmail,
      phone,
      password,
      role: 'admin',
      adminRole: resolvedAdminRole,
      isVerified: true,
    });

    return res.status(201).json({
      success: true,
      message: 'New administrator account created successfully',
      data: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        adminRole: admin.adminRole,
        isVerified: admin.isVerified,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get System Activity Logs
 * @route   GET /api/v1/admin/activity-logs
 */
exports.getActivityLogs = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    let logs = await ActivityLog.find()
      .populate('admin', 'name firstName lastName email')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit);
    const total = await ActivityLog.countDocuments();
    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      'Activity logs retrieved successfully',
      { logs },
      {
        pagination: {
          page,
          perPage: limit,
          totalItems: total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clear System Activity Logs
 * @route   DELETE /api/v1/admin/activity-logs
 */
exports.clearActivityLogs = async (req, res, next) => {
  try {
    await ActivityLog.deleteMany({});
    return sendResponse(res, 200, 'System activity logs successfully purged');
  } catch (error) {
    next(error);
  }
};
