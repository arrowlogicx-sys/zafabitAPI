const User = require('../../models/User');
const MaidProfile = require('../../models/MaidProfile');
const CustomerProfile = require('../../models/CustomerProfile');
const Booking = require('../../models/Booking');
const Service = require('../../models/Service');
const Review = require('../../models/Review');
const Payment = require('../../models/Payment');
const { sendResponse } = require('../../utils/apiResponse');
const { financeAggregationStages } = require('../../utils/billingConfig');
const { createNamedRedisClient, isRedisConfigured } = require('../../utils/redisClient');
const { financeTotalsGroup, normalizeFinanceTotals } = require('./adminControllerUtils');

let memoryCache = null;
let memoryCacheExpiry = 0;

const getDashboardStats = async (req, res, next) => {
  try {
    const CACHE_KEY = 'admin:dashboard:stats';
    const CACHE_TTL = 300; // 5 minutes

    let cachedStats = null;
    let redisClient = null;

    try {
      if (isRedisConfigured()) {
        redisClient = await createNamedRedisClient('admin_dashboard');
        if (redisClient) {
          const raw = await redisClient.get(CACHE_KEY);
          if (raw) {
            cachedStats = JSON.parse(raw);
          }
        }
      } else {
        // Fallback to memory cache
        if (memoryCache && Date.now() < memoryCacheExpiry) {
          cachedStats = memoryCache;
        }
      }
    } catch (cacheError) {
      console.warn('Dashboard stats cache read error:', cacheError.message);
    }

    if (cachedStats) {
      return sendResponse(res, 200, 'Dashboard statistics retrieved (cached)', cachedStats);
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const startOfWeek = new Date(startOfToday);
    const dayOfWeek = startOfWeek.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // ==================== 1. REAL-TIME RAW DATABASE COUNTS ====================
    const totalBookings = await Booking.countDocuments();
    const activeMaids = await MaidProfile.countDocuments({ activeStatus: 'active' });
    const activeCustomers = await CustomerProfile.countDocuments();
    const totalCustomersCount = await User.countDocuments({ role: 'customer' });

    // Live Revenue Aggregates
    const revenueData = await Booking.aggregate([
      { $match: { status: 'completed' } },
      ...financeAggregationStages(),
      { $group: financeTotalsGroup },
    ]);
    const liveFinance = normalizeFinanceTotals(revenueData[0]);
    const liveRevenue = liveFinance.grossRevenue;

    // Today's database updates
    const todayCompletedCount = await Booking.countDocuments({
      status: 'completed',
      updatedAt: { $gte: startOfToday },
    });
    const todayCancelledCount = await Booking.countDocuments({
      status: 'cancelled',
      updatedAt: { $gte: startOfToday },
    });
    const todayNewCustomers = await User.countDocuments({
      role: 'customer',
      createdAt: { $gte: startOfToday },
    });
    const todayNewMaids = await User.countDocuments({
      role: 'maid',
      createdAt: { $gte: startOfToday },
    });

    // Live refunds from Payment
    const liveRefundsData = await Payment.aggregate([
      { $match: { status: 'refunded' } },
      { $group: { _id: null, totalRefunds: { $sum: '$refundAmount' } } },
    ]);
    const liveRefunds = liveRefundsData.length > 0 ? liveRefundsData[0].totalRefunds : 0;

    // Maid Review Avg
    const maidKPI = await Review.aggregate([
      { $group: { _id: null, avgRating: { $avg: '$rating' } } },
    ]);
    const avgMaidRating = maidKPI.length > 0 ? parseFloat(maidKPI[0].avgRating.toFixed(2)) : 0;

    // ==================== 2. HISTORICAL TIMELINE QUERIES (PAST 7 DAYS) ====================
    const getPast7DaysArray = () => {
      const dates = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
      }
      return dates;
    };
    const past7Days = getPast7DaysArray();

    // Query 7 days of completed booking revenue
    const weeklyRevenueData = await Booking.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: sevenDaysAgo } } },
      ...financeAggregationStages(),
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          dailyRevenue: { $sum: '$financeGrossAmount' },
        },
      },
    ]);
    const revenueMap = Object.fromEntries(
      weeklyRevenueData.map((item) => [item._id, item.dailyRevenue]),
    );
    const revenueSparkline = past7Days.map((date) => ({ value: revenueMap[date] || 0 }));

    // Query 7 days of Customer signups
    const weeklyCustomersData = await User.aggregate([
      { $match: { role: 'customer', createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
    ]);
    const customersMap = Object.fromEntries(
      weeklyCustomersData.map((item) => [item._id, item.count]),
    );
    const customersSparkline = past7Days.map((date) => ({ value: customersMap[date] || 0 }));

    // Query 7 days of Maid signups
    const weeklyMaidsData = await User.aggregate([
      { $match: { role: 'maid', createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
    ]);
    const maidsMap = Object.fromEntries(weeklyMaidsData.map((item) => [item._id, item.count]));
    const maidsSparkline = past7Days.map((date) => ({ value: maidsMap[date] || 0 }));

    // Query 7 days of completed bookings count
    const weeklyCompletionsData = await Booking.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
    ]);
    const completionsMap = Object.fromEntries(
      weeklyCompletionsData.map((item) => [item._id, item.count]),
    );
    const completionsSparkline = past7Days.map((date) => ({ value: completionsMap[date] || 0 }));

    // Query 7 days of cancelled bookings count
    const weeklyCancellationsData = await Booking.aggregate([
      { $match: { status: 'cancelled', createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
    ]);
    const cancellationsMap = Object.fromEntries(
      weeklyCancellationsData.map((item) => [item._id, item.count]),
    );
    const cancellationsSparkline = past7Days.map((date) => ({
      value: cancellationsMap[date] || 0,
    }));

    // Query 7 days of refunds count
    const weeklyRefundsData = await Payment.aggregate([
      { $match: { status: 'refunded', createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          dailyRefunds: { $sum: '$refundAmount' },
        },
      },
    ]);
    const refundsMap = Object.fromEntries(
      weeklyRefundsData.map((item) => [item._id, item.dailyRefunds]),
    );
    const refundsSparkline = past7Days.map((date) => ({ value: refundsMap[date] || 0 }));

    // ==================== 3. COMPARATIVE DAY-OVER-DAY MATHEMATICS ====================

    // Revenue Change
    const yesterdayRevenueData = await Booking.aggregate([
      { $match: { status: 'completed', updatedAt: { $gte: startOfYesterday, $lt: startOfToday } } },
      ...financeAggregationStages(),
      { $group: { _id: null, total: { $sum: '$financeGrossAmount' } } },
    ]);
    const yesterdayRevenue =
      yesterdayRevenueData.length > 0
        ? yesterdayRevenueData[0].total || yesterdayRevenueData[0].totalRevenue || 0
        : 0;
    const todayRevenueData = await Booking.aggregate([
      { $match: { status: 'completed', updatedAt: { $gte: startOfToday } } },
      ...financeAggregationStages(),
      { $group: { _id: null, total: { $sum: '$financeGrossAmount' } } },
    ]);
    const todayRevenue =
      todayRevenueData.length > 0
        ? todayRevenueData[0].total || todayRevenueData[0].totalRevenue || 0
        : 0;

    const weekRevenueData = await Booking.aggregate([
      { $match: { status: 'completed', updatedAt: { $gte: startOfWeek } } },
      ...financeAggregationStages(),
      { $group: { _id: null, total: { $sum: '$financeGrossAmount' } } },
    ]);
    const revenueThisWeek =
      weekRevenueData.length > 0
        ? weekRevenueData[0].total || weekRevenueData[0].totalRevenue || 0
        : 0;

    let revenueChange = '0%';
    let revenueChangeType = 'neutral';
    if (yesterdayRevenue > 0) {
      const diff = ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;
      revenueChange = `${diff >= 0 ? '↗' : '↘'} ${Math.abs(diff).toFixed(1)}%`;
      revenueChangeType = diff >= 0 ? 'positive' : 'negative';
    } else if (todayRevenue > 0) {
      revenueChange = `↗ 100%`;
      revenueChangeType = 'positive';
    }

    // Customer Change
    const yesterdayCustomers = await User.countDocuments({
      role: 'customer',
      createdAt: { $gte: startOfYesterday, $lt: startOfToday },
    });
    let customerChange = '0%';
    let customerChangeType = 'neutral';
    if (yesterdayCustomers > 0) {
      const diff = ((todayNewCustomers - yesterdayCustomers) / yesterdayCustomers) * 100;
      customerChange = `${diff >= 0 ? '↗' : '↘'} ${Math.abs(diff).toFixed(1)}%`;
      customerChangeType = diff >= 0 ? 'positive' : 'negative';
    } else if (todayNewCustomers > 0) {
      customerChange = `↗ 100%`;
      customerChangeType = 'positive';
    }

    // Maid Change
    const yesterdayMaids = await User.countDocuments({
      role: 'maid',
      createdAt: { $gte: startOfYesterday, $lt: startOfToday },
    });
    let maidChange = '0%';
    let maidChangeType = 'neutral';
    if (yesterdayMaids > 0) {
      const diff = ((todayNewMaids - yesterdayMaids) / yesterdayMaids) * 100;
      maidChange = `${diff >= 0 ? '↗' : '↘'} ${Math.abs(diff).toFixed(1)}%`;
      maidChangeType = diff >= 0 ? 'positive' : 'negative';
    } else if (todayNewMaids > 0) {
      maidChange = `↗ 100%`;
      maidChangeType = 'positive';
    }

    // Completion Rate Cards logic
    const completedAllTime = await Booking.countDocuments({ status: 'completed' });
    const completionRate =
      totalBookings > 0 ? parseFloat(((completedAllTime / totalBookings) * 100).toFixed(1)) : 0;
    const averageOrderValue =
      completedAllTime > 0 ? parseFloat((liveRevenue / completedAllTime).toFixed(2)) : 0;
    const partnerEarnings = liveFinance.maidShareAmount;

    const yesterdayTotalBookings = await Booking.countDocuments({
      createdAt: { $gte: startOfYesterday, $lt: startOfToday },
    });
    const yesterdayCompletedBookings = await Booking.countDocuments({
      status: 'completed',
      updatedAt: { $gte: startOfYesterday, $lt: startOfToday },
    });
    const yesterdayCompletionRate =
      yesterdayTotalBookings > 0 ? (yesterdayCompletedBookings / yesterdayTotalBookings) * 100 : 0;
    const todayTotalBookings = await Booking.countDocuments({ createdAt: { $gte: startOfToday } });
    const todayCompletionRate =
      todayTotalBookings > 0 ? (todayCompletedCount / todayTotalBookings) * 100 : 0;

    let completionChange = '0%';
    let completionChangeType = 'neutral';
    const diffCompletion = todayCompletionRate - yesterdayCompletionRate;
    if (diffCompletion !== 0) {
      completionChange = `${diffCompletion >= 0 ? '↗' : '↘'} ${Math.abs(diffCompletion).toFixed(1)}%`;
      completionChangeType = diffCompletion >= 0 ? 'positive' : 'negative';
    }

    // Cancellation Rate logic
    const cancelledAllTime = await Booking.countDocuments({ status: 'cancelled' });
    const cancellationRate =
      totalBookings > 0 ? parseFloat(((cancelledAllTime / totalBookings) * 100).toFixed(1)) : 0;

    const yesterdayCancelledBookings = await Booking.countDocuments({
      status: 'cancelled',
      updatedAt: { $gte: startOfYesterday, $lt: startOfToday },
    });
    const yesterdayCancellationRate =
      yesterdayTotalBookings > 0 ? (yesterdayCancelledBookings / yesterdayTotalBookings) * 100 : 0;
    const todayCancellationRate =
      todayTotalBookings > 0 ? (todayCancelledCount / todayTotalBookings) * 100 : 0;

    let cancellationChange = '0%';
    let cancellationChangeType = 'neutral';
    const diffCancellation = todayCancellationRate - yesterdayCancellationRate;
    if (diffCancellation !== 0) {
      cancellationChange = `${diffCancellation <= 0 ? '↘' : '↗'} ${Math.abs(diffCancellation).toFixed(1)}%`;
      cancellationChangeType = diffCancellation <= 0 ? 'positive' : 'negative';
    }

    // Refunds Change
    const yesterdayRefundsData = await Payment.aggregate([
      { $match: { status: 'refunded', updatedAt: { $gte: startOfYesterday, $lt: startOfToday } } },
      { $group: { _id: null, total: { $sum: '$refundAmount' } } },
    ]);
    const yesterdayRefunds = yesterdayRefundsData.length > 0 ? yesterdayRefundsData[0].total : 0;
    const todayRefundsData = await Payment.aggregate([
      { $match: { status: 'refunded', updatedAt: { $gte: startOfToday } } },
      { $group: { _id: null, total: { $sum: '$refundAmount' } } },
    ]);
    const todayRefunds = todayRefundsData.length > 0 ? todayRefundsData[0].total : 0;

    let refundChange = '0%';
    let refundChangeType = 'neutral';
    if (yesterdayRefunds > 0) {
      const diff = ((todayRefunds - yesterdayRefunds) / yesterdayRefunds) * 100;
      refundChange = `${diff >= 0 ? '↗' : '↘'} ${Math.abs(diff).toFixed(1)}%`;
      refundChangeType = diff >= 0 ? 'positive' : 'negative';
    } else if (todayRefunds > 0) {
      refundChange = `↗ 100%`;
      refundChangeType = 'positive';
    }

    // ==================== 4. ASSEMBLE PURE KPI CARD CONFIGURATIONS ====================
    const kpiCards = [
      {
        title: 'Total Revenue',
        timeframeLabel: 'Total',
        value: `₹${liveRevenue.toLocaleString('en-IN')}`,
        changeText: revenueChange,
        changeType: revenueChangeType,
        vsLabel: 'vs yesterday',
        themeColor: 'purple',
        chartData: revenueSparkline,
      },
      {
        title: 'New Customers',
        timeframeLabel: 'Today',
        value: `${todayNewCustomers}`,
        changeText: customerChange,
        changeType: customerChangeType,
        vsLabel: 'vs yesterday',
        themeColor: 'blue',
        chartData: customersSparkline,
      },
      {
        title: 'New Maids',
        timeframeLabel: 'Today',
        value: `${todayNewMaids}`,
        changeText: maidChange,
        changeType: maidChangeType,
        vsLabel: 'vs yesterday',
        themeColor: 'orange',
        chartData: maidsSparkline,
      },
      {
        title: 'Completion Rate',
        timeframeLabel: 'All-Time',
        value: `${completionRate}%`,
        changeText: completionChange,
        changeType: completionChangeType,
        vsLabel: 'vs yesterday',
        themeColor: 'blue',
        chartData: completionsSparkline,
      },
      {
        title: 'Cancellation Rate',
        timeframeLabel: 'All-Time',
        value: `${cancellationRate}%`,
        changeText: cancellationChange,
        changeType: cancellationChangeType,
        vsLabel: 'vs yesterday',
        themeColor: 'red',
        chartData: cancellationsSparkline,
      },
      {
        title: 'Refunds',
        timeframeLabel: 'Total',
        value: `₹${liveRefunds.toLocaleString('en-IN')}`,
        changeText: refundChange,
        changeType: refundChangeType,
        vsLabel: 'vs yesterday',
        themeColor: 'purple',
        chartData: refundsSparkline,
      },
    ];

    // ==================== 5. BOOKINGS OVERVIEW CHART DATA ====================
    const weeklyBookingsOverviewData = await Booking.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
        },
      },
    ]);
    const bookingsOverviewMap = Object.fromEntries(
      weeklyBookingsOverviewData.map((item) => [
        item._id,
        { total: item.total, completed: item.completed },
      ]),
    );

    const bookingsOverview = past7Days.map((date) => {
      const dayLabel = new Date(date).toLocaleDateString('en-IN', { weekday: 'short' });
      const record = bookingsOverviewMap[date] || { total: 0, completed: 0 };
      return {
        time: dayLabel,
        bookings: record.total,
        completed: record.completed,
      };
    });

    // ==================== 6. FETCH LIVE SYSTEM CATALOGS & FEEDS ====================

    // Services pricing
    const dbServices = await Service.find({ status: 'active' });
    const servicePrices = dbServices.map((service) => ({
      id: service._id,
      name: service.name,
      basePrice: `₹${service.price}`,
      peakPrice: `₹${Math.round(service.price * 1.2)}`,
    }));

    // Recent Bookings
    const recentDbBookings = await Booking.find()
      .populate('customer', 'firstName lastName name')
      .populate('service', 'name')
      .sort('-createdAt')
      .limit(5);

    let recentBookingsList = recentDbBookings.map((b) => {
      const customerName = b.customer
        ? b.customer.name ||
          `${b.customer.firstName || ''} ${b.customer.lastName || ''}`.trim() ||
          'Valued Customer'
        : 'Valued Customer';
      const serviceName = b.service
        ? b.service.name
        : b.items && b.items.length > 0
          ? b.items[0].name
          : 'Home Cleaning';
      const timeStr =
        new Date(b.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' • ' +
        new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return {
        id: `ZB-${b._id.toString().substring(18).toUpperCase()}`,
        customer: customerName,
        service: serviceName,
        time: timeStr,
        status: ['pending', 'paid_unassigned'].includes(b.status)
          ? 'Pending'
          : b.status === 'admin_attention'
            ? 'Admin Attention'
            : b.status === 'completed'
              ? 'Completed'
              : b.status === 'cancelled'
                ? 'Cancelled'
                : 'In Progress',
        amount: `₹${b.totalAmount}`,
      };
    });

    // Pending requests feed
    const pendingDbRequests = await Booking.find({
      status: { $in: ['pending', 'paid_unassigned', 'admin_attention'] },
    })
      .populate('customer', 'firstName lastName name')
      .sort('-createdAt')
      .limit(5);

    let liveRequestsList = pendingDbRequests.map((b, i) => {
      const addressStr = b.address
        ? `${b.address.houseName || ''}, ${b.address.street || ''}`
        : 'Pending allocation';
      const minsAgo = Math.max(
        1,
        Math.round((new Date().getTime() - new Date(b.createdAt).getTime()) / 60000),
      );
      return {
        service: b.service ? b.service.name : 'Cleaning Request',
        address: addressStr,
        time: `${minsAgo} min ago`,
        isNew: true,
        themeColor: i % 2 === 0 ? 'purple' : 'green',
      };
    });

    // ==================== 7. REGIONAL SERVICE DENSITY ====================
    const regionalAggregation = await Booking.aggregate([
      { $group: { _id: '$address.street', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const totalRegionalBookings = regionalAggregation.reduce((acc, curr) => acc + curr.count, 0);
    const regionalColorPalette = ['#6c5ce7', '#a8a5e6', '#c4c1f0', '#e0dffa', '#f0efff'];
    const regionalServiceDensity = regionalAggregation
      .filter((item) => item._id !== null && item._id !== undefined && item._id.trim() !== '')
      .slice(0, 5)
      .map((item, index) => {
        const pct =
          totalRegionalBookings > 0 ? Math.round((item.count / totalRegionalBookings) * 100) : 0;
        let name = item._id;
        if (name.endsWith(' High Road')) {
          name = name.replace(' High Road', '');
        }
        return {
          name,
          value: pct,
          fill: regionalColorPalette[index % regionalColorPalette.length],
        };
      });

    if (regionalServiceDensity.length === 0) {
      regionalServiceDensity.push(
        { name: 'Kakkanad', value: 42, fill: '#6c5ce7' },
        { name: 'Vyttila', value: 28, fill: '#a8a5e6' },
        { name: 'Edappally', value: 18, fill: '#c4c1f0' },
        { name: 'Kadavanthra', value: 8, fill: '#e0dffa' },
        { name: 'Panampilly Nagar', value: 4, fill: '#f0efff' },
      );
    }

    // ==================== 8. SERVICE CATEGORY REVENUE SPLITS ====================
    const serviceSplitsAggregation = await Booking.aggregate([
      {
        $lookup: {
          from: 'services',
          localField: 'service',
          foreignField: '_id',
          as: 'serviceDetails',
        },
      },
      { $unwind: { path: '$serviceDetails', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$serviceDetails.category', '$serviceDetails.name'] },
          value: { $sum: '$totalAmount' },
        },
      },
      { $sort: { value: -1 } },
    ]);

    const categoryColorPalette = ['#6c5ce7', '#00b894', '#fdcb6e', '#fa9f1b', '#1fcb4f'];
    const serviceCategorySplits = serviceSplitsAggregation
      .filter((item) => item._id !== null && item._id !== undefined)
      .slice(0, 5)
      .map((item, index) => {
        return {
          name: item._id,
          value: item.value || 0,
          color: categoryColorPalette[index % categoryColorPalette.length],
        };
      });

    if (serviceCategorySplits.length === 0) {
      serviceCategorySplits.push(
        {
          name: 'Standard Cleaning',
          value: Math.round((liveRevenue || 120000) * 0.65),
          color: '#6c5ce7',
        },
        { name: 'Deep Clean', value: Math.round((liveRevenue || 120000) * 0.25), color: '#00b894' },
        {
          name: 'Sanitization',
          value: Math.round((liveRevenue || 120000) * 0.1),
          color: '#fdcb6e',
        },
      );
    }

    const paymentStatsAgg = await Payment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const transactionStats = {
      total: 0,
      successful: 0,
      failed: 0,
      pending: 0,
      refunded: 0,
    };

    paymentStatsAgg.forEach((item) => {
      const count = item.count || 0;
      transactionStats.total += count;
      if (item._id === 'captured') transactionStats.successful = count;
      else if (item._id === 'failed') transactionStats.failed = count;
      else if (item._id === 'pending') transactionStats.pending = count;
      else if (item._id === 'refunded') transactionStats.refunded = count;
    });

    const resolvedTransactions = transactionStats.successful + transactionStats.failed;
    const paymentSuccessRate =
      resolvedTransactions > 0
        ? parseFloat(((transactionStats.successful / resolvedTransactions) * 100).toFixed(1))
        : 0;
    const paymentFailureRate =
      resolvedTransactions > 0
        ? parseFloat(((transactionStats.failed / resolvedTransactions) * 100).toFixed(1))
        : 0;

    const revenueDashboard = {
      totalRevenue: liveRevenue,
      revenueToday: todayRevenue,
      revenueThisWeek,
      partnerEarnings,
      averageOrderValue,
      transactionStatistics: transactionStats,
      paymentSuccessRate,
      paymentFailureRate,
    };

    // ==================== 9. DYNAMIC AI INSIGHTS ====================
    let topZones = 'Kakkanad & Vyttila';
    if (regionalServiceDensity && regionalServiceDensity.length > 0) {
      const activeZoneNames = regionalServiceDensity
        .filter(z => z.name && z.name !== 'Others')
        .slice(0, 2)
        .map(z => z.name);
      if (activeZoneNames.length > 0) {
        topZones = activeZoneNames.join(' & ');
      }
    }

    const aiInsights = [
      {
        prefix: 'Booking volume has scaled up. Total platform bookings have reached ',
        actionText: `${totalBookings} entries`,
        suffix: '.',
        actionType: 'bookings',
        time: '2 mins ago',
        type: 'success',
      },
      {
        prefix: 'Maid service ratings are exceptional, averaging ',
        actionText: `${avgMaidRating || 4.8}★`,
        suffix: ' out of 5 across all tasks.',
        actionType: 'reviews',
        time: '10 mins ago',
        type: 'info',
      },
      {
        prefix: '',
        actionText: `${activeMaids} maid partners`,
        suffix: ` are actively online and accepting bookings in ${topZones}.`,
        actionType: 'maid_partners',
        time: '1 hour ago',
        type: 'warning',
      },
    ];

    const stats = {
      totalBookings,
      activeMaids,
      activeCustomers: totalCustomersCount,
      totalRevenue: liveRevenue,
      avgMaidRating,
      revenueDashboard,
      kpiCards,
      servicePrices,
      recentBookings: recentBookingsList,
      liveRequests: liveRequestsList,
      bookingsOverview,
      regionalServiceDensity,
      serviceCategorySplits,
      aiInsights,
    };

    // Set Cache
    try {
      if (redisClient) {
        await redisClient.set(CACHE_KEY, JSON.stringify(stats), { EX: CACHE_TTL });
      } else {
        memoryCache = stats;
        memoryCacheExpiry = Date.now() + CACHE_TTL * 1000;
      }
    } catch (cacheError) {
      console.warn('Dashboard stats cache write error:', cacheError.message);
    }

    return sendResponse(res, 200, 'Dashboard statistics retrieved', stats);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Work Schedule configuration (Zone-wise)
 * @route   POST /api/v1/admin/zones/config
 */

module.exports = {
  getDashboardStats,
};
