const { z } = require('zod');

/**
 * Zod validation middleware for Express
 * @param {z.ZodObject} schema - Zod schema container object
 */
const validate = (schema) => (req, res, next) => {
  try {
    const dataToValidate = {};
    if (schema.shape.body) dataToValidate.body = req.body;
    if (schema.shape.query) dataToValidate.query = req.query;
    if (schema.shape.params) dataToValidate.params = req.params;

    const parsed = schema.parse(dataToValidate);

    if (parsed.body) req.body = parsed.body;
    if (parsed.query) req.query = parsed.query;
    if (parsed.params) req.params = parsed.params;

    return next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const customErr = new Error('Input validation failed');
      customErr.name = 'ZodValidationError';
      customErr.statusCode = 400;
      customErr.code = 'VALIDATION_ERROR';
      const zodIssues = error.issues || error.errors || [];
      customErr.details = zodIssues.map((err) => {
        // Strip the parent layer from the validation path for clean frontend field names
        const fieldName = err.path.length > 1 ? err.path.slice(1).join('.') : err.path.join('.');
        return {
          field: fieldName,
          message: err.message,
        };
      });
      return next(customErr);
    }
    return next(error);
  }
};

module.exports = validate;
