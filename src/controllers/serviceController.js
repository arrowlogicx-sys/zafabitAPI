const Service = require('../models/Service');
const { translateService, mapServiceTranslations } = require('../utils/translate');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { CANCELLATION_POLICY } = require('../utils/constants');
const { destroyCloudinaryAsset, uploadBufferToCloudinary } = require('../utils/cloudinaryUpload');

const textListFields = ['whatsIncluded', 'doesNotInclude'];
const numberFields = ['price', 'originalPrice', 'estimatedTime'];

const parseMaybeJson = (value) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return '';

  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return value;
    }
  }

  return value;
};

const normalizeTextList = (value) => {
  const parsed = parseMaybeJson(value);
  const source = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'string'
      ? parsed.split(/\r?\n|,/)
      : [];

  return source.map((item) => String(item).trim()).filter(Boolean);
};

const normalizeHowItsDone = (value) => {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      title: String(item.title || '').trim(),
      description: String(item.description || '').trim(),
      iconUrl: String(item.iconUrl || '').trim(),
    }))
    .filter((item) => item.title);
};

const normalizeFaqs = (value) => {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      question: String(item.question || '').trim(),
      answer: String(item.answer || '').trim(),
    }))
    .filter((item) => item.question);
};

const buildServicePayload = (body) => {
  const payload = { ...body };
  delete payload._id;
  delete payload.id;
  delete payload.imagePublicId;

  numberFields.forEach((field) => {
    if (payload[field] === undefined) return;

    if (payload[field] === '') {
      payload[field] = undefined;
      return;
    }

    const number = Number(payload[field]);
    if (Number.isFinite(number)) {
      payload[field] = number;
    }
  });

  textListFields.forEach((field) => {
    if (payload[field] !== undefined) {
      payload[field] = normalizeTextList(payload[field]);
    }
  });

  if (payload.howItsDone !== undefined) {
    payload.howItsDone = normalizeHowItsDone(payload.howItsDone);
  }

  if (payload.faqs !== undefined) {
    payload.faqs = normalizeFaqs(payload.faqs);
  }

  return payload;
};

/**
 * @desc    Get all active services
 * @route   GET /api/v1/services
 */
exports.getServices = async (req, res, next) => {
  try {
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.all !== 'true') {
      filter.status = 'active';
    }

    if (req.query.category) {
      filter.category = { $regex: req.query.category, $options: 'i' };
    }

    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const total = await Service.countDocuments(filter);
    const services = await Service.find(filter).skip(skip).limit(limit).sort('-createdAt');

    const locale = req.headers['locale'] || 'en';
    const mappedServices = services.map((s) => mapServiceTranslations(s, locale));

    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      'Services retrieved',
      { services: mappedServices },
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
 * @desc    Get specific service details
 * @route   GET /api/v1/services/:id
 */
exports.getService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return sendError(res, 404, 'Service not found', 'NOT_FOUND');
    const locale = req.headers['locale'] || 'en';
    const mappedService = mapServiceTranslations(service, locale);
    return sendResponse(res, 200, 'Service retrieved', { service: mappedService });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new service (Admin)
 * @route   POST /api/v1/services
 */
exports.createService = async (req, res, next) => {
  try {
    const payload = buildServicePayload(req.body);

    if (req.file) {
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/services');
      payload.image = result.secure_url;
      payload.imagePublicId = result.public_id;
    }

    // Auto-translate using Google Translate free Web API
    const translations = await translateService(payload);
    if (translations) {
      payload.translations = translations;
    }

    const service = await Service.create(payload);
    return sendResponse(res, 201, 'Service created', { service });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update service (Admin)
 */
exports.updateService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return sendError(res, 404, 'Service not found', 'NOT_FOUND');

    const payload = buildServicePayload(req.body);
    Object.entries(payload).forEach(([key, value]) => {
      service[key] = value;
    });

    if (req.file) {
      await destroyCloudinaryAsset(service.imagePublicId);
      const result = await uploadBufferToCloudinary(req.file.buffer, 'zaffabit/services');
      service.image = result.secure_url;
      service.imagePublicId = result.public_id;
    }

    // Auto-translate using Google Translate free Web API
    const translations = await translateService(service);
    if (translations) {
      service.translations = translations;
      service.markModified('translations'); // Tell Mongoose that Mixed field changed
    }

    await service.save();
    return sendResponse(res, 200, 'Service updated', { service });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete service (Admin)
 */
exports.deleteService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return sendError(res, 404, 'Service not found', 'NOT_FOUND');

    await destroyCloudinaryAsset(service.imagePublicId);
    await service.deleteOne();
    return sendResponse(res, 200, 'Service deleted');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Estimate time for a cart of services
 * @route   GET /api/v1/services/estimate
 */
exports.estimateTime = async (req, res, next) => {
  try {
    const { items } = req.query; // items is a comma-separated list of item names or IDs
    if (!items) return sendError(res, 400, 'Items are required for estimation', 'VALIDATION_ERROR');

    const mongoose = require('mongoose');
    const itemValues = items.split(',');

    // Check if they are ObjectIds or names
    const query = mongoose.isValidObjectId(itemValues[0])
      ? { _id: { $in: itemValues } }
      : { name: { $in: itemValues } };

    const services = await Service.find(query);

    let totalTime = 0;
    services.forEach((service) => {
      totalTime += service.estimatedTime || 30; // default 30 mins
    });

    return sendResponse(res, 200, 'Time estimation calculated', {
      baseTime: totalTime,
      estimatedTimeMinutes: totalTime,
      formattedTime: `${Math.floor(totalTime / 60)}h ${totalTime % 60}m`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Cancellation & Refund Policy
 * @route   GET /api/v1/services/policy
 */
exports.getPolicy = async (req, res, next) => {
  try {
    return sendResponse(res, 200, 'Cancellation & Refund Policy retrieved', {
      policy: CANCELLATION_POLICY.POLICY_TEXT,
    });
  } catch (error) {
    next(error);
  }
};
