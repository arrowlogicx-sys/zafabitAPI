const { z } = require('zod');
const { sendError } = require('./response');
const { canonicalizePhone } = require('./phone');

// Express middleware: parse `req[source]` with a zod schema. On failure, emit
// one 400 whose top-line message is the first field error and whose
// `error.details` lists every field. On success, the parsed (and coerced /
// trimmed / defaulted) value replaces `req[source]` and is also on
// `req.validated`.
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] == null ? {} : req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || '(body)',
      message: i.message,
    }));
    return sendError(res, 400, details[0].message, 'VALIDATION_ERROR', details);
  }
  req.validated = result.data;
  if (source === 'body') req.body = result.data;
  return next();
};

// ---- reusable field schemas ---------------------------------------------------

const PHONE_RE = /^\+?[0-9]{10,15}$/;

// Accepts loose formatting, canonicalises, then holds to E.164-ish.
const phone = z.preprocess(
  (v) => {
    const s = typeof v === 'string' ? v : v == null ? '' : String(v);
    return canonicalizePhone(s) || s;
  },
  z.string().regex(PHONE_RE, 'Enter a valid phone number, including the country code.'),
);

const otpCode = z
  .string({ required_error: 'Enter the code we sent you.' })
  .trim()
  .regex(/^[0-9]{4,6}$/, 'Enter the code we sent you (4 to 6 digits).');

const uuid = z.string().uuid('A valid id is required.');

// z.enum with a friendly, list-in-the-message error and case-insensitive input.
const oneOf = (values, label) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(values, {
      errorMap: () => ({ message: `${label} must be one of: ${values.join(', ')}.` }),
    }),
  );

const shortText = (label, max = 255) =>
  z
    .string({
      required_error: `${label} is required.`,
      invalid_type_error: `${label} must be text.`,
    })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

module.exports = { validate, z, phone, otpCode, uuid, oneOf, shortText, PHONE_RE };
