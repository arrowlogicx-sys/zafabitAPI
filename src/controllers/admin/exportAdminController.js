const User = require('../../models/User');
const Booking = require('../../models/Booking');
const Review = require('../../models/Review');
const { sendResponse } = require('../../utils/apiResponse');
const { paginationMeta, parsePagination } = require('./adminControllerUtils');

const exportDataset = async (req, res, next) => {
  try {
    const { dataset } = req.params;
    const format = String(req.query.format || 'json').toLowerCase();
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 100, maxLimit: 1000 });

    let exportQuery;
    let exportModel;
    if (dataset === 'users') {
      exportModel = User;
      exportQuery = User.find().select('-password -otp -otpExpires');
    } else if (dataset === 'bookings') {
      exportModel = Booking;
      exportQuery = Booking.find().populate('customer', 'name').populate('maid', 'name email');
    } else if (dataset === 'support') {
      const SupportTicket = require('../../models/SupportTicket');
      exportModel = SupportTicket;
      exportQuery = SupportTicket.find();
    } else if (dataset === 'incidents') {
      const Incident = require('../../models/Incident');
      exportModel = Incident;
      exportQuery = Incident.find();
    } else if (dataset === 'reviews') {
      exportModel = Review;
      exportQuery = Review.find().populate('customer', 'name').populate('maid', 'name email');
    } else {
      return res.status(400).json({ success: false, message: 'Invalid dataset parameter' });
    }

    exportQuery.sort({ _id: 1 }).lean();

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=export_${dataset}.csv`);

      let fields = null;
      let rowCount = 0;
      const cursor = exportQuery.cursor({ batchSize: 500 });
      for await (const item of cursor) {
        if (!fields) {
          fields = Object.keys(item);
          res.write(`${fields.join(',')}\n`);
        }
        const row = fields.map((field) => {
          const value = item[field];
          if (value === null || value === undefined) return '';
          const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
          return `"${serialized.replace(/"/g, '""')}"`;
        });
        if (!res.write(`${row.join(',')}\n`)) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
        rowCount += 1;
      }
      if (rowCount === 0) res.write('No records found\n');
      return res.end();
    }

    const [data, total] = await Promise.all([
      exportQuery.skip(skip).limit(limit),
      exportModel.countDocuments ? exportModel.countDocuments({}) : Promise.resolve(0),
    ]);
    return sendResponse(res, 200, `Dataset ${dataset} export page retrieved`, data, {
      pagination: paginationMeta(page, limit, total),
      export: {
        complete: total <= limit,
        csvStreamingAvailable: true,
        maximumJsonRowsPerRequest: 1000,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  exportDataset,
};
